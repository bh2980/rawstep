/**
 * Compares a live VoiceOver run with a simulator run of the same case set, step by step.
 *   tsx src/compare.ts <voiceoverRunDir> <simulatorRunDir> [--out report.md]
 *
 * Joins records by caseId and step index. Known hint utterances are listed apart and never scored; subsequent main
 * announcements stay in the comparison. Scoring: exact,
 * normalized (lowercase, no commas/periods, collapsed spaces), else a token diff. A VoiceOver text with Hangul against a
 * simulator text without is a possible language mismatch, counted apart. Privacy-redacted output is not scored.
 * Writes report.md and compare.json (default: inside the simulator run dir).
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Case, CaseRecord, CaseSet } from "./cases.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type Verdict = "exact" | "normalized" | "language" | "mismatch" | "unsupported" | "redacted" | "missing";
export interface StepRow {
  caseId: string; step: number; chord: string; axes: Record<string, string>; verdict: Verdict;
  voiceover?: string; simulator?: string; voiceoverHint: string; simulatorHint: string;
  /** Tokens only VoiceOver / only the simulator said (normalized). */
  onlyVoiceover: string[]; onlySimulator: string[];
  /** 2 * longest common token run / (tokens in both texts): 1 = same tokens in the same order. */
  tokenSimilarity: number;
}

const hintStart = /^\s*(현재 |You are currently|To open the autofill menu,)/;
const hangul = /[ㄱ-ㆎ가-힣]/;

/** Classify each receipt: typing and delayed updates can arrive after a usage hint. */
export function splitSpeech(utterances: { text: string }[]): { main: string; hint: string } {
  const texts = utterances.map(u => u.text.trim()).filter(Boolean);
  return { main: texts.filter(text => !hintStart.test(text)).join(" "), hint: texts.filter(text => hintStart.test(text)).join(" ") };
}

export const normalize = (text: string): string => text.toLowerCase().replace(/[,.，。]/g, " ").replace(/\s+/g, " ").trim();

/** Longest common subsequence of tokens, as the matched pairs of indices. */
function lcs(a: string[], b: string[]): [number, number][] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { pairs.push([i++, j++]); } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++; else j++;
  }
  return pairs;
}

export function tokenDiff(voiceover: string, simulator: string) {
  const a = normalize(voiceover).split(" ").filter(Boolean), b = normalize(simulator).split(" ").filter(Boolean);
  const pairs = lcs(a, b);
  const inA = new Set(pairs.map(p => p[0])), inB = new Set(pairs.map(p => p[1]));
  return {
    onlyVoiceover: a.filter((_, i) => !inA.has(i)), onlySimulator: b.filter((_, i) => !inB.has(i)),
    tokenSimilarity: a.length + b.length === 0 ? 1 : (2 * pairs.length) / (a.length + b.length),
  };
}

async function readRun(dir: string) {
  const records = new Map<string, CaseRecord>();
  for (const line of (await readFile(join(dir, "records.jsonl"), "utf8")).split("\n")) if (line.trim()) { const r = JSON.parse(line) as CaseRecord; records.set(r.caseId, r); }
  const meta = existsSync(join(dir, "meta.json")) ? JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as Record<string, unknown> : {};
  return { records, meta };
}

async function loadAxes(...metas: Record<string, unknown>[]): Promise<Map<string, Case>> {
  for (const meta of metas) {
    const path = typeof meta.casesDir === "string" ? join(packageRoot, meta.casesDir, "cases.json") : "";
    if (path && existsSync(path)) return new Map((JSON.parse(await readFile(path, "utf8")) as CaseSet).cases.map(c => [c.id, c]));
  }
  return new Map();
}

export function compareRuns(vo: Map<string, CaseRecord>, sim: Map<string, CaseRecord>, cases: Map<string, Case>) {
  const rows: StepRow[] = [];
  const caseInfo: { caseId: string; axes: Record<string, string>; aligned: boolean }[] = [];
  for (const [caseId, a] of vo) {
    const b = sim.get(caseId);
    if (!b) continue;
    const axes = cases.get(caseId)?.axes ?? {};
    const aligned = a.start.aligned && b.start.aligned;
    caseInfo.push({ caseId, axes, aligned });
    if (!aligned) continue;
    const count = Math.max(a.steps.length, b.steps.length);
    for (let step = 0; step < count; step++) {
      const x = a.steps[step], y = b.steps[step];
      const chord = x?.chord ?? y?.chord ?? "";
      const xs = x ? splitSpeech(x.utterances) : undefined, ys = y ? splitSpeech(y.utterances) : undefined;
      const diff = tokenDiff(xs?.main ?? "", ys?.main ?? "");
      let verdict: Verdict;
      if (!x || !y || x.chord !== y.chord) verdict = "missing";
      else if (y.reason === "unsupported") verdict = "unsupported";
      else if (/\[(?:typed input withheld|REDACTED)\]/.test(ys!.main)) verdict = "redacted";
      else if (xs!.main === ys!.main) verdict = "exact";
      else if (normalize(xs!.main) === normalize(ys!.main)) verdict = "normalized";
      else if (hangul.test(xs!.main) && !hangul.test(ys!.main)) verdict = "language";
      else verdict = "mismatch";
      rows.push({
        caseId, step, chord, axes, verdict, voiceover: xs?.main, simulator: ys?.main, voiceoverHint: xs?.hint ?? "", simulatorHint: ys?.hint ?? "", ...diff,
      });
    }
  }
  return { rows, caseInfo };
}

