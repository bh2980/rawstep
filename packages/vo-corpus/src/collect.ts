/**
 * Runs a case set on a live VoiceOver and appends one CaseRecord per case to <run>/records.jsonl.
 *   tsx src/collect.ts --vm vo-collector --cases data/cases/elements-v1
 *   tsx src/collect.ts --vm vo-collector --resume data/runs/elements-v1-<time>     (skips cases already recorded)
 *
 * Per case: load the page (auto-read speaks it all; that speech is discarded), VO+Home to the start marker, check the
 * speech names it, then press the case's chords and record what each one said. New precision cases save native AX after
 * each action, with immutable attempt paths, input archives and a step journal. Stops the whole run when the browser is not in front or the AT Driver
 * connection drops: keys must never land anywhere else.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { dumpAxTree, focusedAxNode, saveAxSnapshot, type AxDump } from "./axdump.js";
import { START_MARKER, casesFingerprint, type CaseRecord, type CaseSet } from "./cases.js";
import { atDriverUrl, browserApps, machineFacts, navigateBrowser, requireFrontmost, resolveMachine, serveDirectory, type BrowserName } from "./host.js";
import { spoken, VoSession } from "./session.js";
import { archiveCaseInputs } from "./archive.js";
import { publicPageScript, realPageContext, accessiblePageContext, nativeAccessibleText, firstUniqueHeading, hearsHeading, type PageContext } from "./real-pages.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  vm: { type: "string" },
  url: { type: "string" },
  browser: { type: "string", default: "safari" },
  cases: { type: "string" },
  resume: { type: "string" },
  filter: { type: "string" },
  limit: { type: "string" },
  reverse: { type: "boolean" },
  settings: { type: "string" },
  "no-ax": { type: "boolean", default: false },
} });
const browser = values.browser as BrowserName;
if (!(browser in browserApps)) throw new Error(`--browser must be safari or chrome, not ${values.browser}`);

const runDir = values.resume ? resolve(values.resume) : undefined;
const meta = runDir ? JSON.parse(await readFile(join(runDir, "meta.json"), "utf8")) : undefined;
const settings=values.settings??meta?.settings??"baseline-v1";
const casesDir = runDir && existsSync(join(runDir,"inputs/cases.json")) ? join(runDir,"inputs") : resolve(packageRoot, meta?.casesDir ?? values.cases ?? "");
if (!existsSync(join(casesDir, "cases.json"))) throw new Error("Pass --cases <dir with cases.json> or --resume <run dir>");
const set = JSON.parse(await readFile(join(casesDir, "cases.json"), "utf8")) as CaseSet;
const casesSha256 = await casesFingerprint(casesDir, set);
if (meta?.casesSha256 && meta.casesSha256 !== casesSha256) throw new Error("Cannot resume: case metadata or page bytes changed");
const out = runDir ?? join(packageRoot, "data/runs", `${set.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
if(!runDir){await mkdir(dirname(out),{recursive:true});await mkdir(out);}
await mkdir(join(out, "ax"), { recursive: true });
const inputArchive = runDir ? meta?.inputArchive : await archiveCaseInputs(casesDir,out,set,casesSha256);
const records = join(out, "records.jsonl");

const done = new Set<string>();
if (existsSync(records)) for (const line of (await readFile(records, "utf8")).split("\n")) if (line) done.add((JSON.parse(line) as CaseRecord).caseId);
const filter = values.filter ? new RegExp(values.filter) : undefined;
const reverse = values.reverse ?? meta?.caseOrder === "reverse";
const ordered = reverse ? [...set.cases].reverse() : set.cases;
const todo = ordered.filter(c => !done.has(c.id) && (!filter || filter.test(c.id))).slice(0, values.limit ? Number(values.limit) : undefined);

const machine = await resolveMachine(values.vm);
const guard = requireFrontmost(machine, browser);
const session = new VoSession(values.url ?? atDriverUrl(machine), guard);
const pages = await serveDirectory(existsSync(join(out,"inputs/cases.json"))?join(out,"inputs"):casesDir, machine);
const started = Date.now();
let aligned = 0;
try {
  const negotiated = await session.start();
  const captureSessionId=randomUUID(), facts=await machineFacts(machine,browser);
  await appendFile(join(out,'sessions.jsonl'),JSON.stringify({schemaVersion:1,captureSessionId,receiptClockOrigin:session.startedAt,settings,atDriver:negotiated,machine:facts,casesSha256})+'\n');
  if (!runDir) await writeFile(join(out, "meta.json"), JSON.stringify({
    caseSet: set.id, casesGeneratedAt: set.generatedAt, casesSha256, casesDir: casesDir.slice(packageRoot.length + 1), caseOrder: reverse ? "reverse" : "forward",
    settings, startedAt: new Date().toISOString(), atDriver: negotiated, machine: facts, captureSessionId,
    inputArchive, stepJournal:"steps.jsonl", receiptClock: {origin:session.startedAt,basis:"host receipt time; not synthesis latency"},
    workflowStartProtocol: "Public: native AX marker focus then VO+Shift+F4 from proven native marker focus. Local: VO+Home with proven-focus recovery. VO+Cmd+F4 verifies keyboard focus before workflow keys.",
  }, null, 2));
  console.log(`${set.id}: ${todo.length} to run, ${done.size} already recorded -> ${out}`);

  for (const [index, item] of todo.entries()) {
    const attemptId = randomUUID();
    await navigateBrowser(machine, browser, item.url ?? `${pages.origin}/${item.page}`);
    await session.listen({ quietMs: 1_500, maxWaitMs: 30_000 }); // auto-read of the new page
    session.drain();
    let pageContext: PageContext | undefined;
    let start: CaseRecord["start"] = { aligned: false, speech: [], commands: [] };
    let startAx: AxDump | undefined;
    let alignmentError: string | undefined;
    if (item.url) {
      if (browser !== "safari") throw new Error("Public-page native collection currently requires Safari");
      await guard("public-page preparation");
      try {
        if (item.startProtocol === "first-heading") {
          startAx = await dumpAxTree(machine, browserApps[browser], { maxNodes:8000, maxStringLength:100000 });
          if (!values["no-ax"]) {
            start.axPath = await saveAxSnapshot(out,attemptId,'preparation',startAx);
          }
          start.anchor = firstUniqueHeading(startAx);
          const dimensions = await machine.exec("osascript", ["-e", 'tell application "System Events" to tell process "Safari" to get size of scroll area 1 of group 1 of group 1 of tab group 1 of splitter group 1 of window 1']);
          const [width,height] = dimensions.trim().split(/,\s*/).map(Number);
          pageContext = accessiblePageContext(nativeAccessibleText(startAx.root), { url:String(startAx.root.AXURL ?? ""), title:startAx.windowTitle, width:width!,height:height! });
        } else {
          const script = publicPageScript(item.contentProtocol);
          const raw = await machine.exec("osascript", ["-e", `tell application "Safari" to do JavaScript ${JSON.stringify(script)} in front document`]);
          pageContext = realPageContext(raw.trim(),script);
          await session.listen({ quietMs: 1500, maxWaitMs: 10000 });
          session.drain();
        }
      } catch (error) {
        await appendFile(records, JSON.stringify({ caseSet: set.id, caseId: item.id, source: "voiceover", attemptId,captureSessionId,receiptClockOrigin:session.startedAt,start, steps: [], error: `Public-page preparation failed: ${(error as Error).message}` } satisfies CaseRecord) + "\n");
        console.log(`[${index + 1}/${todo.length}] ${item.id} ! public page unavailable; failure preserved`);
        continue;
      }
    }
    if (item.startProtocol === "first-heading") {
      // Ordinary Tab enters web content; then synchronize VO to proven native web focus, never to browser chrome.
      for (let i = 0; i < 10 && !focusedAxNode(startAx!); i++) {
        await session.press("Tab"); await session.listen();
        startAx = await dumpAxTree(machine,browserApps[browser], {maxNodes:8000,maxStringLength:100000});
      }
      if (focusedAxNode(startAx!)) {
        for (const chord of ["VO+Shift+F4","VO+Home"]) {
          await session.press(chord); start.commands!.push(chord); start.speech = spoken(await session.listen());
        }
        start.aligned = hearsHeading(start.speech,start.anchor!);
        for (let i = 0; i < 20 && !start.aligned; i++) {
          await session.press("VO+Cmd+H"); start.commands!.push("VO+Cmd+H"); start.speech = spoken(await session.listen());
          start.aligned = hearsHeading(start.speech,start.anchor!);
          if (/Heading not found|No (more )?headings|Last heading/.test(start.speech.join(" "))) break;
        }
      }
      if (!start.aligned) alignmentError = "cannot reach the first unique native heading; public sample preserved as failed";
    } else if (item.url) {
      // Safari DOM focus can leave native focus on a previous object. AX focus also brings the web area into focus.
      await machine.exec("osascript", ["-e", 'tell application "System Events" to tell process "Safari"\nset webArea to UI element 1 of scroll area 1 of group 1 of group 1 of tab group 1 of splitter group 1 of window 1\nset focused of webArea to true\nset focused of button "Before marker" of webArea to true\nend tell']);
      startAx = await dumpAxTree(machine, browserApps[browser]);
      if (!values["no-ax"]) {
        start.axPath = await saveAxSnapshot(out,attemptId,'marker-focus',startAx);
      }
      const focus = focusedAxNode(startAx);
      if (focus?.AXRole === "AXButton" && focus.AXTitle === START_MARKER && focus.AXDOMIdentifier === "vo-corpus-public-before") {
        await session.press("VO+Shift+F4"); start.commands!.push("VO+Shift+F4");
        start.speech = spoken(await session.listen());
        start.aligned = start.speech.join(" ").includes(START_MARKER);
      } else alignmentError = "native keyboard focus did not reach the injected start marker";
    } else for (let attempt = 0; attempt < 2 && !start.aligned; attempt++) {
      if (attempt === 1 && item.captureAxAfterSteps) {
        // A dismissed OS alert can leave the VO cursor outside Safari. Recover only from proven page keyboard focus.
        const focus = focusedAxNode(await dumpAxTree(machine, browserApps[browser]));
        if (focus?.AXRole === "AXButton" && focus.AXTitle === START_MARKER) {
          await session.press("VO+Shift+F4");
          start.commands!.push("VO+Shift+F4");
          start.speech = spoken(await session.listen());
          start.aligned = start.speech.join(" ").includes(START_MARKER);
          session.drain();
          // Home can return to a cookie/banner group even after focus synchronization reached the marker.
          if (start.aligned) break;
        }
      }
      await session.press("VO+Home");
      start.commands!.push("VO+Home");
      const speech = spoken(await session.listen());
      start.aligned = speech.join(" ").includes(START_MARKER);
      start.speech = speech;
    }
    if (start.aligned && item.captureAxAfterSteps) {
      await session.press("VO+Cmd+F4");
      start.commands!.push("VO+Cmd+F4");
      start.speech.push(...spoken(await session.listen()));
      try {
        startAx = await dumpAxTree(machine, browserApps[browser]);
        if (!values["no-ax"]) {
          start.axPath = await saveAxSnapshot(out,attemptId,'verified-focus',startAx);
        }
        const focused = focusedAxNode(startAx);
        if (focused?.AXRole !== "AXButton" || focused.AXTitle !== START_MARKER) {
          alignmentError = "keyboard focus is outside the start marker after VO+Cmd+F4";
          start.aligned = false;
        }
      } catch (error) {
        alignmentError = `cannot verify start keyboard focus: ${(error as Error).message}`;
        start.aligned = false;
      }
    }
    const axPath = join(out, "ax", (item.page || item.id).replace(/[\\/]/g, "_").replace(/\.html$/, ".json"));
    if (start.aligned && !values["no-ax"] && !existsSync(axPath)) {
      try { await writeFile(axPath, JSON.stringify(startAx ?? await dumpAxTree(machine, browserApps[browser])),{flag:'wx'}); }
      catch (error) { console.log(`  ! AX dump failed for ${item.page}: ${(error as Error).message}`); }
    }
    const record: CaseRecord = { caseSet: set.id, caseId: item.id, source: "voiceover", attemptId,captureSessionId,receiptClockOrigin:session.startedAt,start, steps: [], ...(pageContext ? { pageContext } : {}) };
    if (start.aligned) {
      aligned++;
      let beforeAxPath = start.axPath;
      for (const [stepIndex, chord] of item.chords.entries()) {
        const requestedAt = session.now();
        await session.press(chord);
        const acknowledgedAt = session.now();
        const heard = await session.listen(item.listen);
        const step: CaseRecord["steps"][number] = { chord, utterances: heard.utterances, reason: heard.reason,
          ...(beforeAxPath?{beforeAxPath}:{}), timing:{requestedAt,acknowledgedAt,observationStartedAt:heard.startedAt,observationEndedAt:heard.endedAt} };
        if (item.captureAxAfterSteps && !values["no-ax"]) {
          try {
            step.axPath = await saveAxSnapshot(out,attemptId,`step-${stepIndex+1}`,await dumpAxTree(machine,browserApps[browser]));
          } catch (error) { step.axError = (error as Error).message; }
          step.utterances.push(...session.takeBuffered());
        }
        beforeAxPath = step.axPath;
        record.steps.push(step);
        await appendFile(join(out,"steps.jsonl"),JSON.stringify({schemaVersion:1,source:"voiceover",caseSet:set.id,caseId:item.id,attemptId,captureSessionId,receiptClockOrigin:session.startedAt,stepIndex,...step})+"\n");
      }
    } else record.error = alignmentError ?? "start marker not heard after VO+Home";
    await appendFile(records, JSON.stringify(record) + "\n");
    // Public samples retain failed starts in the denominator and continue to the next preselected URL.
    if (!item.url && (alignmentError || !start.aligned && item.captureAxAfterSteps)) throw new Error(`${item.id}: ${alignmentError ?? record.error}; workflow keys were not pressed`);
    const target = record.steps.flatMap(s => s.utterances).find(u => u.text.trim() && !/^(Before marker|After marker|You are currently)/.test(u.text.trim()));
    const last = record.steps.at(-1);
    console.log(`[${index + 1}/${todo.length}] ${item.id}${start.aligned ? "" : "  ! misaligned"}${item.axes.partition==='test'?'  [test outputs retained; not printed]':`  target: ${target?.text.trim() ?? "(none)"}  last: ${last ? last.utterances.map(u => u.text.trim()).filter(Boolean).join(" | ") : ""}`}${record.steps.some(s => s.axError) ? "  ! step AX missing" : ""}`);
  }
} finally {
  await session.close();
  await pages.close();
  const minutes = (Date.now() - started) / 60_000;
  console.log(`${aligned}/${todo.length} aligned in ${minutes.toFixed(1)} min`);
}
