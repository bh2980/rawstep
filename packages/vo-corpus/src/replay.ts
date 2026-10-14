/**
 * Runs a case set on Rawstep's VoiceOver simulator and writes records in the same shape as collect.ts (source "simulator").
 *   tsx src/replay.ts --cases data/cases/elements-v1 [--filter re] [--limit n]
 *
 * Drives the simulator through its public run API with a policy that plays the case's chords as intents. One headless
 * Chromium per case, pages opened as file URLs. Compare with `tsx src/compare.ts`.
 *
 * Chord mapping: VO+Right next, VO+Left previous, VO+Space activate, VO+Cmd+H heading.next, VO+Cmd+J form.next,
 * Tab / Shift+Tab / Enter / Space / Escape as browser keys, lowercase ASCII letters/digits as text entry.
 * Unsupported commands mark the whole case unsupported. Explicit minimum windows poll delayed live updates.
 * VO+Home: a freshly loaded page puts the simulated cursor on its first object, so the start chord is `readCurrent`
 * (no move); the start check then needs "Before marker" in that speech. The page-load title announcement is discarded,
 * as the live runner discards auto-read.
 */
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { resolveTask, type Decision, type DecisionPolicy, type PolicyAction } from "rawstep";
import { MOCK_VOICEOVER_PROFILE, runMockVoiceOverTask } from "rawstep/mock-voiceover";
import { createBrowserSession } from "rawstep/browser";
import { publicPageScript, realPageContext, accessiblePageContext, chromiumAccessibleText, hearsHeading } from "./real-pages.js";
import { fixtureStateScript, type PageState } from "./state.js";
import { START_MARKER, casesFingerprint, type CaseRecord, type CaseSet } from "./cases.js";
import { archiveCaseInputs } from "./archive.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const chordActions: Record<string, PolicyAction> = {
  "VO+Right": { kind: "intent", intent: "next" },
  "VO+Left": { kind: "intent", intent: "previous" },
  "VO+Space": { kind: "intent", intent: "activate" },
  "VO+Cmd+H": { kind: "intent", intent: "heading.next" },
  "VO+Cmd+Shift+H": { kind: "intent", intent: "heading.previous" },
  "VO+Cmd+J": { kind: "intent", intent: "form.next" },
  ...Object.fromEntries(["Tab", "Shift+Tab", "Enter", "Space", "Escape"].map(key => [key, { kind: "key", key } as PolicyAction])),
  ...Object.fromEntries(["Up", "Down", "Left", "Right"].map(key => [key, { kind: "key", key: "Arrow" + key } as PolicyAction])),
  ...Object.fromEntries(["Home", "End", "Shift+Home", "Shift+End", "Backspace", "Delete"].map(key => [key, { kind: "key", key } as PolicyAction])),
  "Cmd+A": { kind: "key", key: "ControlOrMeta+A" },
};
const startAction: PolicyAction = { kind: "intent", intent: "readCurrent" };

/** The mock supports text entry, but does not expose arbitrary browser keys as policy actions. */
export function replayAction(chord: string, input: string): PolicyAction | null {
  if (/^[a-z0-9]$/.test(chord)) return { kind: "typeText", input };
  return chordActions[chord] ?? null;
}

/** Plays `actions` in order (null = unsupported, skipped) and keeps what each observation said. */
class ChordPolicy implements DecisionPolicy {
  /** One entry per played action, in order: speech and ms since the case began. */
  readonly heard: { speech: string[]; t: number; failed: boolean; state?: PageState }[] = [];
  private index = 0;
  private headingAttempts = 0;
  private headingReady = false;
  constructor(private readonly actions: (PolicyAction | null)[], private readonly began: number, private readonly readState?: () => Promise<PageState>, private readonly anchor?: CaseRecord["start"]["anchor"]) {}
  async decide({ observation, history }: Parameters<DecisionPolicy["decide"]>[0]): Promise<Decision> {
    let justAligned = false;
    if (this.anchor && !this.headingReady) {
      if (this.headingAttempts++ === 0) return {action:startAction};
      const speech = observation.kind === "screenreader" ? [...observation.speech] : [];
      if (hearsHeading(speech,this.anchor)) {
        this.headingReady = true; this.index = 1; justAligned = true;
        this.heard.push({speech,t:Date.now()-this.began,failed:false});
      } else if (this.headingAttempts <= 20) return {action:{kind:"intent",intent:"heading.next"}};
      else { this.heard.push({speech,t:Date.now()-this.began,failed:true}); return {stop:"uncertain"}; }
    }
    if (this.index > 0 && !justAligned) {
      const last = history.at(-1);
      this.heard.push({ speech: observation.kind === "screenreader" ? [...observation.speech] : [], t: Date.now() - this.began, failed: last?.execution?.ok === false, ...(this.readState ? { state: await this.readState() } : {}) });
    }
    while (this.index < this.actions.length) {
      const action = this.actions[this.index++]!;
      if (action) return { action };
      this.heard.push({ speech: [], t: Date.now() - this.began, failed: true }); // unsupported: nothing played
    }
    return { stop: "uncertain" };
  }
}

