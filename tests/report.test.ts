import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { renderReportHtml, summarizeTrace, writeReport } from "@rawstep/reports/report";
import type { RunTrace, TraceEvent } from "@rawstep/core/trace";
import { extractHints, type HintReport } from "@rawstep/reports/hints";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const timestamp = "2026-01-01T00:00:00.000Z";
const sha256 = "a".repeat(64);
const png = { sha256, blob: `blobs/${sha256}.png`, bytes: 68 };
function fixture(events: Array<Pick<TraceEvent, "type" | "data"> & Partial<TraceEvent>>, mode: "screenreader" | "keyboard" = "screenreader"): RunTrace {
  return {
    schemaVersion: "2.2", runId: "report-test", task: { id: "report", mode },
    environment: { platform: "test", platformVersion: "unknown", browser: "test", browserVersion: "unknown", screenReader: "test", screenReaderVersion: "unknown" },
    startedAt: timestamp, endedAt: timestamp, outcome: { status: "failure", reason: "verification-failed", stage: "verification", step: 1 },
    privacy: { inputValues: "redacted", redactionApplied: events.some(event => event.redacted) },
    events: events.map((event, index) => ({ id: `event-${index + 1}`, seq: index + 1, timestamp, source: "runner", redacted: false, ...event })),
  };
}

