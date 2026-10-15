/** Planned-step denominator for validation: missing, unaligned, unsupported and redacted steps never disappear. */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareRuns, normalize, splitSpeech, type StepRow } from "./compare.js";
import { casesFingerprint, type CaseRecord, type CaseSet } from "./cases.js";
import { comparePageState, nativePageState, summarizeState } from "./state.js";
import type { AxDump } from "./axdump.js";
import { hearsHeading } from "./real-pages.js";
import { speechAttribution } from "./session.js";
import { verifyArchivedInputs } from "./archive.js";

type Row = Omit<StepRow, "verdict"> & { verdict: StepRow["verdict"] | "unaligned" | "environment" | "attribution"; fullSpeechMatched: boolean; markerOnly: boolean };
const markerOnly = (text: string) => /^(before|after) marker button$/.test(normalize(text));
const matched = (r: Pick<Row, "verdict">) => r.verdict === "exact" || r.verdict === "normalized";
const metric = (rows: Row[]) => ({ matched: rows.filter(matched).length, planned: rows.length, rate: rows.length ? rows.filter(matched).length / rows.length : null });
const startsAligned = (c: CaseSet["cases"][number], a: CaseRecord | undefined, b: CaseRecord | undefined) => !!a?.start.aligned && !!b?.start.aligned
  && (c.startProtocol !== "first-heading" || !!a.start.anchor && !!b.start.anchor && normalize(a.start.anchor.name) === normalize(b.start.anchor.name) && a.start.anchor.level === b.start.anchor.level && hearsHeading(a.start.speech,a.start.anchor) && hearsHeading(b.start.speech,b.start.anchor));

export function validateRuns(set: CaseSet, native: Map<string, CaseRecord>, simulator: Map<string, CaseRecord>) {
  const compared = new Map(compareRuns(native, simulator, new Map(set.cases.map(c => [c.id, c]))).rows.map(r => [`${r.caseId}:${r.step}`, r]));
  const rows: Row[] = [];
  for (const c of set.cases) for (const [step, chord] of c.chords.entries()) {
    const a = native.get(c.id), b = simulator.get(c.id), x = a?.steps[step], y = b?.steps[step];
    const base = compared.get(`${c.id}:${step}`);
    const voiceover = x ? splitSpeech(x.utterances).main : undefined, model = y ? splitSpeech(y.utterances).main : undefined;
    const aligned = startsAligned(c,a,b);
    // A stopped or reordered run cannot turn absent speech into a silence match.
    const contentSource = c.startProtocol === "first-heading" ? "accessibility-text" : c.contentProtocol;
    const environment = !x?.foregroundError&&!y?.foregroundError&&(!c.url || !!a?.pageContext && !!b?.pageContext && a.pageContext.url === b.pageContext.url && a.pageContext.contentSource === contentSource && b.pageContext.contentSource === contentSource
      && a.pageContext.contentSha256 === b.pageContext.contentSha256 && a.pageContext.width === b.pageContext.width && a.pageContext.height === b.pageContext.height
      && (!c.contentProtocol || !!a.pageContext.harnessSha256 && a.pageContext.harnessSha256 === b.pageContext.harnessSha256));
    const available = aligned && environment && x?.chord === chord && y?.chord === chord && !!base;
    const uncertain = !!x && speechAttribution(x).status === "uncertain" || !!y && speechAttribution(y).status === "uncertain";
    const verdict = !a || !b || !x || !y ? "missing" : !aligned ? "unaligned" : !environment ? "environment" : !available ? "missing" : base!.verdict === "unsupported" || base!.verdict === "redacted" ? base!.verdict : uncertain ? "attribution" : base!.verdict;
    rows.push({ ...(base ?? { caseId: c.id, step, chord, axes: c.axes, voiceover, simulator: model, voiceoverHint: x ? splitSpeech(x.utterances).hint : "", simulatorHint: y ? splitSpeech(y.utterances).hint : "", onlyVoiceover: [], onlySimulator: [], tokenSimilarity: 0 }), chord, verdict,
      fullSpeechMatched: !!available && matched({ verdict }) && normalize(x!.utterances.map(u => u.text).join(" ")) === normalize(y!.utterances.map(u => u.text).join(" ")),
      markerOnly: x !== undefined && x.chord === chord && markerOnly(voiceover ?? ""),
    });
  }
  const content = rows.filter(r => !r.markerOnly), spoken = content.filter(r => r.voiceover !== ""), silent = content.filter(r => r.voiceover === "");
  const families = Object.fromEntries([...new Set(rows.map(r => r.axes.family ?? r.axes.role ?? "unknown"))].sort().map(family => [family, metric(content.filter(r => (r.axes.family ?? r.axes.role ?? "unknown") === family))]));
  const rates = Object.values(families).flatMap(f => f.rate === null ? [] : [f.rate]);
  const comparable = rows.filter(r => ["exact", "normalized", "mismatch", "language"].includes(r.verdict));
  const plannedSteps = set.cases.flatMap(c => c.chords.map((chord, step) => ({ chord, native: native.get(c.id)?.steps[step], model: simulator.get(c.id)?.steps[step] })));
  return {
    evaluationProtocol: "voiceover-evaluation-v2",
    caseSet: set.id, casesGeneratedAt: set.generatedAt, plannedCases: set.cases.length,
    nativeCases: set.cases.filter(c => native.has(c.id)).length, simulatorCases: set.cases.filter(c => simulator.has(c.id)).length,
    alignedCases: set.cases.filter(c => startsAligned(c,native.get(c.id),simulator.get(c.id))).length,
    renderedTextDifferentCases: set.cases.filter(c => c.contentProtocol && native.get(c.id)?.pageContext?.renderedTextSha256 && simulator.get(c.id)?.pageContext?.renderedTextSha256 && native.get(c.id)!.pageContext!.renderedTextSha256 !== simulator.get(c.id)!.pageContext!.renderedTextSha256).length,
    all: metric(rows), content: metric(content), spoken: metric(spoken), silent: metric(silent),
    fullSpeech: { matched: rows.filter(r => r.fullSpeechMatched).length, planned: rows.length, rate: rows.length ? rows.filter(r => r.fullSpeechMatched).length / rows.length : null },
    funnel: {
      plannedActions: rows.length,
      nativeRecordedActions: plannedSteps.filter(s => s.native?.chord === s.chord).length,
      sameDeclaredActions: plannedSteps.filter(s => s.native?.chord === s.chord && s.model?.chord === s.chord).length,
      inputEquivalenceVerifiedActions: null,
      normallyComparableSpeech: comparable.length,
      nativeAttribution: Object.fromEntries(["bounded-window", "uncertain", "unmeasured"].map(status => [status, plannedSteps.filter(s => s.native && speechAttribution(s.native).status === status).length])),
      note: "A recorded chord and equal fixture bytes do not independently prove equivalent native/model input effects. Input equivalence is not yet instrumented; null is unknown, not zero or success.",
    },
    conditionalSpeech: metric(comparable),
    conditionalFullSpeech: { matched: comparable.filter(r => r.fullSpeechMatched).length, planned: comparable.length, rate: comparable.length ? comparable.filter(r => r.fullSpeechMatched).length / comparable.length : null },
    evaluation: {
      speechStatus: "provisional",
      normalization: "Case-fold, remove commas/periods, collapse whitespace. Full speech keeps hints, repetitions and token order but joins receipt boundaries. Raw receipts are preserved separately.",
      navigationAccuracy: { status: "unmeasured", rate: null, reason: "No independently observed native VoiceOver reading cursor; AX keyboard focus is not a substitute." },
      stateAccuracy: { status: "partial", rate: null, reason: "Only the separate bounded DOM-ID state oracle is available; selection and unidentifiable controls are not fully measured." },
      taskSuccess: { status: "unmeasured", rate: null, reason: "No independently frozen task outcome oracle." },
      thresholdAchievement: "unproven",
    },
    contentFullSpeech: { matched: content.filter(r => r.fullSpeechMatched).length, planned: content.length, rate: content.length ? content.filter(r => r.fullSpeechMatched).length / content.length : null },
    familyMacroRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    verdicts: Object.fromEntries([...new Set(rows.map(r => r.verdict))].sort().map(v => [v, rows.filter(r => r.verdict === v).length])), families, rows,
  };
}

