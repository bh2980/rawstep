import { describe, expect, it } from "vitest";
import { DEFAULT_HINT_THRESHOLDS, HINTS_SCHEMA_VERSION, extractHints, selectReference, summarizeRun } from "@rawstep/reports/hints";
import type { HintKind } from "@rawstep/reports/hints";
import type { RunOutcome, RunTrace, TraceEvent } from "@rawstep/core/trace";

type Pair = readonly [type: string, data: Record<string, unknown>];
const timestamp = "2026-01-01T00:00:00.000Z";
const frameA = Buffer.from("frame-a").toString("base64");
const frameB = Buffer.from("frame-b").toString("base64");

/** Builds a trace whose events are the given (type, data) pairs with sequential ids. */
function trace(pairs: readonly Pair[], outcome?: RunOutcome, overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    schemaVersion: "2.1", runId: "hints-test", task: { id: "hints" },
    environment: { platform: "test", platformVersion: "1", browser: "test", browserVersion: "1", screenReader: "none", screenReaderVersion: "0" },
    startedAt: timestamp, endedAt: "2026-01-01T00:00:05.000Z",
    events: pairs.map(([type, data], index): TraceEvent => ({
      id: `event-${index + 1}`, seq: index + 1, timestamp, type, source: type.startsWith("policy.") ? "policy" : "runner", data, redacted: false,
    })),
    ...(outcome ? { outcome } : {}),
    privacy: { inputValues: "redacted", redactionApplied: false },
    ...overrides,
  };
}
const decide = (step: number, key: string): Pair => ["policy.decision", { step, decision: { action: { kind: "key", key } } }];
const result = (step: number, ok = true): Pair => ["action.result", { step, ok }];
const frame = (pngBase64: string): Pair => ["keyboard.observation", { screenshot: { pngBase64 } }];
const observer = (kind: string, step: number, extra: Record<string, unknown> = {}): Pair => [`observer.${kind}`, { kind, step, at: timestamp, ...extra }];
/** One policy step: a key decision, its result and the observation that follows. */
const press = (step: number, key: string, pixels = `step-${step}`): Pair[] => [decide(step, key), result(step), frame(Buffer.from(pixels).toString("base64"))];
const kinds = (pairs: readonly Pair[], outcome?: RunOutcome, options?: Parameters<typeof extractHints>[1]) => extractHints(trace(pairs, outcome), options).hints.map(hint => hint.kind);
const find = (report: ReturnType<typeof extractHints>, kind: HintKind) => report.hints.filter(hint => hint.kind === kind);
const success = (steps: number): RunOutcome => ({ status: "success", steps });

