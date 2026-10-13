/**
 * Runs a case set on Rawstep's VoiceOver simulator and writes records in the same shape as collect.ts (source "simulator").
 *   tsx src/replay.ts --cases data/cases/elements-v1 [--filter re] [--limit n]
 *
 * Drives the simulator through its public run API with a policy that plays the case's chords as intents. One headless
 * Chromium per case, pages opened as file URLs. Compare with `tsx src/compare.ts`.
 *
 * Chord mapping: VO+Right next, VO+Left previous, VO+Space activate, VO+Cmd+H heading.next, VO+Cmd+J form.next,
 * Tab / Shift+Tab / Enter / Space / Escape as browser keys. Anything else is recorded "unsupported" with no utterances.
 * VO+Home: a freshly loaded page puts the simulated cursor on its first object, so the start chord is `readCurrent`
 * (no move); the start check then needs "Before marker" in that speech. The page-load title announcement is discarded,
 * as the live runner discards auto-read.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { resolveTask, type Decision, type DecisionPolicy, type PolicyAction } from "rawstep";
import { MOCK_VOICEOVER_PROFILE, runMockVoiceOverTask } from "rawstep/mock-voiceover";
import { START_MARKER, type CaseRecord, type CaseSet } from "./cases.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const chordActions: Record<string, PolicyAction> = {
  "VO+Right": { kind: "intent", intent: "next" },
  "VO+Left": { kind: "intent", intent: "previous" },
  "VO+Space": { kind: "intent", intent: "activate" },
  "VO+Cmd+H": { kind: "intent", intent: "heading.next" },
  "VO+Cmd+J": { kind: "intent", intent: "form.next" },
  ...Object.fromEntries(["Tab", "Shift+Tab", "Enter", "Space", "Escape"].map(key => [key, { kind: "key", key } as PolicyAction])),
};
const startAction: PolicyAction = { kind: "intent", intent: "readCurrent" };

/** Plays `actions` in order (null = unsupported, skipped) and keeps what each observation said. */
class ChordPolicy implements DecisionPolicy {
  /** One entry per played action, in order: speech and ms since the case began. */
  readonly heard: { speech: string[]; t: number; failed: boolean }[] = [];
  private index = 0;
  constructor(private readonly actions: (PolicyAction | null)[], private readonly began: number) {}
  decide({ observation, history }: Parameters<DecisionPolicy["decide"]>[0]): Decision {
    if (this.index > 0) {
      const last = history.at(-1);
      this.heard.push({ speech: observation.kind === "screenreader" ? [...observation.speech] : [], t: Date.now() - this.began, failed: last?.execution?.ok === false });
    }
    while (this.index < this.actions.length) {
      const action = this.actions[this.index++]!;
      if (action) return { action };
      this.heard.push({ speech: [], t: Date.now() - this.began, failed: true }); // unsupported: nothing played
    }
    return { stop: "uncertain" };
  }
}

async function replayCase(item: CaseSet["cases"][number], set: CaseSet, casesDir: string): Promise<CaseRecord> {
  const record: CaseRecord = { caseSet: set.id, caseId: item.id, source: "simulator", start: { aligned: false, speech: [] }, steps: [] };
  const began = Date.now();
  const run = async (actions: (PolicyAction | null)[]) => {
    const policy = new ChordPolicy(actions, began);
    const task = resolveTask({
      url: pathToFileURL(join(casesDir, item.page)).href, goal: "Replay recorded chords.", maxSteps: actions.length + 1, timeoutMs: 60_000,
      verify: { all: [{ titleIncludes: "\u0000never" }] },
    }, casesDir);
    const outDir = await mkdtemp(join(tmpdir(), "vo-replay-"));
    try { await runMockVoiceOverTask(task, { policy, outDir, warn: () => {} }); } finally { await rm(outDir, { recursive: true, force: true }); }
    return policy.heard;
  };
  try {
    // One browser per case: start check first, chords only when aligned, as the live runner does. Both ride the same page load.
    const actions = [startAction, ...item.chords.map(chord => chordActions[chord] ?? null)];
    const heard = await run(actions);
    const [first, ...rest] = heard;
    const speech = first?.speech ?? [];
    record.start = { aligned: speech.join(" ").includes(START_MARKER), speech };
    if (!record.start.aligned) { record.error = "start marker not heard on first object"; return record; }
    item.chords.forEach((chord, i) => {
      const got = rest[i];
      const unsupported = !chordActions[chord] || !got || got.failed;
      record.steps.push({
        chord, reason: unsupported ? "unsupported" : "quiet",
        utterances: unsupported ? [] : got.speech.filter(text => text.trim()).map(text => ({ t: got.t, text })),
      });
    });
  } catch (error) { record.error = (error as Error).message; }
  return record;
}

const { values } = parseArgs({ options: { cases: { type: "string" }, filter: { type: "string" }, limit: { type: "string" } } });
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const casesDir = resolve(packageRoot, values.cases ?? "");
  const set = JSON.parse(await readFile(join(casesDir, "cases.json"), "utf8").catch(() => { throw new Error("Pass --cases <dir with cases.json>"); })) as CaseSet;
  const filter = values.filter ? new RegExp(values.filter) : undefined;
  const todo = set.cases.filter(c => !filter || filter.test(c.id)).slice(0, values.limit ? Number(values.limit) : undefined);
  const out = join(packageRoot, "data/runs", `${set.id}-sim-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(out, { recursive: true });
  const rawstepVersion = (JSON.parse(await readFile(new URL("../node_modules/rawstep/package.json", import.meta.url), "utf8")) as { version: string }).version;
  await writeFile(join(out, "meta.json"), JSON.stringify({
    caseSet: set.id, casesGeneratedAt: set.generatedAt, casesDir: casesDir.slice(packageRoot.length + 1), source: "simulator",
    simulatorProfile: MOCK_VOICEOVER_PROFILE, rawstepVersion, startedAt: new Date().toISOString(),
  }, null, 2));
  const lines: string[] = [];
  const started = Date.now();
  let aligned = 0;
  {
    for (const [index, item] of todo.entries()) {
      const t0 = Date.now();
      const record = await replayCase(item, set, casesDir);
      if (record.start.aligned) aligned++;
      lines.push(JSON.stringify(record));
      await writeFile(join(out, "records.jsonl"), lines.join("\n") + "\n");
      const last = record.steps.at(-1);
      console.log(`[${index + 1}/${todo.length}] ${item.id} ${Date.now() - t0}ms${record.error ? `  ! ${record.error}` : ""}  ${last ? last.utterances.map(u => u.text.trim()).join(" | ") || `(${last.reason})` : ""}`);
    }
  }
  console.log(`${aligned}/${todo.length} aligned in ${((Date.now() - started) / 1000).toFixed(1)} s -> ${out}`);
}
