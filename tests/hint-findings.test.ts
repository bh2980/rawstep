import { describe, expect, it } from "vitest";
import { aggregateHints, extractHints, HINT_SOURCES } from "@rawstep/reports/hints";
import type { Hint, HintKind, HintReport } from "@rawstep/reports/hints";
import type { RunTrace, TraceEvent } from "@rawstep/core/trace";

const timestamp = "2026-01-01T00:00:00.000Z";
type Pair = readonly [type: string, data: Record<string, unknown>];
function trace(runId: string, pairs: readonly Pair[]): RunTrace {
  return {
    schemaVersion: "2.2", runId, task: { id: "checkout" },
    environment: { platform: "test", platformVersion: "1", browser: "test", browserVersion: "1", screenReader: "none", screenReaderVersion: "0" },
    startedAt: timestamp, endedAt: "2026-01-01T00:00:05.000Z",
    events: pairs.map(([type, data], index): TraceEvent => ({ id: `event-${index + 1}`, seq: index + 1, timestamp, type, source: type.startsWith("policy.") ? "policy" : "runner", data, redacted: false })),
    outcome: { status: "success", steps: 12 },
    privacy: { inputValues: "redacted", redactionApplied: false },
  };
}
const decide = (step: number, key: string): Pair => ["policy.decision", { step, decision: { action: { kind: "key", key } } }];
const focus = (step: number, role: string, name: string): Pair => ["observer.focus", { kind: "focus", step, at: timestamp, role, name, visible: true, inViewport: true }];
/** `tabs` Tab presses walking focus through items, ending on the Checkout button, then Enter. */
function tabsToCheckout(runId: string, tabs: number): RunTrace {
  const pairs: Pair[] = [];
  for (let step = 1; step <= tabs; step++) pairs.push(decide(step, "Tab"), focus(step, "button", step === tabs ? "Checkout" : `Item ${step}`));
  pairs.push(decide(tabs + 1, "Enter"), ["observer.focus-lost", { kind: "focus-lost", step: tabs + 1, at: timestamp, role: "button", name: "Checkout", reason: "removed" }]);
  return trace(runId, pairs);
}
const hint = (kind: HintKind, target?: Hint["target"], detail: Record<string, unknown> = {}): Hint =>
  ({ kind, source: HINT_SOURCES[kind], ...(target ? { target } : {}), certainty: "observed", steps: [1], summary: kind, detail, evidence: [] });
const report = (runId: string, hints: Hint[]): Pick<HintReport, "runId" | "hints"> => ({ runId, hints });

describe("hint sources and targets", () => {
  it("tells page behaviour from model behaviour and names the element", () => {
    const hints = extractHints(tabsToCheckout("a", 11)).hints;
    const keystrokes = hints.find(h => h.kind === "excess-keystrokes")!;
    expect(keystrokes).toMatchObject({ source: "page", target: { role: "button", name: "Checkout" } });
    expect(hints.find(h => h.kind === "focus-lost")).toMatchObject({ source: "page", target: { role: "button", name: "Checkout" } });
    expect(HINT_SOURCES["model-hesitation"]).toBe("model");
    expect(HINT_SOURCES["slow-run"]).toBe("run");
  });

  it("drops redacted names from the target but keeps the role", () => {
    const hints = extractHints(trace("r", [decide(1, "Enter"), ["observer.focus-lost", { kind: "focus-lost", step: 1, at: timestamp, role: "textbox", name: "[REDACTED]", reason: "removed" }]])).hints;
    expect(hints.find(h => h.kind === "focus-lost")!.target).toEqual({ role: "textbox" });
  });
});

describe("findings across runs", () => {
  it("groups by kind and element, counts runs once each, and keeps every occurrence", () => {
    const findings = aggregateHints([
      extractHints(tabsToCheckout("run-1", 11)),
      extractHints(tabsToCheckout("run-2", 14)),
      extractHints(tabsToCheckout("run-3", 2)),
    ]);
    const keystrokes = findings.find(f => f.kind === "excess-keystrokes")!;
    expect(keystrokes).toMatchObject({ source: "page", target: { role: "button", name: "Checkout" }, runs: 2, totalRuns: 3, counts: { min: 11, max: 14, mean: 12.5 } });
    expect(keystrokes.occurrences.map(o => o.runId)).toEqual(["run-1", "run-2"]);
    expect(findings.find(f => f.kind === "focus-lost")).toMatchObject({ runs: 3, totalRuns: 3 });
  });

  it("leaves out run-level hints and sorts by how many runs show a finding", () => {
    const findings = aggregateHints([
      report("a", [hint("slow-run"), hint("model-hesitation", { role: "link", name: "Coupon" }), hint("missing-announcement", { role: "button", name: "Pay" })]),
      report("b", [hint("missing-announcement", { role: "button", name: "Pay" }), hint("missing-announcement", { role: "button", name: "Pay" })]),
      report("c", []),
    ]);
    expect(findings.map(f => [f.kind, f.runs, f.occurrences.length])).toEqual([["missing-announcement", 2, 3], ["model-hesitation", 1, 1]]);
    expect(findings.every(f => f.totalRuns === 3)).toBe(true);
  });

  it("keeps different elements apart even for the same kind", () => {
    const findings = aggregateHints([report("a", [hint("focus-lost", { role: "button", name: "Close" }), hint("focus-lost", { role: "button", name: "Save" }), hint("focus-lost", { role: "button" })])]);
    expect(findings).toHaveLength(3);
  });
});
