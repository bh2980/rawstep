import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { REPORT_CSP, REPORT_SCRIPT, renderReportHtml, summarizeTrace, writeReport } from "@rawstep/reports/report";
import { createHash } from "node:crypto";
import type { RunTrace, TraceEvent } from "@rawstep/core/trace";
import { extractHints, type HintReport } from "@rawstep/reports/hints";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const timestamp = "2026-01-01T00:00:00.000Z";
function fixture(events: Array<Pick<TraceEvent, "type" | "data"> & Partial<TraceEvent>>): RunTrace {
  return {
    schemaVersion: "3.0", runId: "report-test", task: { id: "report" },
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
    } });
    const document = new JSDOM(renderReportHtml(trace)).window.document;
    expect(document.querySelector('[aria-labelledby=outcome]')?.textContent).toContain('Simulated VoiceOver run');
    expect(document.querySelector('[aria-labelledby=outcome] strong')?.textContent).toContain('This is not Apple VoiceOver');
    expect(document.querySelector('[aria-labelledby=privacy]')?.textContent).toContain('1 simulated output events redacted');
    expect(document.querySelector('[aria-labelledby=privacy]')?.textContent).not.toContain('native screen-reader output');
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
    ]);
    const document = new JSDOM(renderReportHtml(mixed)).window.document;
    expect(summarizeTrace(mixed).modalities).toEqual(['screenreader', 'simulation']);
    expect(document.querySelector('[aria-labelledby=outcome]')?.textContent).toContain('1 readable native screen-reader output events');
    expect(document.querySelector('[aria-labelledby=outcome]')?.textContent).toContain('1 readable simulated output events');
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

  it("counts real output and diagnostic screenshots, including the ones omitted for privacy", () => {
    const trace = fixture([
      { type: "browser.screenshot", source: "browser-diagnostic", data: { path: "diagnostics/step-1.png" } },
      { type: "browser.screenshot-redacted", source: "browser-diagnostic", redacted: true, data: { step: 2, reason: "Input privacy" } },
      { type: "backend.response", source: "screen-reader", data: { speech: ["Not actual output"] } },
    ]);
    expect(summarizeTrace(trace)).toMatchObject({ counts: {
      events: 3, redactedEvents: 1, diagnosticScreenshots: 1, withheldDiagnosticScreenshots: 1, readableSpeechEvents: 0, redactedSpeechEvents: 0,
    } });
    const document = new JSDOM(renderReportHtml(trace)).window.document;
    expect(document.body.textContent).toContain("1 diagnostic screenshot references");
    expect(document.body.textContent).toContain("1 diagnostic screenshots omitted for privacy");
    expect(document.querySelectorAll("img")).toHaveLength(0);
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
    // The one script is the fixed language switch: nothing from the trace reaches it, and nothing else may run.
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(document.querySelector("script")?.hasAttribute("src")).toBe(false);
    expect(document.querySelector("script")?.textContent).toBe(REPORT_SCRIPT);
    expect(document.querySelectorAll("[onclick], [onerror]")).toHaveLength(0);
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
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(document.querySelector("script")?.textContent).not.toContain("alert(1)");
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
  it("opens with the task and its goal, then what was hard, then how it ended and what it cost, with the run id last", () => {
    const trace = fixture([{ type: "action.result", data: { step: 1, action: { kind: "key", key: "Tab" }, ok: true } }]);
    trace.task = { id: "subscribe", goal: "Subscribe to the newsletter" };
    trace.outcome = { status: "success", reason: "verified", steps: 11 };
    const html = renderReportHtml(trace), document = new JSDOM(html).window.document;
    expect(document.querySelector("h1")?.textContent).toBe("subscribe · Subscribe to the newsletter");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    // A generated id is no name: the project's name is used, else the goal alone.
    trace.task = { id: "8fe6c420-9834-41ef-85a6-83f3c14e5422", goal: "Subscribe to the newsletter" };
    expect(new JSDOM(renderReportHtml(trace)).window.document.querySelector("h1")?.textContent).toBe("Subscribe to the newsletter");
    expect(new JSDOM(renderReportHtml(trace, undefined, { taskName: "Newsletter" })).window.document.querySelector("h1")?.textContent).toBe("Newsletter · Subscribe to the newsletter");
    trace.task = { id: "subscribe", goal: "Subscribe to the newsletter" };
    expect(html.indexOf('id="hard"')).toBeGreaterThan(html.indexOf("<h1>"));
    expect(html.indexOf('id="ending"')).toBeGreaterThan(html.indexOf('id="hard"'));
    expect(html.indexOf('id="outcome"')).toBeGreaterThan(html.indexOf('id="ending"'));
    // The ending is a cost in words, with no pass mark.
    expect([...document.querySelectorAll(".ending .l-en")].map(node => node.textContent)).toEqual(["Reached the goal", "11 moves"]);
    expect([...document.querySelectorAll(".ending .l-ko")].map(node => node.textContent)).toEqual(["목표에 닿음", "11번 행동"]);
    expect(html).not.toMatch(/✓|✔|class="pass/);
    const footer = document.querySelector("body > footer")!;
    expect(footer.textContent).toContain("report-test");
    expect(document.body.lastElementChild).toBe(footer);
    expect(document.querySelector("header")?.textContent).not.toContain("report-test");
  });

  it("says what was hard from the stuck places, wrong guesses, the stretch and why it stopped", () => {
    const trace = fixture([{ type: "run.error", data: { message: "x" } }]);
    trace.task = { id: "subscribe", goal: "Subscribe" };
    trace.outcome = { status: "failure", reason: "policy-stuck", steps: 34, policyStopSource: "user-gave-up" };
    const base = extractHints(trace), broke = (steps: number[], detail: Record<string, unknown>, target?: { role: string; name?: string }): HintReport["hints"][number] =>
      ({ kind: "expectation-broken", source: "model", ...(target ? { target } : {}), certainty: "observed", steps, summary: "", detail, evidence: [] });
    const hints: HintReport = { ...base, hints: [
      broke([4], { pressed: 3, assumption: { id: "A1", text: "It is a button" } }, { role: "button", name: "Subscribe" }),
      broke([9], { pressed: 8, assumption: { id: "A1", text: "It is a button" } }, { role: "button", name: "Subscribe" }),
      broke([12], { assumption: { id: "A2", text: "The form follows the heading" } }),
      broke([14], { assumption: { id: "A3", text: "x" }, trigger: "goal-heard", pressed: 13 }, { role: "heading", name: "Hammer" }),
      { kind: "goal-word-stretch", source: "run", certainty: "observed", steps: [2, 20], summary: "", detail: { moves: 18 }, evidence: [] },
      { kind: "early-stop", source: "model", certainty: "observed", steps: [34], summary: "", detail: { stopSource: "user-gave-up", giveUp: { reason: "Nothing subscribes", tried: ["A1"] } }, evidence: [] },
    ] };
    const hard = new JSDOM(renderReportHtml(trace, undefined, { hints })).window.document.querySelector("#hard")!.closest("section")!;
    const english = [...hard.querySelectorAll("li .l-en")].map(node => node.textContent);
    expect(english).toEqual([
      "pressed, and it did not respond as the user expected (steps 4, 9).",
      "1 guess about where something is turned out wrong.",
      "18 moves in a row without hearing a word about the goal.",
      "The user gave up: nothing they heard left another way to try. In their words: Nothing subscribes",
      "First recorded problem: x",
    ]);
    expect(hard.querySelector("li strong")?.textContent).toBe("button “Subscribe”");
    // Coming upon the goal while after something else broke an expectation at no cost: not a stuck place.
    expect(hard.textContent).not.toContain("Hammer");
    expect(hard.querySelector("li .l-ko")?.textContent).toBe("눌렀지만 사용자의 예상대로 반응하지 않았습니다 (행동 4, 9번).");
    // Without hints the report says so instead of listing nothing as if all were well.
    const bare = new JSDOM(renderReportHtml(trace)).window.document.querySelector("#hard")!.closest("section")!;
    expect(bare.textContent).toContain("made without friction hints");
    const quiet = fixture([{ type: "run.error", data: { message: "x" } }]);
    quiet.outcome = { status: "success", steps: 3 };
    expect(new JSDOM(renderReportHtml(quiet, undefined, { hints: extractHints(quiet) })).window.document.querySelector("#hard")!.closest("section")!.textContent).toContain("does not mean nothing was hard");
  });

  it("words a run that was stopped by a limit as not measured, with the limit", () => {
    const trace = fixture([]);
    trace.outcome = { status: "inconclusive", reason: "maxSteps", steps: 40 };
    const document = new JSDOM(renderReportHtml(trace)).window.document;
    expect([...document.querySelectorAll(".ending .l-en")].map(node => node.textContent)).toEqual(["Not measured", "40 moves"]);
    expect(document.querySelector("#ending")!.closest("section")!.textContent).toContain("Stopped by the move limit.");
    expect(document.querySelector("#hard")!.closest("section")!.textContent).toContain("says nothing about the user");
  });

  it("carries every sentence in English and Korean, and the language follows the reader", () => {
    const trace = fixture([{ type: "run.error", data: { message: "Browser unavailable", stage: "browser.start", step: 0 } }]);
    const html = renderReportHtml(trace, undefined, { hints: extractHints(trace) });
    const document = new JSDOM(html).window.document;
    // Each English phrase has its Korean beside it, so a switch cannot leave a half-translated page.
    const english = document.querySelectorAll(".l-en"), korean = document.querySelectorAll(".l-ko");
    expect(english.length).toBeGreaterThan(25);
    expect(korean).toHaveLength(english.length);
    for (const node of english) expect(node.nextElementSibling?.classList.contains("l-ko")).toBe(true);
    expect(document.documentElement.lang).toBe("en");
    expect([...document.querySelectorAll("[data-lang]")].map(button => [button.getAttribute("data-lang"), button.textContent])).toEqual([["en", "English"], ["ko", "한국어"]]);
    expect(html).toContain("html[lang=ko] .l-en{display:none}");
    // The policy allows exactly this script, by its hash, and nothing else to run or load.
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute("content")!;
    expect(csp).toContain(`script-src 'sha256-${createHash("sha256").update(REPORT_SCRIPT).digest("base64")}'`);
    expect(csp).toBe(REPORT_CSP);
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("default-src 'none'");
  });

  it("opens in Korean for a Korean browser, keeps the reader's choice, and works when storage is blocked", async () => {
    const html = renderReportHtml(fixture([]));
    const open = (languages: string[], storage?: Record<string, string> | "blocked") => {
      // An opaque origin has no storage: reading it throws, as it does when a browser blocks site data.
      const dom = new JSDOM(html, { runScripts: "dangerously", url: storage === "blocked" ? "about:blank" : "https://report.test/", beforeParse(window) {
        Object.defineProperty(window.navigator, "languages", { value: languages });
        if (storage !== "blocked") for (const [key, value] of Object.entries(storage ?? {})) window.localStorage.setItem(key, value);
      } });
      return dom.window;
    };
    // The switch is wired once the document has loaded.
    const loaded = (window: ReturnType<typeof open>) => window.document.readyState === "loading" ? new Promise<void>(resolve => window.document.addEventListener("DOMContentLoaded", () => resolve(), { once: true })) : Promise.resolve();
    const pressed = (window: ReturnType<typeof open>) => [...window.document.querySelectorAll("[data-lang]")].filter(button => button.getAttribute("aria-pressed") === "true").map(button => button.getAttribute("data-lang"));
    const korean = open(["ko-KR", "en"]);
    await loaded(korean);
    expect(korean.document.documentElement.lang).toBe("ko");
    expect(pressed(korean)).toEqual(["ko"]);
    expect(open(["en-US"]).document.documentElement.lang).toBe("en");
    // A saved choice beats the browser's language, and the switch saves a new one.
    const chosen = open(["ko"], { "rawstep.language": "en" });
    await loaded(chosen);
    expect(chosen.document.documentElement.lang).toBe("en");
    (chosen.document.querySelector("[data-lang=ko]") as HTMLElement).click();
    expect(chosen.document.documentElement.lang).toBe("ko");
    expect(pressed(chosen)).toEqual(["ko"]);
    expect(chosen.localStorage.getItem("rawstep.language")).toBe("ko");
    // Blocked storage costs only the memory of the choice.
    const blocked = open(["ko"], "blocked");
    await loaded(blocked);
    expect(blocked.document.documentElement.lang).toBe("ko");
    (blocked.document.querySelector("[data-lang=en]") as HTMLElement).click();
    expect(blocked.document.documentElement.lang).toBe("en");
  });
});
