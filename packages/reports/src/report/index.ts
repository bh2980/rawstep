import { summarizeVisualExploration } from "../screenshot/analysis.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateTrace, writeJsonAtomic, type RunTrace } from "@rawstep/core/trace";
import { validateAnalysisReport, type AnalysisReport } from "../analyze/index.js";
import type { HintReport } from "../hints/index.js";
import { pngFor, record } from "../internal/guards.js";
import { actionLabel, eventGrounds, screenshotSrc, summarizeTrace, type ReportSummary } from "./summary.js";

export { summarizeTrace } from "./summary.js";
export type { ReportSummary, ReportCounts, ReportAction, ReportFailure, ReportVerification, ReportVerificationRule } from "./summary.js";

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

function renderableEventData(data: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(data)) as unknown;
  for (const key of ["screenshot", "previousScreenshot"]) {
    const screenshot = record(record(copy)[key]);
    if (typeof screenshot.pngBase64 === "string") screenshot.pngBase64 = key === "screenshot" && screenshotSrc(data) ? "[PNG viewport shown above]" : "[PNG preserved in trace.json]";
  }
  return copy;
}

function evidenceLink(id: string): string { return `<a href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`; }
function resultLabel(passed: boolean | undefined): string { return passed === true ? "Passed" : passed === false ? "Not satisfied" : "Not recorded"; }

function renderSummary(trace: RunTrace, summary: ReportSummary): string {
  const e = escapeHtml;
  const counts = summary.counts;
  const modality = summary.modality === "keyboard" ? "Screenshot keyboard exploration" : summary.modality === "simulation" ? "Simulated VoiceOver run" : summary.modality === "screenreader" ? "Screen-reader run" : summary.modality === "mixed" ? "Mixed observation evidence" : "Observation modality not recorded";
  const hasNative = summary.modalities.includes("screenreader") || summary.modality === "unknown";
  const hasSimulation = summary.modalities.includes("simulation");
  const hasKeyboard = summary.modalities.includes("keyboard");
  const outcome = trace.outcome;
  const cancellation = record(outcome?.cancellation);
  const failure = summary.firstFailure;
  return `<section aria-labelledby="outcome"><h2 id="outcome">Recorded run outcome</h2>
<p class="outcome">${e(outcome?.status ?? "unfinished")}${outcome?.reason ? `: ${e(outcome.reason)}` : ""}</p>
${outcome?.policyStopSource === "model" || outcome?.policyStopSource === "exploration-guard" ? `<p>Stop source: ${e(outcome.policyStopSource)}</p>` : ""}
${typeof outcome?.error === "string" ? `<p>${e(outcome.error)}</p>` : ""}
${typeof outcome?.stage === "string" ? `<p>Stage: ${e(outcome.stage)}${typeof outcome.step === "number" ? ` · step ${outcome.step}` : ""}</p>` : ""}
${typeof cancellation.signal === "string" ? `<p>Cancellation: ${e(cancellation.signal)}</p>` : ""}
<p>Started ${e(trace.startedAt)}${trace.endedAt ? ` · ended ${e(trace.endedAt)}` : ""}</p>
<p>${e(modality)} · ${counts.events} events · ${summary.actions.length} action attempts</p>
${hasNative ? `<p>${counts.readableSpeechEvents} readable native screen-reader output events. Transport responses and acknowledgments are not speech evidence.</p>` : ""}
${hasSimulation ? `<p><strong>Simulated VoiceOver approximation. This is not Apple VoiceOver.</strong> ${counts.readableSimulationOutputEvents} readable simulated output events. Generated wording and browser actions cannot establish native screen-reader behavior or accessibility conformance.</p>` : ""}
${hasKeyboard ? `<p>${counts.keyboardScreenshots} readable screenshot observations. Screenshots are visual evidence${summary.modality === "keyboard" ? "; this run did not use a screen reader" : ""}.</p>` : ""}
<p>Recorded actions and verifier results describe this run only; they do not establish accessibility conformance. Collection windows and command IDs provide temporal context, not proof of speech causality.</p>
<h3>First recorded failure or interruption</h3>
${failure ? `<p>${e(failure.type)}${failure.step !== undefined ? ` · step ${failure.step}` : ""}${failure.stage ? ` · ${e(failure.stage)}` : ""}${failure.eventId ? ` · ${evidenceLink(failure.eventId)}` : ""}</p><p>${e(failure.message)}</p><p>A recorded execution problem may have recovered later. The recorded run outcome above is authoritative.</p>` : "<p>No failure or interruption recorded.</p>"}
</section>
<section aria-labelledby="privacy"><h2 id="privacy">Privacy and evidence coverage</h2>
<p>Input values: ${e(trace.privacy.inputValues)}. Redaction applied: ${trace.privacy.redactionApplied ? "yes" : "no"}.</p>
<ul><li>${counts.redactedEvents} of ${counts.events} events marked redacted</li>
${hasNative ? `<li>${counts.redactedSpeechEvents} native screen-reader output events redacted; their original contents cannot be inspected</li>` : ""}
${hasSimulation ? `<li>${counts.readableSimulationOutputEvents} readable simulated output events; ${counts.redactedSimulationOutputEvents} simulated output events redacted</li>` : ""}
${hasKeyboard ? `<li>${counts.keyboardScreenshots} readable keyboard screenshots; ${counts.withheldKeyboardScreenshots} keyboard screenshots withheld or redacted</li>` : ""}
<li>${counts.diagnosticScreenshots} diagnostic screenshot references; ${counts.withheldDiagnosticScreenshots} diagnostic screenshots omitted for privacy</li>
<li>${counts.readableVerifierEvidence} readable verifier evidence events; ${counts.redactedVerifierEvidence} verifier evidence events redacted</li></ul>
<p>Diagnostic screenshots are saved separately and are not policy observations. This report does not verify whether referenced image files are still present.</p>
<p>Screenshots can contain personal information and are not anonymized. Redaction covers configured input values and recorded privacy boundaries, not every possible secret visible on a page.</p></section>`;
}