describe("friction hints", () => {
  it("reports a slow run only against a successful reference at the ratio and the minimum extra steps", () => {
    const reference = trace([], success(4), { runId: "reference" });
    const slow = extractHints(trace([], success(7)), { reference });
    expect(find(slow, "slow-run")).toHaveLength(1);
    expect(find(slow, "slow-run")[0]).toMatchObject({ certainty: "observed", steps: [], detail: { steps: 7, referenceSteps: 4, referenceRunId: "reference" } });
    expect(slow.reference).toMatchObject({ runId: "reference", steps: 4, goalReached: true });
    expect(find(extractHints(trace([], success(6)), { reference }), "slow-run")).toHaveLength(0); // ratio met, fewer than 3 extra steps
    expect(find(extractHints(trace([], success(13)), { reference: trace([], success(10)) }), "slow-run")).toHaveLength(0); // +3 steps, below the 1.5 ratio
    expect(find(extractHints(trace([], success(7))), "slow-run")).toHaveLength(0);
  });

  it("does not report a slow run when the reference did not reach the goal", () => {
    const failed = trace([], { status: "failure", reason: "verification-failed", steps: 2 }, { runId: "failed-reference" });
    const report = extractHints(trace([], success(20)), { reference: failed });
    expect(find(report, "slow-run")).toHaveLength(0);
    expect(report.reference).toMatchObject({ goalReached: false });
  });

  it("summarizes a run and selects the shortest successful run as the reference", () => {
    expect(summarizeRun(trace([], success(5)))).toEqual({ runId: "hints-test", steps: 5, durationMs: 5000, goalReached: true });
    expect(summarizeRun(trace([], { status: "failure", steps: 3 }, { endedAt: undefined }))).toEqual({ runId: "hints-test", steps: 3, durationMs: null, goalReached: false });
    expect(summarizeRun(trace([])).steps).toBe(0);
    const runs = [
      trace([], { status: "failure", steps: 2 }, { runId: "short-failure" }),
      trace([], success(8), { runId: "long-success" }),
      trace([], success(5), { runId: "short-success" }),
    ];
    expect(selectReference(runs)?.runId).toBe("short-success");
    expect(selectReference([runs[0]!])).toBeUndefined();
    expect(selectReference([])).toBeUndefined();
  });

  it("reports ten navigation keys before an activation with the target from the last earlier focus event", () => {
    const tabs = Array.from({ length: 10 }, (_, index) => press(index + 1, "Tab"));
    const pairs: Pair[] = [
      ...tabs.slice(0, 5).flat(),
      observer("focus", 5, { role: "link", name: "Skip" }),
      ...tabs.slice(5).flat(),
      observer("focus", 10, { role: "button", name: "Buy now" }),
      ...press(11, "Enter"),
      observer("focus", 11, { role: "heading", name: "After activation" }),
    ];
    const report = extractHints(trace(pairs, success(11)));
    const [hint] = find(report, "excess-keystrokes");
    expect(find(report, "excess-keystrokes")).toHaveLength(1);
    expect(hint).toMatchObject({ certainty: "observed", steps: [1, 11], detail: { count: 10, keys: { Tab: 10 }, target: { role: "button", name: "Buy now" } } });
    expect(hint!.summary).toContain('button "Buy now"');
    expect(hint!.evidence).toContain("event-" + (pairs.findIndex(([type, data]) => type === "observer.focus" && data.step === 10) + 1));
  });

  it("does not report nine navigation keys but a lower keystroke threshold does", () => {
    const nine = [...Array.from({ length: 9 }, (_, index) => press(index + 1, "Tab")).flat(), ...press(10, "Enter")];
    expect(kinds(nine)).not.toContain("excess-keystrokes");
    const three = [...Array.from({ length: 3 }, (_, index) => press(index + 1, "Tab")).flat(), ...press(4, "Enter")];
    expect(kinds(three)).not.toContain("excess-keystrokes");
    expect(DEFAULT_HINT_THRESHOLDS.keystrokesToTarget).toBe(10);
    const report = extractHints(trace(three), { thresholds: { keystrokesToTarget: 3 } });
    expect(find(report, "excess-keystrokes")[0]).toMatchObject({ detail: { count: 3 }, steps: [1, 4] });
    expect(find(report, "excess-keystrokes")[0]!.detail).not.toHaveProperty("target");
  });

  it("reports backtracking after two direction reversals but not after one", () => {
    const twice = [...press(1, "Tab"), ...press(2, "Shift+Tab"), ...press(3, "Tab")];
    const [hint] = find(extractHints(trace(twice)), "backtracking");
    expect(hint).toMatchObject({ certainty: "observed", steps: [2, 3], detail: { reversals: 2 } });
    expect(kinds([...press(1, "Tab"), ...press(2, "Shift+Tab")])).not.toContain("backtracking");
  });

  it("reports a screen seen three times", () => {
    const pairs: Pair[] = [frame(frameA), decide(1, "Tab"), frame(frameB), decide(2, "Tab"), frame(frameA), decide(3, "Tab"), frame(frameA)];
    const [hint] = find(extractHints(trace(pairs)), "repeated-state");
    expect(hint).toMatchObject({ certainty: "observed", steps: [0, 2, 3], detail: { visits: 3 } });
    expect(hint!.evidence).toEqual(["event-1", "event-5", "event-7"]);
    expect(kinds([frame(frameA), frame(frameB), frame(frameA)])).not.toContain("repeated-state");
  });

  it("reports observed focus loss after the initial step and ignores it at step 0", () => {
    const pairs: Pair[] = [observer("focus-lost", 0, { role: "button", name: "Gone", reason: "removed" }), ...press(1, "Tab"), ...press(2, "Enter"), observer("focus-lost", 2, { role: "button", name: "Dismiss", reason: "removed" })];
    const report = extractHints(trace(pairs));
    expect(find(report, "focus-lost")).toHaveLength(1);
    expect(find(report, "focus-lost")[0]).toMatchObject({ certainty: "observed", steps: [2], detail: { from: { role: "button", name: "Dismiss" }, reason: "removed", action: "Enter" } });
    expect(kinds([observer("focus-lost", 0, { role: "button", name: "Gone" })])).toEqual([]);
  });

  it("reports focus that is not visible as observed and a missing focus indicator as suspected", () => {
    const observed = extractHints(trace([...press(1, "Tab"), observer("focus", 1, { role: "link", name: "Hidden", visible: false })]));
    expect(find(observed, "focus-not-visible")).toMatchObject([{ certainty: "observed", steps: [1], detail: { visible: false } }]);
    const offscreen = extractHints(trace([...press(1, "Tab"), observer("focus", 1, { role: "link", name: "Below", visible: true, inViewport: false })]));
    expect(find(offscreen, "focus-not-visible")[0]!.summary).toContain("outside the viewport");
    const suspected = extractHints(trace([...press(1, "Tab"), ["browser.accessibility-diagnostic", { step: 1, diagnostic: { focus: { indicator: "not-detected" } } }]]));
    expect(find(suspected, "focus-not-visible")).toMatchObject([{ certainty: "suspected", steps: [1], detail: { indicator: "not-detected" } }]);
    const occluded = extractHints(trace([["browser.accessibility-diagnostic", { step: 2, diagnostic: { focus: { centerOccluded: true, indicator: "outline" } } }]]));
    expect(find(occluded, "focus-not-visible")[0]).toMatchObject({ certainty: "suspected", detail: { centerOccluded: true } });
    expect(kinds([["browser.accessibility-diagnostic", { step: 1, diagnostic: { focus: { indicator: "outline" } } }]])).toEqual([]);
  });

  it("reports focus outside an open modal as observed and a dialog that did not take focus as suspected", () => {
    const observed = extractHints(trace([...press(1, "Enter"), observer("focus", 3, { role: "button", name: "Behind", modalOpen: true, inDialog: false })]));
    expect(find(observed, "modal-focus-outside")).toMatchObject([{ certainty: "observed", steps: [3] }]);
    expect(find(extractHints(trace([observer("focus", 3, { role: "button", modalOpen: true, inDialog: true })])), "modal-focus-outside")).toHaveLength(0);
    const suspected = extractHints(trace([...press(2, "Enter"), observer("appeared", 2, { role: "dialog", name: "Settings" })]));
    expect(find(suspected, "modal-focus-outside")).toMatchObject([{ certainty: "suspected", steps: [2], detail: { dialog: { role: "dialog", name: "Settings" } } }]);
    const moved = extractHints(trace([...press(2, "Enter"), observer("appeared", 2, { role: "dialog", name: "Settings" }), observer("focus", 2, { role: "button", name: "Close", inDialog: true, modalOpen: true })]));
    expect(find(moved, "modal-focus-outside")).toHaveLength(0);
  });

  describe("missing announcement", () => {
    const base: Pair[] = [observer("focus", 1, { role: "button", name: "Menu" }), ...press(2, "Enter")];
    const withEvents = (...events: Pair[]) => extractHints(trace([...base, ...events]));

    it("is suspected when a different element changed state and nothing else was observed in the step", () => {
      const report = withEvents(observer("state", 2, { role: "button", name: "Other", attr: "aria-expanded", value: "true" }));
      expect(find(report, "missing-announcement")).toMatchObject([{ certainty: "suspected", steps: [2], detail: { changes: ['aria-expanded on button "Other"'] } }]);
    });

    it("is not reported when a live region was updated in the same step", () => {
      const report = withEvents(observer("state", 2, { role: "button", name: "Other", attr: "aria-expanded" }), observer("live-region", 2, { role: "status", text: "Done", politeness: "polite" }));
      expect(find(report, "missing-announcement")).toHaveLength(0);
    });

    it("is not reported when the state change is on the currently focused element", () => {
      const report = withEvents(observer("state", 2, { role: "button", name: "Menu", attr: "aria-expanded", value: "true" }));
      expect(find(report, "missing-announcement")).toHaveLength(0);
    });

    it("is not reported for failed activations", () => {
      const pairs: Pair[] = [observer("focus", 1, { role: "button", name: "Menu" }), decide(2, "Enter"), result(2, false), observer("state", 2, { role: "button", name: "Other", attr: "aria-expanded" })];
      expect(kinds(pairs)).not.toContain("missing-announcement");
    });

    it("is unavailable without observer events and the limitations say so", () => {
      const report = extractHints(trace([frame(frameA), ...press(1, "Enter", "changed")]));
      expect(find(report, "missing-announcement")).toHaveLength(0);
      expect(report.limitations.join(" ")).toMatch(/observer/);
      expect(extractHints(trace(base)).limitations.join(" ")).not.toMatch(/No page observer events/);
    });
  });

  it("reports a focus change observed while the screen stayed the same", () => {
    const pairs: Pair[] = [frame(frameA), decide(1, "Tab"), result(1), frame(frameA), observer("focus", 1, { role: "link", name: "Invisible" })];
    expect(find(extractHints(trace(pairs)), "invisible-focus-change")).toMatchObject([{ certainty: "observed", steps: [1], detail: { target: { role: "link", name: "Invisible" } } }]);
    const changed: Pair[] = [frame(frameA), decide(1, "Tab"), result(1), frame(frameB), observer("focus", 1, { role: "link", name: "Visible" })];
    expect(kinds(changed)).not.toContain("invisible-focus-change");
    expect(kinds([frame(frameA), decide(1, "Tab"), result(1), frame(frameA)])).not.toContain("invisible-focus-change");
  });

  it("reports a low-margin or low-probability model choice but not a confident one", () => {
    const evidence = (probabilities: number[]): Pair => ["policy.evidence", { step: 3, evidence: { kind: "model-inference", choices: [{ id: "key:Tab" }, { id: "key:Enter" }], choiceId: "key:Tab", probabilities } }];
    const [hint] = find(extractHints(trace([evidence([0.45, 0.4])])), "model-hesitation");
    expect(hint).toMatchObject({ certainty: "suspected", steps: [3], detail: { choiceId: "key:Tab", probability: 0.45, runnerUp: 0.4 } });
    expect(kinds([evidence([0.52, 0.45])])).toContain("model-hesitation"); // above 0.5 but within the 0.1 margin
    expect(kinds([evidence([0.9, 0.1])])).not.toContain("model-hesitation");
    expect(kinds([["policy.evidence", { step: 3, evidence: { kind: "model-inference", choices: [{ id: "key:Tab" }], choiceId: "key:Missing", probabilities: [0.1] } }]])).toEqual([]);
  });

  it("reports an early stop from a stuck model or from the exploration guard", () => {
    expect(find(extractHints(trace([], { status: "failure", reason: "policy-stuck", step: 4, steps: 4 })), "early-stop")).toMatchObject([{ certainty: "observed", steps: [4], detail: { reason: "policy-stuck" } }]);
    const guard = find(extractHints(trace([], { status: "failure", reason: "policy-uncertain", policyStopSource: "exploration-guard", step: 6 })), "early-stop");
    expect(guard).toMatchObject([{ steps: [6], detail: { stopSource: "exploration-guard" } }]);
    expect(guard[0]!.summary).toContain("repetition guard");
    expect(kinds([], { status: "failure", reason: "verification-failed", step: 2 })).not.toContain("early-stop");
    expect(kinds([], success(2))).not.toContain("early-stop");
  });

  it("notes redaction in the limitations when observer names were redacted", () => {
    const report = extractHints(trace([...press(1, "Enter"), observer("focus-lost", 1, { role: "button", name: "[REDACTED]", reason: "removed" })]));
    expect(report.limitations.join(" ")).toMatch(/redacted/i);
    expect(find(report, "focus-lost")[0]!.summary).not.toContain("REDACTED");
    const plain = extractHints(trace([observer("focus", 1, { role: "button", name: "Save" })]));
    expect(plain.limitations.join(" ")).not.toMatch(/redacted/i);
  });

  it("sorts hints by their first step and reports the schema version, task id and goal status", () => {
    const pairs: Pair[] = [
      ["policy.evidence", { step: 2, evidence: { kind: "model-inference", choices: [{ id: "a" }, { id: "b" }], choiceId: "a", probabilities: [0.4, 0.4] } }],
      ...press(4, "Enter"), observer("focus-lost", 4, { role: "button", name: "Gone", reason: "removed" }),
      observer("focus", 3, { role: "button", name: "Behind", modalOpen: true, inDialog: false }),
    ];
    const report = extractHints(trace(pairs, success(7)), { reference: trace([], success(2)) });
    expect(report.hints.map(hint => hint.kind)).toEqual(["slow-run", "model-hesitation", "modal-focus-outside", "focus-lost"]);
    expect(report).toMatchObject({ schemaVersion: "1.0", taskId: "hints", runId: "hints-test", steps: 7, goalReached: true, outcome: { status: "success" } });
    expect(HINTS_SCHEMA_VERSION).toBe("1.0");
    expect(extractHints(trace([], { status: "failure", reason: "verification-failed", steps: 3 }))).toMatchObject({ goalReached: false, outcome: { status: "failure", reason: "verification-failed" } });
    expect(extractHints(trace([])).outcome).toBeUndefined();
  });
  describe("goal met at start", () => {
    const baselineRule = (ruleIndex: number, ruleType: string, passed: boolean) => ({ ruleIndex, ruleType, passed });
    const baseline = (passed: boolean, rules: ReturnType<typeof baselineRule>[]): Pair => ["verifier.baseline", { passed, rules }];

    it("observes a goal that already held before the first action", () => {
      const pairs: Pair[] = [baseline(true, [baselineRule(0, "titleIncludes", true), baselineRule(1, "textVisible", true)]), ...press(1, "Tab")];
      const report = extractHints(trace(pairs, success(1)));
      expect(find(report, "goal-met-at-start")).toEqual([{
        kind: "goal-met-at-start", certainty: "observed", steps: [0], summary: "Every goal rule already held before the first action.",
        detail: { rules: [{ ruleIndex: 0, ruleType: "titleIncludes" }, { ruleIndex: 1, ruleType: "textVisible" }] }, evidence: ["event-1"],
      }]);
    });

    it("suspects a goal when only some rules held at the start and lists those rules", () => {
      const report = extractHints(trace([baseline(false, [baselineRule(0, "titleIncludes", true), baselineRule(1, "event", false), baselineRule(2, "urlIncludes", true)])], success(3)));
      const [hint] = find(report, "goal-met-at-start");
      expect(find(report, "goal-met-at-start")).toHaveLength(1);
      expect(hint).toMatchObject({ certainty: "suspected", steps: [0], summary: "2 goal rule(s) already held before the first action.", detail: { rules: [{ ruleIndex: 0, ruleType: "titleIncludes" }, { ruleIndex: 2, ruleType: "urlIncludes" }] }, evidence: ["event-1"] });
    });

    it("ignores not rules, which hold at the start by design", () => {
      expect(kinds([baseline(false, [baselineRule(0, "not", true), baselineRule(1, "event", false)])])).not.toContain("goal-met-at-start");
      expect(kinds([baseline(true, [baselineRule(0, "not", true)])])).not.toContain("goal-met-at-start");
      // A not rule passing alongside real rules is left out of the reported rules and the count, but does not stop the hint.
      const mixed = extractHints(trace([baseline(true, [baselineRule(0, "not", true), baselineRule(1, "titleIncludes", true)])]));
      expect(find(mixed, "goal-met-at-start")[0]).toMatchObject({ certainty: "observed", summary: "Every goal rule already held before the first action.", detail: { rules: [{ ruleIndex: 1, ruleType: "titleIncludes" }] } });
      const partial = extractHints(trace([baseline(false, [baselineRule(0, "not", true), baselineRule(1, "titleIncludes", true), baselineRule(2, "event", false)])]));
      expect(find(partial, "goal-met-at-start")[0]).toMatchObject({ certainty: "suspected", summary: "1 goal rule(s) already held before the first action.", detail: { rules: [{ ruleIndex: 1, ruleType: "titleIncludes" }] } });
    });

    it("reports nothing when no rule held, the baseline errored, or there is no baseline", () => {
      expect(kinds([baseline(false, [baselineRule(0, "titleIncludes", false), baselineRule(1, "event", false)])])).not.toContain("goal-met-at-start");
      expect(kinds([baseline(true, [])])).not.toContain("goal-met-at-start");
      expect(kinds([["verifier.baseline", { error: "TypeError" }]])).not.toContain("goal-met-at-start");
      expect(kinds([["verifier.baseline", { passed: true }]])).not.toContain("goal-met-at-start");
      expect(kinds([...press(1, "Tab")], success(1))).not.toContain("goal-met-at-start");
      expect(find(extractHints(trace([])), "goal-met-at-start")).toEqual([]);
    });

    it("uses only the first baseline and sorts the hint ahead of later ones", () => {
      const pairs: Pair[] = [baseline(true, [baselineRule(0, "titleIncludes", true)]), baseline(false, [baselineRule(0, "titleIncludes", false)]), ...press(1, "Tab"), observer("focus-lost", 1, { name: "Gone", reason: "removed" })];
      const report = extractHints(trace(pairs, success(1)));
      expect(find(report, "goal-met-at-start")).toHaveLength(1);
      expect(find(report, "goal-met-at-start")[0]!.certainty).toBe("observed");
      expect(report.hints.map(hint => hint.kind)).toEqual(["goal-met-at-start", "focus-lost"]);
    });
  });
});