export async function replayCase(item: CaseSet["cases"][number], set: CaseSet, casesDir: string, anchor?: CaseRecord["start"]["anchor"]): Promise<CaseRecord> {
  const record: CaseRecord = { caseSet: set.id, caseId: item.id, source: "simulator", start: { aligned: false, speech: [] }, steps: [] };
  const began = Date.now();
  if (item.startProtocol === "first-heading" && !anchor) { record.error="Native heading anchor unavailable; public sample preserved as failed"; return record; }
  const mapped = item.chords.map((chord, i) => replayAction(chord, `stroke-${i}`));
  const inputs = Object.fromEntries(item.chords.flatMap((chord, i) => /^[a-z0-9]$/.test(chord) ? [[`stroke-${i}`, chord]] : []));
  // Skipping one key changes the remainder of a workflow. Do not score later actions in a different state.
  const unsupported = mapped.some(a => !a) ? "case contains a command unsupported by the simulator" : undefined;
  const run = async (actions: (PolicyAction | null)[]) => {
    let readState: (() => Promise<PageState>) | undefined;
    const policy = new ChordPolicy(actions, began, set.syntheticInputs ? async () => { if (!readState) throw new Error("Fixture state channel unavailable"); return readState(); } : undefined,anchor);
    const task = resolveTask({
      url: item.url ?? pathToFileURL(join(casesDir, item.page)).href, goal: "Replay recorded chords.", maxSteps: actions.length + (anchor?21:1), timeoutMs: item.url?120_000:60_000,
      verify: { all: [{ titleIncludes: "\u0000never" }] },
      ...(item.url ? { navigation: { strategy: "same-origin" as const, readOnly: true } } : {}),
      input: inputs,
      ...(set.syntheticInputs ? { inputOptions: Object.fromEntries(Object.keys(inputs).map(key => [key, { sensitive: false, description: "Public generated fixture character" }])) } : {}),
    }, casesDir);
    const outDir = await mkdtemp(join(tmpdir(), "vo-replay-"));
    try { await runMockVoiceOverTask(task, { policy, outDir, warn: () => {}, observationMinWaitMs: item.listen?.minWaitMs,
      ...(item.url || set.syntheticInputs ? { browserSessionFactory: async (url, options) => {
        const session = await createBrowserSession(url, options);
        try {
          if (item.url) {
            if (item.viewport) await session.page.setViewportSize(item.viewport);
            await session.page.waitForTimeout(2000);
            if (item.startProtocol === "first-heading") {
              const cdp = await session.context.newCDPSession(session.page);
              try {
                await cdp.send("Accessibility.enable");
                const tree = await cdp.send("Accessibility.getFullAXTree");
                const info = await session.page.evaluate(() => ({url:location.href,title:document.title,width:innerWidth,height:innerHeight}));
                record.pageContext = accessiblePageContext(chromiumAccessibleText(tree.nodes),info);
              } finally { await cdp.detach(); }
            } else {
              const script = publicPageScript(item.contentProtocol);
              record.pageContext = realPageContext(await session.page.evaluate(script),script);
            }
          }
          if (set.syntheticInputs) readState = () => session.page.evaluate(fixtureStateScript);
          return session;
        } catch (error) { await session.close(); throw error; }
      } } : {}),
    }); } finally { await rm(outDir, { recursive: true, force: true }); }
    return policy.heard;
  };
  try {
    // One browser per case: start check first, chords only when aligned, as the live runner does. Both ride the same page load.
    const actions = [startAction, ...(unsupported ? [] : mapped)];
    const heard = await run(actions);
    const [first, ...rest] = heard;
    const speech = first?.speech ?? [];
    record.start = { aligned: anchor ? !!first && !first.failed && hearsHeading(speech,anchor) : speech.join(" ").includes(START_MARKER), speech, ...(anchor?{anchor}:{}) };
    if (!record.start.aligned) { record.error = anchor?"native unique heading not reached":"start marker not heard on first object"; return record; }
    if (unsupported) record.unsupportedReason = unsupported;
    let blocked = !!unsupported;
    item.chords.forEach((chord, i) => {
      const got = rest[i];
      blocked ||= !mapped[i] || !got || got.failed;
      record.steps.push({
        chord, reason: blocked ? "unsupported" : "quiet",
        utterances: blocked ? [] : got!.speech.filter(text => text.trim()).map(text => ({ t: got!.t, text })),
        ...(!blocked && got?.state ? { state: got.state } : {}),
      });
    });
  } catch (error) { record.error = (error as Error).message; }
  return record;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({ options: { cases: { type: "string" }, filter: { type: "string" }, limit: { type: "string" }, "anchors-native-run": {type:"string"} } });
  const casesDir = resolve(packageRoot, values.cases ?? "");
  const set = JSON.parse(await readFile(join(casesDir, "cases.json"), "utf8").catch(() => { throw new Error("Pass --cases <dir with cases.json>"); })) as CaseSet;
  const filter = values.filter ? new RegExp(values.filter) : undefined;
  const todo = set.cases.filter(c => !filter || filter.test(c.id)).slice(0, values.limit ? Number(values.limit) : undefined);
  if (todo.some(c=>c.startProtocol==="first-heading") && !values["anchors-native-run"]) throw new Error("Natural public-page replay requires --anchors-native-run <native run directory>");
  const anchorRecords = values["anchors-native-run"] ? await readFile(join(resolve(values["anchors-native-run"]),"records.jsonl"),"utf8") : "";
  const anchors = new Map(anchorRecords.split("\n").filter(Boolean).map(line=>{const r=JSON.parse(line) as CaseRecord;if(r.caseSet!==set.id||r.source!=="voiceover")throw new Error("Native anchor source differs from public cases");return [r.caseId,r.start.anchor] as const}));
  const out = join(packageRoot, "data/runs", `${set.id}-sim-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(dirname(out),{recursive:true});await mkdir(out);
  const casesSha256=await casesFingerprint(casesDir,set),inputArchive=await archiveCaseInputs(casesDir,out,set,casesSha256);
  const capturedCasesDir=join(out,'inputs');
  const rawstepVersion = (JSON.parse(await readFile(new URL("../node_modules/rawstep/package.json", import.meta.url), "utf8")) as { version: string }).version;
  const dist = fileURLToPath(new URL("../node_modules/rawstep/dist/", import.meta.url)), buildHash = createHash("sha256");
  for (const path of (await readdir(dist, { recursive: true })).filter(p => p.endsWith(".js")).sort()) buildHash.update(path).update(await readFile(join(dist, path)));
  await writeFile(join(out, "meta.json"), JSON.stringify({
    caseSet: set.id, casesGeneratedAt: set.generatedAt, casesSha256, inputArchive, casesDir: casesDir.slice(packageRoot.length + 1), source: "simulator",
    simulatorProfile: MOCK_VOICEOVER_PROFILE, simulatorBuildSha256: buildHash.digest("hex"), rawstepVersion, startedAt: new Date().toISOString(),
    ...(anchorRecords?{anchorSourceSha256:createHash("sha256").update(anchorRecords).digest("hex"),anchorSourceRun:resolve(values["anchors-native-run"]!)}:{}),
  }, null, 2));
  const started = Date.now();
  let aligned = 0;
  {
    for (const [index, item] of todo.entries()) {
      const t0 = Date.now();
      const record = await replayCase(item, set, capturedCasesDir, anchors.get(item.id));
      if (record.start.aligned) aligned++;
      await appendFile(join(out,"records.jsonl"),JSON.stringify(record)+'\n');
      const last = record.steps.at(-1);
      console.log(`[${index + 1}/${todo.length}] ${item.id} ${Date.now() - t0}ms${record.error ? `  ! ${record.error}` : ""}${item.axes.partition==='test'?'  [test outputs retained; not printed]':`  ${last ? last.utterances.map(u => u.text.trim()).join(" | ") || `(${last.reason})` : ""}`}`);
    }
  }
  console.log(`${aligned}/${todo.length} aligned in ${((Date.now() - started) / 1000).toFixed(1)} s -> ${out}`);
}