function renderActions(summary: ReportSummary): string {
  const e = escapeHtml;
  return `<section aria-labelledby="actions"><h2 id="actions">Action results</h2>
<p>An action result reports execution; independent verification determines completion of the task.</p>
${summary.actions.length ? `<div class="table-scroll"><table><caption>Recorded action attempts and their results</caption><thead><tr><th scope="col">Step</th><th scope="col">Action</th><th scope="col">Execution result</th><th scope="col">Evidence</th></tr></thead><tbody>${summary.actions.map(action => `<tr><td>${action.step ?? "Unknown"}</td><td>${e(actionLabel(action.action))}</td><td>${e(action.status === "not-recorded" ? "No result recorded" : action.status)}${action.error ? `<br>${e(action.error)}` : ""}</td><td>${[action.decisionEventId, action.resultEventId, ...action.verificationEventIds].filter((id): id is string => Boolean(id)).map(evidenceLink).join("<br>")}</td></tr>`).join("")}</tbody></table></div>` : "<p>No action attempts recorded. The run may have stopped or failed before an action was attempted.</p>"}</section>`;
}

function renderVerification(trace: RunTrace, summary: ReportSummary): string {
  const e = escapeHtml;
  const eventsById = new Map(trace.events.map(event => [event.id, event]));
  return `<section aria-labelledby="verification"><h2 id="verification">Independent verification</h2>
${summary.verification.length ? summary.verification.map(result => `<article><h3>${result.step === undefined ? "Verification" : `Step ${result.step}`}: ${resultLabel(result.passed)}</h3><p>Result: ${evidenceLink(result.eventId)}</p>
${result.rules.length ? result.rules.map(rule => `<section class="rule"><h4>Rule ${rule.ruleIndex + 1}: ${e(rule.ruleType)} · ${resultLabel(rule.passed)}</h4>${rule.failure ? `<p>${e(rule.failure)}</p>` : ""}
${rule.evidenceEventIds.length ? rule.evidenceEventIds.map(id => {
    const event = eventsById.get(id)!;
    return `<div><p>Grounds: ${evidenceLink(id)}${event.redacted ? " · redacted evidence; original text is unavailable" : ""}</p><pre>${e(JSON.stringify(eventGrounds(event), null, 2))}</pre></div>`;
  }).join("") : "<p>No per-rule evidence reference recorded.</p>"}</section>`).join("") : `<p>No per-rule grounds recorded in this trace.</p>${result.failures.length ? `<ul>${result.failures.map(failure => `<li>${e(failure)}</li>`).join("")}</ul>` : ""}`}</article>`).join("\n") : "<p>No verification result recorded.</p>"}</section>`;
}