function rate(m: { matched: number; planned: number; rate: number | null }) { return `${m.matched}/${m.planned} (${m.rate === null ? "unavailable" : (m.rate * 100).toFixed(1) + "%"})`; }
export function renderValidation(report: ReturnType<typeof validateRuns>): string {
  return ["# Planned-step validation", "", `Set: ${report.caseSet}; generated: ${report.casesGeneratedAt}`, "",
    `Cases: ${report.plannedCases} planned, ${report.nativeCases} native, ${report.simulatorCases} simulated, ${report.alignedCases} aligned in both.`, "",
    `DOM-protocol cases with different rendered-text hashes: ${report.renderedTextDifferentCases}. DOM-protocol matches require identical capture-script hash and DOM snapshot hash; rendered text remains separately recorded.`, "",
    "Every planned step is included. Missing/unaligned/unsupported/redacted/environment/uncertain-attribution steps count as failures. Live pages require equal URL, content fingerprint source/hash and viewport. Natural-anchor runs also require the same native heading anchor. AX-text fingerprints are conservative checks, not identical HTML verification; engine/content differences count as failures. Content excludes only native receipts consisting entirely of a fixture marker. Spoken includes missing native observations as failures. Main speech ignores documented usage hints; full speech includes them. Silence is reported separately. These speech rates do not establish equivalent focus, editing, activation or timing.", "",
    `- All main speech: ${rate(report.all)}`, `- Content main speech: ${rate(report.content)}`, `- Spoken content: ${rate(report.spoken)}`, `- Silence: ${rate(report.silent)}`, `- Full speech including hints: ${rate(report.fullSpeech)}`,
    `- Content full speech including hints: ${rate(report.contentFullSpeech)}`,
    `- Equal-weight family rate: ${report.familyMacroRate === null ? "unavailable" : (100 * report.familyMacroRate).toFixed(1) + "%"}`, "",
    `- Conditional main speech among comparable windows: ${rate(report.conditionalSpeech)}`,
    `- Conditional full speech among comparable windows: ${rate(report.conditionalFullSpeech)}`,
    `- Capture funnel: ${report.funnel.plannedActions} planned actions; ${report.funnel.nativeRecordedActions} native actions recorded; ${report.funnel.sameDeclaredActions} with equal declared commands; ${report.funnel.normallyComparableSpeech} comparable speech windows. Independently verified input equivalence: unmeasured.`, "",
    "Main and full speech are provisional wording measurements, not total simulator accuracy. The planned-step rates above retain every failure; conditional rates do not replace them. Language differences remain failures in the conditional denominator. Navigation Accuracy and Task Success are unmeasured; complete State Accuracy is unavailable. The separate state oracle covers only ID-joinable AX keyboard focus/control properties. No 90% threshold achievement is established.", "",
    report.evaluation.normalization, "",
    "| Family | Matched / planned content |", "| --- | ---: |", ...Object.entries(report.families).map(([name, m]) => `| ${name} | ${rate(m)} |`), "",
    "| Result | Steps |", "| --- | ---: |", ...Object.entries(report.verdicts).map(([v, n]) => `| ${v} | ${n} |`), ""].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [casesDir, nativeDir, simDir] = process.argv.slice(2).map(p => resolve(p));
  if (!casesDir || !nativeDir || !simDir) throw new Error("Usage: validate.ts <cases dir> <native run> <simulator run>");
  const set = JSON.parse(await readFile(join(casesDir, "cases.json"), "utf8")) as CaseSet;
  const fingerprint = await casesFingerprint(casesDir, set);
  async function readRun(dir: string, source: CaseRecord["source"]) {
    const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
    if (meta.caseSet !== set.id || meta.casesGeneratedAt !== set.generatedAt) throw new Error(`Run case-set identity differs from planned cases: ${dir}`);
    if (meta.casesSha256 && meta.casesSha256 !== fingerprint) throw new Error(`Run fixture fingerprint differs: ${dir}`);
    if (meta.inputArchive) await verifyArchivedInputs(dir,fingerprint);
    const records = new Map<string, CaseRecord>();
    for (const line of (await readFile(join(dir, "records.jsonl"), "utf8")).split("\n").filter(Boolean)) {
      const r = JSON.parse(line) as CaseRecord;
      if (r.source !== source || r.caseSet !== set.id || !set.cases.some(c => c.id === r.caseId) || records.has(r.caseId)) throw new Error(`Wrong source/set, unknown case or duplicate record: ${dir} ${r.caseId}`);
      records.set(r.caseId, r);
    }
    return { records, referenceBrowser: source === "voiceover" ? meta.machine?.browser?.name : meta.referenceBrowser ?? "safari", integrity: meta.inputArchive ? "verified archived input bytes" : meta.casesSha256 ? "metadata fingerprint only; no verified historical input archive" : "legacy run: generatedAt only; no historical byte fingerprint" };
  }
  const nativeRun = await readRun(nativeDir, "voiceover"), simulatorRun = await readRun(simDir, "simulator");
  if (nativeRun.referenceBrowser && nativeRun.referenceBrowser !== simulatorRun.referenceBrowser) throw new Error("Native browser differs from simulator reference browser; validate profiles independently");
  const native = nativeRun.records, simulator = simulatorRun.records, report = { ...validateRuns(set, native, simulator), integrity: { native: nativeRun.integrity, simulator: simulatorRun.integrity } };
  if (set.syntheticInputs) {
    const states = [];
    for (const c of set.cases) for (const [step, chord] of c.chords.entries()) {
      const a = native.get(c.id), b = simulator.get(c.id), x = a?.steps[step], y = b?.steps[step];
      const ax = x?.axPath ? await readFile(join(nativeDir, x.axPath), "utf8").then(text => JSON.parse(text) as AxDump).catch(() => undefined) : undefined;
      const comparison = comparePageState(ax ? nativePageState(ax) : undefined, y?.state);
      if (!a?.start.aligned || !b?.start.aligned || x?.foregroundError || y?.foregroundError || x?.chord !== chord || y?.chord !== chord || y?.reason === "unsupported") { comparison.matched = false; comparison.differences.push("workflow unavailable or unaligned"); }
      states.push({ caseId: c.id, step, chord, ...comparison });
    }
    await writeFile(join(simDir, "state-validation.json"), JSON.stringify({ ...summarizeState(states), rows: states }, null, 2));
  }
  await writeFile(join(simDir, "validation.json"), JSON.stringify(report, null, 2));
  const text = renderValidation(report) + `\nFixture integrity: native — ${report.integrity.native}; simulator — ${report.integrity.simulator}.\n`;
  await writeFile(join(simDir, "validation.md"), text);
  console.log(text);
}