const count = (rows: StepRow[], verdict: Verdict) => rows.filter(r => r.verdict === verdict).length;
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");
const cell = (text: string | undefined) => (text ?? "(none)").replace(/\|/g, "\\|").replace(/\n/g, " ");

function axisTable(axis: string, rows: StepRow[], caseInfo: { axes: Record<string, string>; aligned: boolean }[]): string {
  const keys = [...new Set(caseInfo.map(c => c.axes[axis] ?? "?"))].sort();
  const lines = [`| ${axis} | cases | aligned | steps | matched | language | unsupported | redacted | mismatch | match rate |`, "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"];
  for (const key of keys) {
    const cs = caseInfo.filter(c => (c.axes[axis] ?? "?") === key), rs = rows.filter(r => (r.axes[axis] ?? "?") === key);
    const matched = count(rs, "exact") + count(rs, "normalized"), lang = count(rs, "language"), uns = count(rs, "unsupported"), mis = count(rs, "mismatch");
    lines.push(`| ${key} | ${cs.length} | ${cs.filter(c => c.aligned).length} | ${rs.length} | ${matched} | ${lang} | ${uns} | ${count(rs, "redacted")} | ${mis} | ${pct(matched, matched + mis)} |`);
  }
  return lines.join("\n");
}

export function renderReport(rows: StepRow[], caseInfo: { caseId: string; axes: Record<string, string>; aligned: boolean }[], names: { vo: string; sim: string }): string {
  const matched = count(rows, "exact") + count(rows, "normalized"), mis = count(rows, "mismatch");
  const worst = rows.filter(r => r.verdict === "mismatch").sort((p, q) => p.tokenSimilarity - q.tokenSimilarity || p.caseId.localeCompare(q.caseId)).slice(0, 30);
  return [
    "# VoiceOver vs simulator", "",
    `VoiceOver run: \`${names.vo}\`  `, `Simulator run: \`${names.sim}\``, "",
    "Match rate = (exact + normalized) / (exact + normalized + mismatch). Language-mismatch steps, unsupported chords, privacy-redacted observations and unaligned cases are counted apart. Known hint receipts are not scored; later main receipts are preserved. Redaction is never disabled for comparison.", "",
    "## Overall", "",
    `- cases in both runs: ${caseInfo.length}, aligned in both: ${caseInfo.filter(c => c.aligned).length}`,
    `- steps compared: ${rows.length}`,
    `- exact: ${count(rows, "exact")}, normalized: ${count(rows, "normalized")}, language mismatch: ${count(rows, "language")}, unsupported by simulator: ${count(rows, "unsupported")}, privacy redacted: ${count(rows, "redacted")}, step missing: ${count(rows, "missing")}, mismatch: ${mis}`,
    `- match rate (excluding language, unsupported, redacted, missing): ${pct(matched, matched + mis)}`, "",
    `- scoreable comparison coverage: ${pct(matched + mis, rows.length)} (${matched + mis}/${rows.length} compared steps)`,
    `- matches among all compared steps: ${pct(matched, rows.length)} (${matched}/${rows.length}); includes silence and marker navigation`,
    "These are wording comparisons on this fixture set, not an overall VoiceOver fidelity score. Unaligned and absent cases are outside the compared-step denominator.", "",
    "## By role", "", axisTable("role", rows, caseInfo), "",
    "## By command", "", axisTable("command", rows, caseInfo), "",
    `## Worst ${worst.length} mismatches`, "",
    "| case | step | chord | VoiceOver | simulator | only VoiceOver | only simulator |", "| --- | ---: | --- | --- | --- | --- | --- |",
    ...worst.map(r => `| ${r.caseId} | ${r.step} | ${r.chord} | ${cell(r.voiceover)} | ${cell(r.simulator)} | ${cell(r.onlyVoiceover.join(" "))} | ${cell(r.onlySimulator.join(" "))} |`), "",
    "## Hints (not scored)", "",
    "Steps where either side spoke a hint, up to 15. Real VoiceOver adds hints as a later utterance; the simulator has none.", "",
    "| case | step | VoiceOver hint | simulator hint |", "| --- | ---: | --- | --- |",
    ...rows.filter(r => r.voiceoverHint || r.simulatorHint).slice(0, 15).map(r => `| ${r.caseId} | ${r.step} | ${cell(r.voiceoverHint)} | ${cell(r.simulatorHint)} |`), "",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values, positionals } = parseArgs({ options: { out: { type: "string" } }, allowPositionals: true });
  const [voDir, simDir] = positionals.map(p => resolve(p));
  if (!voDir || !simDir) throw new Error("Usage: tsx src/compare.ts <voiceoverRunDir> <simulatorRunDir> [--out report.md]");
  const vo = await readRun(voDir), sim = await readRun(simDir);
  const { rows, caseInfo } = compareRuns(vo.records, sim.records, await loadAxes(vo.meta, sim.meta));
  const out = resolve(values.out ?? join(simDir, "report.md"));
  await writeFile(out, renderReport(rows, caseInfo, { vo: voDir, sim: simDir }));
  await writeFile(join(dirname(out), "compare.json"), JSON.stringify({ voiceoverRun: voDir, simulatorRun: simDir, cases: caseInfo, rows }, null, 1));
  console.log(`${caseInfo.length} cases, ${rows.length} steps -> ${out}`);
}