function renderVisualExploration(trace: RunTrace): string {
  if (!trace.events.some(event => event.type === 'backend.metadata' && record(event.data).backend === 'screenshot-keyboard')) return '';
  const summary = summarizeVisualExploration(trace);
  const e = escapeHtml;
  return `<section aria-labelledby="visual"><h2 id="visual">Visited visual states</h2>
<p>${summary.states.length} distinct pixel states · ${summary.inferenceEventIds.length} recorded model inferences · ${summary.transitions.filter(t => t.changedPixels).length} changed screenshot transitions · ${summary.repetitionLimitEventIds.length} repetition stops</p>
<p>${e(summary.limitation)}</p>
${summary.states.map((state, index) => {
    const event = trace.events.find(item => item.id === state.observationEventIds[0])!;
    return `<details><summary>Visual state ${index + 1} · ${state.visits} observation(s) · SHA-256 ${e(state.sha256.slice(0, 12))}</summary><figure><img alt="Visited keyboard visual state ${index + 1}" style="max-width:100%;height:auto" src="${e(screenshotSrc(event.data) ?? "")}"></figure><p>${state.observationEventIds.map(evidenceLink).join(', ')}</p></details>`;
  }).join('')}
<h3>Keyboard transitions</h3><ul>${summary.transitions.map(t => `<li>${evidenceLink(t.fromEventId)} → ${evidenceLink(t.toEventId)}: ${t.changedPixels ? 'changed pixels' : 'identical pixels'}; ${t.actionEventIds.map(evidenceLink).join(', ')}</li>`).join('')}</ul>
<h3>Model focus observations (uncertain)</h3><ul>${summary.modelFocusObservations.map(f => `<li>${evidenceLink(f.eventId)}: ${e(f.visibility)}${f.note ? ` · ${e(f.note)}` : ''}</li>`).join('')}</ul></section>`;
}

function renderEnvironmentDiagnostics(trace: RunTrace): string {
  const profileEvents = trace.events.filter(event => event.type === 'browser.profile');
  const diagnosticEvents = trace.events.filter(event => event.type === 'browser.accessibility-diagnostic');
  if (!profileEvents.length && !diagnosticEvents.length) return '';
  return `<section><h2>Applied environment and independent diagnostics</h2><p>Browser media emulation, page user styles and native settings are distinct. These DOM diagnostics are not policy observations and do not establish accessibility conformance.</p>${profileEvents.map(event=>`<h3>Requested versus observed settings</h3><p>${evidenceLink(event.id)}</p><pre>${escapeHtml(JSON.stringify(event.data,null,2))}</pre>`).join('')}<h3>Focus, layout and error-state observations</h3>${diagnosticEvents.map(event=>`<details><summary>${evidenceLink(event.id)}${event.redacted?' · omitted after input':''}</summary><pre>${escapeHtml(JSON.stringify(event.data,null,2))}</pre></details>`).join('')}</section>`;
}

function renderHints(hints: HintReport): string {
  const e = escapeHtml, seconds = (ms: number | null) => ms === null ? "unknown duration" : `${(ms / 1000).toFixed(1)} s`;
  return `<section aria-labelledby="hints"><h2 id="hints">Friction hints</h2>
<p>Goal reached: ${hints.goalReached ? "yes" : "no"} · ${hints.steps} steps · ${e(seconds(hints.durationMs))}</p>
${hints.reference ? `<p>Reference run ${e(hints.reference.runId)}: ${hints.reference.steps} steps · ${e(seconds(hints.reference.durationMs))}</p>` : ""}
${hints.hints.length ? `<div class="table-scroll"><table><caption>Places worth a human look; hints are pointers, not verdicts</caption><thead><tr><th scope="col">Steps</th><th scope="col">Kind</th><th scope="col">Certainty</th><th scope="col">Summary</th></tr></thead><tbody>${hints.hints.map(hint => `<tr><td>${e(hint.steps.join(", ") || "run")}</td><td>${e(hint.kind)}</td><td>${e(hint.certainty)}</td><td>${e(hint.summary)}</td></tr>`).join("")}</tbody></table></div>` : "<p>No friction hints.</p>"}
${hints.limitations.length ? `<ul>${hints.limitations.map(limitation => `<li>${e(limitation)}</li>`).join("")}</ul>` : ""}</section>`;
}

