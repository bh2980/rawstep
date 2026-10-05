import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSavedTrace, analyzeTrace, loadAnalyzer, readAnalysis, summarizeTraceEvidence, type TraceAnalyzer } from "@rawstep/reports/analyze";
import { renderReportHtml, writeReport } from "@rawstep/reports/report";
import { readTrace, TraceRecorder } from "@rawstep/core/trace";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "rawstep-analysis-v2-"));
  const recorder = new TraceRecorder({ id: "analysis", input: { email: "secret@example.test" } }, dir);
  await recorder.initialize();
  recorder.append("screen-reader.output", { text: "Email secret@example.test edit text" });
  recorder.append("action.result", { ok: false });
  const trace = await recorder.finalize({ status: "failure", reason: "verification-failed" });
  return { dir, trace };
}

describe("independent post-run analysis and reports", () => {
  it('counts simulated output separately from native speech, transport events, and screenshots', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-simulation-analysis-'));
    const recorder = new TraceRecorder({ id: 'simulation', mode: 'screenreader' }, dir, { environment: { observationProvenance: 'simulation' } });
    await recorder.initialize();
    recorder.append('backend.metadata', { backend: 'mock-voiceover', observationKind: 'screenreader', evidenceProvenance: 'simulation' });
    const output = recorder.append('simulation.output', { output: { text: 'Save, button' } }, { source: 'simulation' });
    const hidden = recorder.append('backend.output', { output: { text: '[REDACTED]' } }, { source: 'simulation', redacted: true });
    recorder.append('simulation.observation', { speech: ['Duplicate is not another output event'] }, { source: 'simulation' });
    recorder.append('backend.response', { text: 'Acknowledged' }, { source: 'simulation' });
    recorder.append('simulation.output', { text: ' ' }, { source: 'simulation' });
    const trace = await recorder.finalize({ status: 'success' });
    const inventory = summarizeTraceEvidence(trace);
    expect(inventory.modality).toBe('simulation');
    expect(inventory.modalities).toEqual(['simulation']);
    expect(inventory.readableSimulationOutputEvents.map(event => event.id)).toEqual([output.id]);
    expect(inventory.redactedSimulationOutputEvents.map(event => event.id)).toEqual([hidden.id]);
    expect(inventory.readableSpeechEvents).toEqual([]);
    const analysis = await analyzeTrace(trace);
    expect(analysis.status).toBe('completed');
    expect(analysis.summary).toContain('1 readable simulated VoiceOver output events');
    expect(analysis.summary).toContain('1 redacted simulated output events');
    expect(analysis.summary).toContain('not native VoiceOver evidence');
    expect(analysis.findings.map(finding => finding.id)).toContain('simulated-voiceover-evidence');
    expect(analysis.findings.map(finding => finding.id)).toContain('redacted-simulation-evidence');
    expect(analysis.findings.map(finding => finding.id)).not.toContain('missing-speech-evidence');
    expect(analysis.findings.map(finding => finding.id)).not.toContain('missing-screenshot-evidence');
  });

  it.each(['empty', 'startup-error'] as const)('recognizes a simulation from environment provenance before output (%s)', async (state) => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-simulation-startup-'));
    const recorder = new TraceRecorder({ id: 'simulation', mode: 'screenreader' }, dir, { environment: { observationProvenance: 'simulation' } });
    await recorder.initialize();
    if (state === 'startup-error') recorder.append('run.error', { message: 'Browser unavailable' });
    const trace = await recorder.finalize({ status: 'failure' });
    const analysis = await analyzeTrace(trace);
    expect(summarizeTraceEvidence(trace).modality).toBe('simulation');
    expect(analysis.summary).toContain('Mode: simulation');
    expect(analysis.summary).toContain('0 readable simulated VoiceOver output events');
    expect(analysis.findings.map(finding => finding.id)).not.toContain('missing-speech-evidence');
  });

  it('does not mistake a simulated screen-reader-shaped observation contract for native evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-simulation-contract-'));
    const recorder = new TraceRecorder({ id: 'simulation', mode: 'screenreader' }, dir, { environment: { observationProvenance: 'simulation' } });
    await recorder.initialize();
    recorder.append('backend.metadata', { observationKind: 'screenreader' });
    const trace = await recorder.finalize({ status: 'failure' });
    expect(summarizeTraceEvidence(trace).modality).toBe('simulation');
    expect((await analyzeTrace(trace)).findings.map(finding => finding.id)).not.toContain('missing-speech-evidence');
  });

  it('preserves separate native and simulated evidence in a mixed trace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-mixed-simulation-'));
    const recorder = new TraceRecorder({ id: 'mixed', mode: 'screenreader' }, dir, { environment: { observationProvenance: 'simulation' } });
    await recorder.initialize();
    recorder.append('simulation.output', { text: 'Save, button' }, { source: 'simulation' });
    recorder.append('screen-reader.output', { text: 'Save button' }, { source: 'screen-reader' });
    const trace = await recorder.finalize({ status: 'inconclusive' });
    expect(summarizeTraceEvidence(trace)).toMatchObject({ modality: 'mixed', modalities: ['screenreader', 'simulation'] });
    const analysis = await analyzeTrace(trace);
    expect(analysis.summary).toContain('1 readable screen-reader output events');
    expect(analysis.summary).toContain('1 readable simulated VoiceOver output events');
    expect(analysis.findings.map(finding => finding.id)).not.toContain('missing-screenshot-evidence');
  });

  it("runs locally without a model and cites saved event IDs", async () => {
    const { trace } = await fixture();
    const report = await analyzeTrace(trace);
    expect(report.status).toBe("completed");
    expect(report.analyzer.id).toBe("rawstep/deterministic-v1");
    expect(report.findings[0]).toMatchObject({ id: "command-failure", evidenceEventIds: [trace.events[1]!.id] });
    expect(report.runOutcome).toEqual(trace.outcome);
    expect(report.summary).toContain("no accessibility conformance verdict");
  });

  it("can rerun analyzers without changing execution evidence or its outcome", async () => {
    const { dir, trace } = await fixture();
    const originalJson = await readFile(join(dir, "trace.json"), "utf8");
    const originalJournal = await readFile(join(dir, "trace.jsonl"), "utf8");
    await analyzeSavedTrace(dir);
    const second = await analyzeSavedTrace(join(dir, "trace.json"), { analyzer: { id: "second", analyze: () => ({ summary: "Different analysis", findings: [] }) } });
    expect(second.analyzer.id).toBe("second");
    expect((await readAnalysis(join(dir, "analysis.json"), trace)).summary).toBe("Different analysis");
    expect(await readFile(join(dir, "trace.json"), "utf8")).toBe(originalJson);
    expect(await readFile(join(dir, "trace.jsonl"), "utf8")).toBe(originalJournal);
    expect((await readTrace(dir)).outcome).toEqual(trace.outcome);
  });

  it("passes only redacted, immutable snapshots into optional plugins", async () => {
    const { trace } = await fixture();
    let observed = "";
    const analyzer: TraceAnalyzer = { id: "privacy-check", analyze(received) {
      observed = JSON.stringify(received);
      expect(Object.isFrozen(received)).toBe(true);
      expect(Object.isFrozen(received.events[0]!.data)).toBe(true);
      return { summary: "Checked", findings: [] };
    } };
    expect((await analyzeTrace(trace, analyzer)).status).toBe("completed");
    expect(observed).not.toContain("secret@example.test");
    expect(observed).toContain("[REDACTED]");
    const mutation = await analyzeTrace(trace, { id: "mutation", analyze(received) {
      received.outcome!.status = "success";
      return { summary: "Changed", findings: [] };
    } });
    expect(mutation.status).toBe("failed");
    expect(trace.outcome!.status).toBe("failure");
  });

  it("records analyzer failure separately and suppresses potentially sensitive plugin error text", async () => {
    const { dir, trace } = await fixture();
    const failed = await analyzeSavedTrace(dir, { analyzer: { id: "broken", analyze: () => { throw new Error("secret@example.test provider token"); } } });
    expect(failed.status).toBe("failed");
    expect(failed.runOutcome).toEqual(trace.outcome);
    expect(JSON.stringify(failed)).not.toContain("secret@example.test");
    expect((await readTrace(dir)).outcome).toEqual(trace.outcome);
    expect((await readAnalysis(join(dir, "analysis.json"), trace)).status).toBe("failed");
  });

  it("rejects invented or absent evidence references", async () => {
    const { trace } = await fixture();
    for (const evidenceEventIds of [["invented-event"], []]) {
      const report = await analyzeTrace(trace, { id: "bad-evidence", analyze: () => ({ summary: "Claim", findings: [{
        id: "bad", title: "Claim", description: "Unsupported claim", severity: "error", evidenceEventIds
      }] }) });
      expect(report.status).toBe("failed");
      expect(report.findings).toEqual([]);
    }
  });

  it("loads an explicitly selected local analyzer module", async () => {
    const { dir, trace } = await fixture();
    const path = join(dir, "analyzer.mjs");
    await writeFile(path, "export default { id: 'local-test', analyze(trace) { return { summary: `${trace.events.length} events`, findings: [] }; } };\n");
    const analyzer = await loadAnalyzer(path);
    expect((await analyzeTrace(trace, analyzer)).summary).toBe("2 events");
  });

  it("builds reports without an analyzer and never rewrites the saved run", async () => {
    const { dir, trace } = await fixture();
    const original = await readFile(join(dir, "trace.json"), "utf8");
    const files = await writeReport(trace, undefined, dir);
    expect(await readFile(files.htmlPath, "utf8")).toContain("Not requested");
    expect(JSON.parse(await readFile(files.jsonPath, "utf8")).runOutcome).toEqual(trace.outcome);
    expect(await readFile(join(dir, "trace.json"), "utf8")).toBe(original);
  });

  it("escapes hostile trace and analyzer strings and links findings to evidence", async () => {
    const { trace } = await fixture();
    const attack = '<script>alert("oops")</script><img src=x onerror=alert(1)>';
    trace.task.goal = attack;
    trace.events[0]!.data = { text: attack };
    const analysis = await analyzeTrace(trace, { id: attack, analyze: () => ({ summary: attack, findings: [{
      id: "escaped", title: attack, description: attack, severity: "warning", evidenceEventIds: [trace.events[0]!.id]
    }] }) });
    const html = renderReportHtml(trace, analysis);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(`href="#${trace.events[0]!.id}"`);
    expect(html).toContain("Content-Security-Policy");
  });

  it("rejects reports from another run and analyzer attempts to change the outcome", async () => {
    const { trace } = await fixture();
    const analysis = await analyzeTrace(trace);
    expect(() => renderReportHtml(trace, { ...analysis, runId: "another-run" })).toThrow(/belong/);
    expect(() => renderReportHtml(trace, { ...analysis, runOutcome: { status: "success" } })).toThrow(/outcome/);
  });

  it("never counts transport, ACK, lifecycle, or empty-output events as speech", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rawstep-no-speech-v2-"));
    const recorder = new TraceRecorder({ id: "no-speech" }, dir);
    await recorder.initialize();
    for (const type of ["backend.connected", "backend.command", "backend.response", "backend.windowOpened", "backend.windowClosed", "screen-reader.observation"]) {
      recorder.append(type, { speech: ["This is not a raw output event"] }, { source: "screen-reader" });
    }
    recorder.append("backend.output", { text: "  " }, { source: "screen-reader" });
    const analysis = await analyzeTrace(await recorder.finalize({ status: "inconclusive" }));
    expect(analysis.summary).toContain("0 readable screen-reader output events");
    expect(analysis.findings.map((finding) => finding.id)).toContain("missing-speech-evidence");
  });

  it("distinguishes privacy-redacted output from readable speech and absent evidence", async () => {
    const { trace } = await fixture();
    const report = await analyzeTrace(trace);
    expect(report.summary).toContain("1 redacted output events");
    expect(report.summary).not.toContain('keyboard screenshot observations');
    expect(report.findings.map((finding) => finding.id)).toContain("redacted-speech-evidence");
    expect(report.findings.map((finding) => finding.id)).not.toContain("missing-speech-evidence");
  });

  it('recognizes browser navigation boundaries and rejected policy decisions from their actual sources', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-policy-analysis-'));
    const recorder = new TraceRecorder({ id: 'policy-boundaries', mode: 'screenreader' }, dir);
    await recorder.initialize();
    const navigation = recorder.append('browser.navigation-blocked', { url: 'https://elsewhere.test', reason: 'outside navigation policy' }, { source: 'browser-diagnostic' });
    const rejection = recorder.append('policy.rejected', { step: 2, action: { kind: 'intent', intent: 'forbidden' }, reasonCode: 'unsupported-intent' }, { source: 'policy' });
    recorder.append('policy.rejected', { passed: false }, { source: 'verifier' });
    const trace = await recorder.finalize({ status: 'failure' });
    const analysis = await analyzeTrace(trace);
    expect(analysis.findings.find((finding) => finding.id === 'policy-block')?.evidenceEventIds).toEqual([navigation.id, rejection.id]);
    expect(analysis.summary).toContain('2 policy boundary events');
  });

  it.each(['task', 'metadata'] as const)('recognizes keyboard mode from %s before any screenshot exists', async (source) => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-keyboard-startup-analysis-'));
    const recorder = new TraceRecorder({ id: 'failed-keyboard-startup', ...(source === 'task' ? { mode: 'keyboard' as const } : {}) }, dir);
    await recorder.initialize();
    if (source === 'metadata') recorder.append('backend.metadata', { backend: 'legacy-keyboard', observationKind: 'keyboard' });
    recorder.append('run.error', { message: 'Browser startup failed' });
    const analysis = await analyzeTrace(await recorder.finalize({ status: 'failure' }));
    expect(analysis.summary).toContain('Mode: keyboard');
    expect(analysis.summary).not.toContain('screen-reader output');
    expect(analysis.findings.map((finding) => finding.id)).not.toContain('missing-speech-evidence');
    expect(analysis.findings.map((finding) => finding.id)).toContain('missing-screenshot-evidence');
  });

  it('counts retained pixels, removed keyboard observations, and omitted diagnostics without duplicating previous images', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-screenshot-analysis-'));
    const recorder = new TraceRecorder({ id: 'keyboard-privacy', mode: 'keyboard', input: { email: 'secret@example.test' } }, dir);
    await recorder.initialize();
    const screenshot = { pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+HD0AAAAASUVORK5CYII=', viewport: { w: 1, h: 1 } };
    const retained = recorder.append('keyboard.observation', { screenshot, previousScreenshot: screenshot, note: 'secret@example.test' });
    const removed = recorder.append('keyboard.observation', { screenshot: '[REDACTED]' }, { redacted: true });
    const diagnostic = recorder.append('browser.screenshot', { path: 'diagnostics/step-1.png' }, { source: 'browser-diagnostic' });
    const omitted = recorder.append('browser.screenshot-redacted', { step: 2, policyVisible: false }, { source: 'browser-diagnostic', redacted: true });
    const trace = await recorder.finalize({ status: 'success' });
    const inventory = summarizeTraceEvidence(trace);
    expect(retained.redacted).toBe(true);
    expect(inventory.readableScreenshotEvents.map((event) => event.id)).toEqual([retained.id]);
    expect(inventory.redactedScreenshotEvents.map((event) => event.id)).toEqual([removed.id]);
    expect(inventory.diagnosticScreenshotEvents.map((event) => event.id)).toEqual([diagnostic.id]);
    expect(inventory.redactedDiagnosticScreenshotEvents.map((event) => event.id)).toEqual([omitted.id]);
    const analysis = await analyzeTrace(trace);
    expect(analysis.summary).toContain('1 readable keyboard screenshot observations');
    expect(analysis.summary).not.toContain('screen-reader output');
    expect(analysis.summary).toContain('1 keyboard screenshot observations removed for privacy');
    expect(analysis.summary).toContain('1 recorded diagnostic screenshot references');
    expect(analysis.summary).toContain('1 diagnostic screenshots omitted for privacy');
    expect(analysis.summary).toContain('3 total redacted events');
    expect(analysis.findings.find((finding) => finding.id === 'redacted-screenshot-evidence')?.evidenceEventIds).toEqual([removed.id]);
    expect(analysis.findings.find((finding) => finding.id === 'redacted-diagnostic-screenshots')?.evidenceEventIds).toEqual([omitted.id]);
    expect(analysis.findings.map((finding) => finding.id)).not.toContain('missing-speech-evidence');
  });

  it('includes both observation modalities when the saved trace contains both', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-mixed-analysis-'));
    const recorder = new TraceRecorder({ id: 'mixed-evidence', mode: 'keyboard' }, dir);
    await recorder.initialize();
    recorder.append('screen-reader.output', { text: 'Save button' }, { source: 'screen-reader' });
    recorder.append('keyboard.observation', { screenshot: '[REDACTED]' }, { redacted: true });
    const analysis = await analyzeTrace(await recorder.finalize({ status: 'inconclusive' }));
    expect(analysis.summary).toContain('Mode: mixed');
    expect(analysis.summary).toContain('1 readable screen-reader output events');
    expect(analysis.summary).toContain('1 keyboard screenshot observations removed for privacy');
  });

  it('counts observed verifier witnesses separately from verdicts and preserves failed attempts on a successful run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-verifier-analysis-'));
    const recorder = new TraceRecorder({ id: 'verifier-privacy', mode: 'screenreader' }, dir);
    await recorder.initialize();
    recorder.append('verifier.evidence', { ruleIndex: 0, ruleType: 'titleIncludes', passed: false, witness: { kind: 'title', title: 'Pending' } }, { source: 'verifier' });
    const redacted = recorder.append('verifier.evidence', { ruleIndex: 1, ruleType: 'responseSeen', passed: false, witness: { kind: 'response', status: 403, ok: false } }, { source: 'verifier', redacted: true });
    const failed = recorder.append('verifier.result', { step: 1, passed: false, failures: ['Verification failed'] }, { source: 'verifier' });
    recorder.append('verifier.result', { step: 2, passed: true, failures: [] }, { source: 'verifier' });
    recorder.append('verifier.evidence', { passed: true }, { source: 'verifier' });
    const trace = await recorder.finalize({ status: 'success', reason: 'verified' });
    const analysis = await analyzeTrace(trace);
    expect(analysis.summary).toContain('1 readable verifier evidence events');
    expect(analysis.summary).toContain('1 redacted verifier evidence events');
    expect(analysis.summary).toContain('1 failed verification attempts');
    expect(analysis.runOutcome?.status).toBe('success');
    expect(analysis.findings.find((finding) => finding.id === 'verification-failure')?.evidenceEventIds).toEqual([failed.id]);
    expect(analysis.findings.find((finding) => finding.id === 'redacted-verifier-evidence')?.evidenceEventIds).toEqual([redacted.id]);
    expect(analysis.findings.find((finding) => finding.id === 'verification-failure')?.description).toContain('Later attempts may have succeeded');
  });
});
