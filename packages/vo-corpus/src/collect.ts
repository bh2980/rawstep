/**
 * Runs a case set on a live VoiceOver and appends one CaseRecord per case to <run>/records.jsonl.
 *   tsx src/collect.ts --vm vo-collector --cases data/cases/elements-v1
 *   tsx src/collect.ts --vm vo-collector --resume data/runs/elements-v1-<time>     (skips cases already recorded)
 *
 * Per case: load the page (auto-read speaks it all; that speech is discarded), VO+Home to the start marker, check the
 * speech names it, then press the case's chords and record what each one said. The native AX tree of each page is dumped
 * once, next to the records. Stops the whole run (never skips past) when the browser is not in front or the AT Driver
 * connection drops: keys must never land anywhere else.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { dumpAxTree } from "./axdump.js";
import { START_MARKER, type CaseRecord, type CaseSet } from "./cases.js";
import { atDriverUrl, browserApps, machineFacts, navigateBrowser, requireFrontmost, resolveMachine, serveDirectory, type BrowserName } from "./host.js";
import { spoken, VoSession } from "./session.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: {
  vm: { type: "string" },
  url: { type: "string" },
  browser: { type: "string", default: "safari" },
  cases: { type: "string" },
  resume: { type: "string" },
  filter: { type: "string" },
  limit: { type: "string" },
  settings: { type: "string", default: "baseline-v1" },
  "no-ax": { type: "boolean", default: false },
} });
const browser = values.browser as BrowserName;
if (!(browser in browserApps)) throw new Error(`--browser must be safari or chrome, not ${values.browser}`);

const runDir = values.resume ? resolve(values.resume) : undefined;
const meta = runDir ? JSON.parse(await readFile(join(runDir, "meta.json"), "utf8")) : undefined;
const casesDir = resolve(packageRoot, meta?.casesDir ?? values.cases ?? "");
if (!existsSync(join(casesDir, "cases.json"))) throw new Error("Pass --cases <dir with cases.json> or --resume <run dir>");
const set = JSON.parse(await readFile(join(casesDir, "cases.json"), "utf8")) as CaseSet;
const out = runDir ?? join(packageRoot, "data/runs", `${set.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(join(out, "ax"), { recursive: true });
const records = join(out, "records.jsonl");

const done = new Set<string>();
if (existsSync(records)) for (const line of (await readFile(records, "utf8")).split("\n")) if (line) done.add((JSON.parse(line) as CaseRecord).caseId);
const filter = values.filter ? new RegExp(values.filter) : undefined;
const todo = set.cases.filter(c => !done.has(c.id) && (!filter || filter.test(c.id))).slice(0, values.limit ? Number(values.limit) : undefined);

const machine = await resolveMachine(values.vm);
const guard = requireFrontmost(machine, browser);
const session = new VoSession(values.url ?? atDriverUrl(machine), guard);
const pages = await serveDirectory(casesDir, machine);
const started = Date.now();
let aligned = 0;
try {
  const negotiated = await session.start();
  if (!runDir) await writeFile(join(out, "meta.json"), JSON.stringify({
    caseSet: set.id, casesGeneratedAt: set.generatedAt, casesDir: casesDir.slice(packageRoot.length + 1),
    settings: values.settings, startedAt: new Date().toISOString(), atDriver: negotiated, machine: await machineFacts(machine, browser),
  }, null, 2));
  console.log(`${set.id}: ${todo.length} to run, ${done.size} already recorded -> ${out}`);

  for (const [index, item] of todo.entries()) {
    await navigateBrowser(machine, browser, `${pages.origin}/${item.page}`);
    await session.listen({ quietMs: 1_500, maxWaitMs: 30_000 }); // auto-read of the new page
    session.drain();
    let start = { aligned: false, speech: [] as string[] };
    for (let attempt = 0; attempt < 2 && !start.aligned; attempt++) {
      await session.press("VO+Home");
      const speech = spoken(await session.listen());
      start = { aligned: speech.join(" ").includes(START_MARKER), speech };
    }
    const axPath = join(out, "ax", item.page.replace(/[\\/]/g, "_").replace(/\.html$/, ".json"));
    if (start.aligned && !values["no-ax"] && !existsSync(axPath)) {
      try { await writeFile(axPath, JSON.stringify(await dumpAxTree(machine, browserApps[browser]))); }
      catch (error) { console.log(`  ! AX dump failed for ${item.page}: ${(error as Error).message}`); }
    }
    const record: CaseRecord = { caseSet: set.id, caseId: item.id, source: "voiceover", start, steps: [] };
    if (start.aligned) {
      aligned++;
      for (const chord of item.chords) {
        await session.press(chord);
        const heard = await session.listen();
        record.steps.push({ chord, utterances: heard.utterances, reason: heard.reason });
      }
    } else record.error = "start marker not heard after VO+Home";
    await appendFile(records, JSON.stringify(record) + "\n");
    const last = record.steps.at(-1);
    console.log(`[${index + 1}/${todo.length}] ${item.id}${start.aligned ? "" : "  ! misaligned"}  ${last ? last.utterances.map(u => u.text.trim()).filter(Boolean).join(" | ") : ""}`);
  }
} finally {
  await session.close();
  await pages.close();
  const minutes = (Date.now() - started) / 60_000;
  console.log(`${aligned}/${todo.length} aligned in ${minutes.toFixed(1)} min`);
}