/** Render only escaped text. No script, embedded executable JSON, or remote resources. */
export function renderReportHtml(trace: RunTrace, analysis?: AnalysisReport, options: { hints?: HintReport } = {}): string {
  validateTrace(trace);
  if (analysis) validateAnalysisReport(analysis, trace);
  const e = escapeHtml;
  const summary = summarizeTrace(trace);
  const blobImages = trace.events.some(event => screenshotSrc(event.data)?.startsWith("blobs/"));
  const events = trace.events.map((event) => `<details id="${e(event.id)}" class="event"><summary>${event.seq}. ${e(event.type)} · ${e(event.id)}${event.redacted ? " · redacted" : ""}</summary>
<p>${e(event.timestamp)} · ${e(event.source)}${event.commandId ? ` · command ${e(event.commandId)}` : ""}${event.redacted ? " · redacted" : ""}</p>
${event.collectionWindow ? `<p>Collection window: ${e(event.collectionWindow.startedAt)} to ${e(event.collectionWindow.endedAt)}</p>` : ""}
${event.association ? "<p>Temporal association only; this does not establish speech causality.</p>" : ""}
${screenshotSrc(event.data) ? `<figure><img alt="Keyboard viewport screenshot" style="max-width:100%;height:auto" src="${e(screenshotSrc(event.data)!)}"><figcaption>Recorded viewport pixels; these pixels are not anonymized.</figcaption></figure>` : ""}
<pre>${e(JSON.stringify(renderableEventData(event.data), null, 2))}</pre></details>`).join("\n");
  const findings = analysis?.findings.map((finding) => `<article><h3>${e(finding.title)}</h3><p>${e(finding.severity)} · ${e(finding.description)}</p>
<p>Evidence: ${finding.evidenceEventIds.map((id) => `<a href="#${e(id)}">${e(id)}</a>`).join(", ")}</p></article>`).join("\n") ?? "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:${blobImages ? " 'self' file:" : ""}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>RawStep trace: ${e(trace.task.id)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#18202b;background:#fff}h1,h2,h3,h4{line-height:1.25}article,.event{border:1px solid #d6dce5;border-radius:8px;padding:1rem;margin:1rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f5f8;padding:1rem}a{color:#0645ad}a:focus-visible,summary:focus-visible{outline:3px solid #125ea7;outline-offset:3px}p,td,summary{overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600}.outcome{font-size:1.25rem;font-weight:700}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}caption{text-align:left;margin-bottom:.5rem}th,td{border:1px solid #d6dce5;text-align:left;vertical-align:top;padding:.6rem}.rule{border-left:3px solid #d6dce5;padding-left:1rem}.event:target{border-color:#125ea7}details.context{margin:1rem 0}figure{margin:1rem 0}</style></head>
<body><header><h1>RawStep trace: ${e(trace.task.id)}</h1><p>Run ${e(trace.runId)} · trace schema ${e(trace.schemaVersion)}</p></header>
<main>${renderSummary(trace, summary)}${options.hints ? renderHints(options.hints) : ""}${renderActions(summary)}${renderVisualExploration(trace)}${renderEnvironmentDiagnostics(trace)}${renderVerification(trace, summary)}
<details class="context"><summary>Task</summary><pre>${e(JSON.stringify(trace.task, null, 2))}</pre></details>
<details class="context"><summary>Environment</summary><pre>${e(JSON.stringify(trace.environment, null, 2))}</pre></details>
<h2>Analysis</h2><p>${analysis ? `${e(analysis.status)} · ${e(analysis.analyzer.id)}` : "Not requested. This report requires no model or analyzer."}</p>
${analysis ? `<p>${e(analysis.summary)}</p>` : ""}${findings}
<h2>Raw ordered evidence (${trace.events.length} events)</h2><p>Expand an event to inspect the saved payload. Event ordering is recorder ordering.</p>${events || "<p>No events recorded.</p>"}</main></body></html>\n`;
}

export async function writeReport(trace: RunTrace, analysis: AnalysisReport | undefined, outDir: string, options: { hints?: HintReport } = {}): Promise<{ jsonPath: string; htmlPath: string }> {
  let html = renderReportHtml(trace, analysis, options);
  try {
    const reason=JSON.parse(await readFile(join(outDir,'stop-reason.json'),'utf8')) as Record<string,unknown>;
    if(reason.schemaVersion==='1.0'&&reason.runId===trace.runId&&JSON.stringify(reason.originalOutcome)===JSON.stringify(trace.outcome))html=html.replace('</main>',`<section><h2>Optional model stop hypothesis</h2><p>This separate choice-model opinion cannot change the original outcome or establish an accessibility defect.</p><pre>${escapeHtml(JSON.stringify(reason,null,2))}</pre></section></main>`);
  }catch{/* Optional analysis is absent or unavailable; the saved execution remains authoritative. */}

  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "report.json");
  const htmlPath = join(outDir, "report.html");
  // Report projections are separate files; execution evidence is never rewritten.
  await writeJsonAtomic(jsonPath, { schemaVersion: "1.0", runId: trace.runId, runOutcome: trace.outcome ?? null, analysis: analysis ?? null, ...(options.hints ? { hints: options.hints } : {}),
    visualExploration: summarizeVisualExploration(trace), eventCount: trace.events.length, privacy: trace.privacy, summary: summarizeTrace(trace) });
  await writeFile(htmlPath, html, { mode: 0o600 });
  return { jsonPath, htmlPath };
}