describe("evidence-first report", () => {
  it('labels simulated evidence prominently and keeps it separate from native speech', async () => {
    const trace = fixture([
      { type: 'simulation.output', source: 'simulation', data: { text: 'Save, button' } },
      { type: 'simulation.output', source: 'simulation', redacted: true, data: { text: '[REDACTED]' } },
      { type: 'simulation.observation', source: 'simulation', data: { speech: ['Save, button'] } },
    ]);
    trace.environment.observationProvenance = 'simulation';
    const summary = summarizeTrace(trace);
    expect(summary).toMatchObject({ modality: 'simulation', modalities: ['simulation'], counts: {
      readableSpeechEvents: 0, redactedSpeechEvents: 0, readableSimulationOutputEvents: 1, redactedSimulationOutputEvents: 1,
      keyboardScreenshots: 0,
    } });
    const document = new JSDOM(renderReportHtml(trace)).window.document;
    expect(document.querySelector('[aria-labelledby=outcome]')?.textContent).toContain('Simulated VoiceOver run');
    expect(document.querySelector('[aria-labelledby=outcome] strong')?.textContent).toContain('This is not Apple VoiceOver');
    expect(document.querySelector('[aria-labelledby=privacy]')?.textContent).toContain('1 simulated output events redacted');
    expect(document.querySelector('[aria-labelledby=privacy]')?.textContent).not.toContain('native screen-reader output');
    expect(document.querySelector('[aria-labelledby=privacy]')?.textContent).not.toContain('keyboard screenshots');
    const directory = await mkdtemp(join(tmpdir(), 'rawstep-simulation-report-'));
    directories.push(directory);
    const { jsonPath } = await writeReport(trace, undefined, directory);
    expect(JSON.parse(await readFile(jsonPath, 'utf8')).summary).toMatchObject(summary);
  });

  it('keeps the simulation warning visible for an empty startup failure and for mixed evidence', () => {
    const empty = fixture([]);
    empty.environment.observationProvenance = 'simulation';
    expect(renderReportHtml(empty)).toContain('Simulated VoiceOver approximation');
    const mixed = fixture([
      { type: 'simulation.output', source: 'simulation', data: { text: 'Save, button' } },
      { type: 'screen-reader.output', source: 'screen-reader', data: { text: 'Save button' } },
      { type: 'keyboard.observation', data: { screenshot: png } },
    ]);
    const document = new JSDOM(renderReportHtml(mixed)).window.document;
    expect(summarizeTrace(mixed).modalities).toEqual(['screenreader', 'simulation', 'keyboard']);
    expect(document.querySelector('[aria-labelledby=outcome]')?.textContent).toContain('1 readable native screen-reader output events');
    expect(document.querySelector('[aria-labelledby=outcome]')?.textContent).toContain('1 readable simulated output events');
    expect(document.querySelector('[aria-labelledby=outcome]')?.textContent).toContain('1 readable screenshot observations');
  });

  it("shows action results, the first failed event and each verifier rule's actual grounds", () => {
    const trace = fixture([
      { type: "policy.decision", source: "policy", data: { step: 1, decision: { action: { kind: "key", key: "Enter" } } } },
      { type: "action.result", data: { step: 1, action: { kind: "key", key: "Enter" }, ok: false, error: "Command rejected" } },
      { type: "verifier.evidence", source: "verifier", data: { step: 1, ruleIndex: 0, ruleType: "titleIncludes", passed: false, witness: { kind: "title", expected: "Done", observed: "Waiting" } } },
      { type: "verifier.result", source: "verifier", data: { step: 1, passed: false, failures: ["Expected Done"], rules: [{ ruleIndex: 0, ruleType: "titleIncludes", passed: false, failure: "Expected Done", evidenceEventIds: ["event-3"] }] } },
    ]);
    const summary = summarizeTrace(trace);
    expect(summary.actions).toEqual([{ step: 1, action: { kind: "key", key: "Enter" }, status: "failed", error: "Command rejected", decisionEventId: "event-1", resultEventId: "event-2", verificationEventIds: ["event-4"] }]);
    expect(summary.firstFailure).toEqual({ type: "action.result", message: "Command rejected", eventId: "event-2", step: 1 });
    const document = new JSDOM(renderReportHtml(trace)).window.document;
    expect(document.querySelector("table")?.textContent).toContain("Key: Enter");
    expect(document.querySelector("table")?.textContent).toContain("Command rejected");
    expect(document.querySelector("[aria-labelledby=verification]")?.textContent).toContain("Rule 1: titleIncludes · Not satisfied");
    expect(document.querySelector("[aria-labelledby=verification]")?.textContent).toContain('"observed": "Waiting"');
    expect(document.querySelector("[aria-labelledby=verification] a[href='#event-3']")).not.toBeNull();
    expect(document.querySelectorAll("details.event")).toHaveLength(trace.events.length);
    expect(document.querySelectorAll("details.event[open]")).toHaveLength(0);
  });

  it("does not turn intermediate unmet checks into a failure for a successful multi-step run", () => {
    const trace = fixture([
      { type: "verifier.result", source: "verifier", data: { step: 1, passed: false, failures: ["Not there yet"] } },
      { type: "action.result", data: { step: 2, action: { kind: "key", key: "Enter" }, ok: true } },
      { type: "verifier.result", source: "verifier", data: { step: 2, passed: true, failures: [] } },
    ]);
    trace.outcome = { status: "success", reason: "verified" };
    expect(summarizeTrace(trace).firstFailure).toBeNull();
    expect(renderReportHtml(trace)).toContain("No failure or interruption recorded");
    expect(renderReportHtml(trace)).toContain("Step 1: Not satisfied");
  });

  it("distinguishes an interrupted action from a recorded execution failure", () => {
    const trace = fixture([{ type: "verifier.result", source: "verifier", data: { step: 2, passed: false, failures: ["Not there yet"] } },
      { type: "policy.decision", source: "policy", data: { step: 3, decision: { action: { kind: "key", key: "Tab" } } } },
      { type: "run.aborted", data: { signal: "SIGINT", stage: "action", step: 3 } }]);
    trace.outcome = { status: "aborted", reason: "aborted", stage: "action", step: 3, cancellation: { signal: "SIGINT", stage: "action", step: 3 } };
    expect(summarizeTrace(trace).actions[0]?.status).toBe("not-recorded");
    expect(summarizeTrace(trace).firstFailure?.type).toBe("run.aborted");
    const html = renderReportHtml(trace);
    expect(html).toContain("No result recorded");
    expect(html).toContain("Cancellation: SIGINT");
    expect(html).toContain("Stage: action · step 3");
  });

  it("counts real output, retained screenshots and omitted diagnostics without counting screenshot copies", () => {
    const screenshot = { ...png, viewport: { w: 1, h: 1 } };
    const trace = fixture([
      { type: "keyboard.observation", redacted: true, data: { screenshot, previousScreenshot: screenshot } },
      { type: "keyboard.observation", redacted: true, data: { screenshot: "[REDACTED]" } },
      { type: "browser.screenshot", source: "browser-diagnostic", data: { path: "diagnostics/step-1.png" } },
      { type: "browser.screenshot-redacted", source: "browser-diagnostic", redacted: true, data: { step: 2, reason: "Input privacy" } },
      { type: "backend.response", source: "screen-reader", data: { speech: ["Not actual output"] } },
    ], "keyboard");
    expect(summarizeTrace(trace)).toMatchObject({ modality: "keyboard", counts: {
      events: 5, redactedEvents: 3, keyboardScreenshots: 1, withheldKeyboardScreenshots: 1, diagnosticScreenshots: 1,
      withheldDiagnosticScreenshots: 1, readableSpeechEvents: 0, redactedSpeechEvents: 0,
    } });
    const document = new JSDOM(renderReportHtml(trace)).window.document;
    expect(document.body.textContent).toContain("Screenshot keyboard exploration");
    expect(document.body.textContent).toContain("this run did not use a screen reader");
    expect(document.body.textContent).toContain("1 diagnostic screenshots omitted for privacy");
    expect(document.querySelector("[aria-labelledby=privacy]")?.textContent).not.toContain("screen-reader output events redacted");
    expect(document.querySelectorAll("img")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("pngBase64");
  });

  it("hides keyboard screenshot counts for a screen-reader run and shows both modalities for mixed evidence", () => {
    const trace = fixture([{ type: "screen-reader.output", source: "screen-reader", data: { text: "Get started, button" } }]);
    const document = new JSDOM(renderReportHtml(trace)).window.document;
    expect(document.querySelector("[aria-labelledby=privacy]")?.textContent).not.toContain("readable keyboard screenshots");
    const mixed = fixture([...trace.events, { type: "keyboard.observation", data: { screenshot: png } }]);
    const mixedDocument = new JSDOM(renderReportHtml(mixed)).window.document;
    expect(mixedDocument.querySelector("[aria-labelledby=privacy]")?.textContent).toContain("screen-reader output events redacted");
    expect(mixedDocument.querySelector("[aria-labelledby=privacy]")?.textContent).toContain("readable keyboard screenshots");
  });

  it("escapes new summary, rule and action fields and never links missing evidence", () => {
    const attack = '<script>alert("x")</script>';
    const trace = fixture([
      { type: "action.result", data: { step: 1, action: { kind: "key", key: attack }, ok: false, error: attack } },
      { type: "verifier.evidence", source: "verifier", redacted: true, data: { witness: { kind: "title", observed: attack } } },
      { type: "verifier.result", source: "verifier", data: { step: 1, passed: false, rules: [{ ruleIndex: 0, ruleType: attack, passed: false, failure: attack, evidenceEventIds: ["event-2", 'missing" onclick="alert(1)'] }] } },
    ]);
    trace.outcome = { status: "failure", reason: attack, stage: attack, error: attack };
    const html = renderReportHtml(trace);
    const document = new JSDOM(html).window.document;
    expect(document.querySelectorAll("script, [onclick], [onerror]")).toHaveLength(0);
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("default-src 'none'");
    expect(document.querySelectorAll("a[href^='#missing']")).toHaveLength(0);
    expect(document.body.textContent).toContain("redacted evidence; original text is unavailable");
    expect(html).toContain("&lt;script&gt;");
  });

  it("saves structured report summaries and leaves source evidence unchanged", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rawstep-report-v2-"));
    directories.push(directory);
    const trace = fixture([{ type: "run.error", data: { message: "Browser unavailable", stage: "browser.start", step: 0 } }]);
    const original = structuredClone(trace);
    const files = await writeReport(trace, undefined, directory);
    const report = JSON.parse(await readFile(files.jsonPath, "utf8"));
    expect(report.runOutcome).toEqual(trace.outcome);
    expect(report.summary.firstFailure.message).toBe("Browser unavailable");
    expect(report.summary.counts.events).toBe(1);
    expect(trace).toEqual(original);
  });

  it("renders older traces without per-rule evidence or action fields", () => {
    const trace = fixture([{ type: "action.result", data: { ok: false } }, { type: "verifier.result", source: "verifier", data: { passed: false, failures: ["Expected Done"] } }]);
    expect(renderReportHtml(trace)).toContain("No per-rule grounds recorded in this trace");
    expect(renderReportHtml(trace)).toContain("Action not recorded");
  });

  it("renders a friction hints section only when hints are given and escapes their text", async () => {
    const trace = fixture([{ type: "run.error", data: { message: "x" } }]);
    const base = extractHints(trace);
    expect(renderReportHtml(trace)).not.toContain("Friction hints");
    expect(renderReportHtml(trace, undefined, { hints: base })).toContain("No friction hints.");
    const hints: HintReport = { ...base, goalReached: true, steps: 9, durationMs: 2500, reference: { runId: "ref-run", steps: 3, durationMs: 1000, goalReached: true },
      hints: [{ kind: "excess-keystrokes", source: "page", certainty: "observed", steps: [2, 9], summary: "<script>alert(1)</script> 11 Tabs", detail: {}, evidence: [] }] };
    const html = renderReportHtml(trace, undefined, { hints });
    expect(html).not.toContain("<script>alert(1)</script>");
    const document = new JSDOM(html).window.document;
    expect(document.querySelector("script")).toBeNull();
    const section = document.querySelector("#hints")!.closest("section")!;
    expect(section.textContent).toContain("Goal reached: yes · 9 steps · 2.5 s");
    expect(section.textContent).toContain("Reference run ref-run: 3 steps");
    expect([...section.querySelectorAll("tbody td")].map(cell => cell.textContent)).toEqual(["2, 9", "excess-keystrokes", "observed", "<script>alert(1)</script> 11 Tabs"]);
    expect(html.indexOf('id="hints"')).toBeLessThan(html.indexOf('id="actions"'));
    const directory = await mkdtemp(join(tmpdir(), "rawstep-report-hints-"));
    directories.push(directory);
    const files = await writeReport(trace, undefined, directory, { hints });
    expect(JSON.parse(await readFile(files.jsonPath, "utf8")).hints).toEqual(hints);
    expect(await readFile(files.htmlPath, "utf8")).toContain("Friction hints");
    expect(JSON.parse(await readFile((await writeReport(trace, undefined, directory)).jsonPath, "utf8"))).not.toHaveProperty("hints");
  });
});
