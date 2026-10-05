import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRedactor, readTrace, TraceRecorder, validateTrace } from "@rawstep/core/trace";

async function fixture(input?: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "rawstep-trace-v2-"));
  const recorder = new TraceRecorder({ id: "test", url: "https://example.test", input }, dir);
  await recorder.initialize();
  return { dir, recorder };
}

describe("versioned evidence trace", () => {
  it("preserves duplicate raw speech, source timestamps, command IDs and collection windows without asserting causality", async () => {
    const { dir, recorder } = await fixture();
    const window = { startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z" };
    const first = recorder.append("screen-reader.output", { text: "  Save\nbutton  ", payload: ["Save", "Save"] }, {
      commandId: "cmd-1", collectionWindow: window, timestamp: "2026-01-01T00:00:00.500Z"
    });
    recorder.append("screen-reader.output", { text: "  Save\nbutton  " }, { commandId: "cmd-2", timestamp: "2026-01-01T00:00:00.100Z" });
    await recorder.finalize({ status: "success", reason: "verified" });
    const trace = await readTrace(dir);
    expect(trace.schemaVersion).toBe("2.1");
    expect(trace.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(trace.events[0]).toMatchObject({ id: first.id, collectionWindow: window, association: "temporal-only", source: "screen-reader" });
    expect(trace.events[0]!.data).toEqual({ text: "  Save\nbutton  ", payload: ["Save", "Save"] });
    expect(trace.events[1]!.timestamp < trace.events[0]!.timestamp).toBe(true);
    expect((await readFile(join(dir, "trace.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
    expect(trace.environment).toMatchObject({ browserVersion: "unknown", screenReader: "unknown", screenReaderVersion: "unknown" });
  });

  it("redacts task input values recursively from raw events, metadata, outcomes, and both disk artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rawstep-private-v2-"));
    const recorder = new TraceRecorder({ id: "private", goal: "Sign in as test@example.test", input: { email: "test@example.test", password: "p@ss/word" } }, dir, {
      environment: { profile: "test@example.test" }
    });
    await recorder.initialize();
    const event = recorder.append("screen-reader.output", { text: "test@example.test p@ss/word", nested: [{ encoded: "p%40ss%2Fword" }] });
    expect(event.redacted).toBe(true);
    expect(JSON.stringify(event)).not.toContain("test@example.test");
    const trace = await recorder.finalize({ status: "failure", reason: "p@ss/word rejected" });
    expect(trace.task.input).toEqual({ email: "[REDACTED]", password: "[REDACTED]" });
    expect(trace.privacy).toEqual({ inputValues: "redacted", redactionApplied: true });
    for (const file of ["trace.json", "trace.jsonl"]) {
      const raw = await readFile(join(dir, file), "utf8");
      expect(raw).not.toContain("test@example.test");
      expect(raw).not.toContain("p@ss/word");
      expect(raw).not.toContain("p%40ss%2Fword");
    }
  });

  it("supports plural inputs and additional sensitive values and requires explicit raw opt-in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rawstep-inputs-v2-"));
    const recorder = new TraceRecorder({ id: "inputs", inputs: { nested: { token: "xyz-private" } } }, dir, { sensitiveValues: ["additional-private"] });
    await recorder.initialize();
    expect(recorder.append("run.note", { nested: ["xyz-private", "additional-private"] }).data).toEqual({ nested: ["[REDACTED]", "[REDACTED]"] });
    const rawDir = await mkdtemp(join(tmpdir(), "rawstep-raw-v2-"));
    const raw = new TraceRecorder({ id: "raw", input: { value: "retain-me" } }, rawDir, { includeSensitiveInputValues: true });
    await raw.initialize();
    raw.append("screen-reader.output", { text: "retain-me" });
    const trace = await raw.finalize({ status: "inconclusive" });
    expect(trace.privacy.inputValues).toBe("included-by-explicit-opt-in");
    expect(trace.events[0]!.data).toEqual({ text: "retain-me" });
  });

  it("does not let consumers mutate recorder state through payloads, returned events, or snapshots", async () => {
    const { recorder } = await fixture();
    const payload = { text: "original" };
    const event = recorder.append("screen-reader.output", payload);
    payload.text = "changed";
    (event.data as { text: string }).text = "changed";
    recorder.snapshot().events.length = 0;
    const trace = await recorder.finalize({ status: "success" });
    expect(trace.events[0]!.data).toEqual({ text: "original" });
    expect(() => recorder.append("run.note", {})).toThrow(/finalized/);
    await expect(recorder.finalize({ status: "failure" })).rejects.toThrow(/finalized/);
  });

  it("recovers an unfinished run and late environment metadata from its ordered journal", async () => {
    const { dir, recorder } = await fixture();
    recorder.append("run.started", {});
    const update = recorder.updateEnvironment({ browser: "chromium", browserVersion: "123", screenReader: "voiceover" });
    (update.data as { environment: { browser: string } }).environment.browser = "mutated";
    expect(recorder.snapshot().environment.browser).toBe("chromium");
    recorder.append("screen-reader.output", { text: "Hello" });
    const trace = await readTrace(dir);
    expect(trace.outcome).toBeUndefined();
    expect(trace.events).toHaveLength(3);
    expect(trace.environment).toMatchObject({ browser: "chromium", browserVersion: "123", screenReader: "voiceover" });
  });

  it("rejects unsupported versions, duplicate evidence IDs, malformed windows, and reordered events", async () => {
    const { dir, recorder } = await fixture();
    recorder.append("run.started", {});
    recorder.append("run.note", {});
    const trace = await recorder.finalize({ status: "success" });
    expect(() => validateTrace({ ...trace, schemaVersion: "99" })).toThrow(/schema/);
    expect(() => validateTrace({ ...trace, events: [...trace.events].reverse() })).toThrow(/ordering/);
    expect(() => validateTrace({ ...trace, events: [trace.events[0], { ...trace.events[1], id: trace.events[0]!.id }] })).toThrow(/Duplicate/);
    expect(() => validateTrace({ ...trace, events: [{ ...trace.events[0], collectionWindow: { startedAt: "bad", endedAt: "bad" } }, trace.events[1]] })).toThrow(/window/);
    await writeFile(join(dir, "trace.json"), JSON.stringify({ ...trace, schemaVersion: "99" }));
    await expect(readTrace(dir)).rejects.toThrow(/schema/);
  });

  it("never silently overwrites a prior run", async () => {
    const { dir, recorder } = await fixture();
    recorder.append("run.started", {});
    const original = await recorder.finalize({ status: "success" });
    const replacement = new TraceRecorder({ id: "replacement" }, dir);
    await expect(replacement.initialize()).rejects.toThrow();
    expect((await readTrace(dir)).runId).toBe(original.runId);
  });

  it("requires initialization and rejects non-JSON payloads or missing source data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rawstep-invalid-v2-"));
    const recorder = new TraceRecorder({ id: "invalid" }, dir);
    expect(() => recorder.append("run.note", {})).toThrow(/Initialize/);
    await recorder.initialize();
    expect(() => recorder.append("run.note", undefined)).toThrow(/JSON/);
    expect(() => recorder.append("run.note", { value: 2n })).toThrow();
    expect(recorder.snapshot().events).toHaveLength(0);
  });

  it("redacts literal metacharacters without applying them as regex syntax", () => {
    const redact = createRedactor(["a+b?", "[secret]", "path\\value"]);
    expect(redact({ text: "a+b? [secret] path\\value" })).toEqual({ value: { text: "[REDACTED] [REDACTED] [REDACTED]" }, redacted: true });
  });

  it("records explicit fragment redaction without losing event provenance", async () => {
    const { recorder } = await fixture();
    const event = recorder.append("screen-reader.output", { text: "[REDACTED]" }, { commandId: "typing-1", redacted: true });
    expect(event).toMatchObject({ id: "event-000001", seq: 1, redacted: true, commandId: "typing-1", association: "temporal-only" });
    expect((await recorder.finalize({ status: "success" })).privacy.redactionApplied).toBe(true);
  });

  it("preserves trusted timestamps and correlation IDs when input values overlap them", async () => {
    const { recorder } = await fixture({ year: "2026", digit: "1", short: "id" });
    const window = { startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z" };
    const output = recorder.append("screen-reader.output", { sequence: 1, receivedAt: window.startedAt, text: "year 2026 digit 1" }, { commandId: "cmd-1", collectionWindow: window });
    const observation = recorder.append("screen-reader.observation", {
      speech: ["year 2026 digit 1"], outputEventIds: [output.id], window: { id: "at-window-1", ...window }
    }, { collectionWindow: window });
    const backend = recorder.append("backend.command", { commandId: 1, sequence: 1, timestamp: 1, raw: { id: 1, params: { text: "2026" } } }, { commandId: "1" });
    const trace = await recorder.finalize({ status: "success" });
    expect(output.commandId).toBe("cmd-1");
    expect(output.collectionWindow).toEqual(window);
    expect(output.data).toEqual({ sequence: 1, receivedAt: window.startedAt, text: "year [REDACTED] digit [REDACTED]" });
    expect(observation.data).toMatchObject({ outputEventIds: [output.id], window: { id: "at-window-1", ...window } });
    expect(backend.data).toMatchObject({ commandId: 1, sequence: 1, timestamp: 1, raw: { id: 1, params: { text: "[REDACTED]" } } });
    expect(() => validateTrace(trace)).not.toThrow();
  });

  it("preserves typed outcomes, booleans, and policy enums that match input strings", async () => {
    const { recorder } = await fixture({ query: "success", flag: "true", digit: "1" });
    const decision = recorder.append("policy.decision", { step: 1, decision: { stop: "success", rationale: "Search success" } });
    const verification = recorder.append("verifier.result", { passed: true, step: 1, failures: [] });
    const action = recorder.append("action.result", { ok: true, step: 1 });
    const trace = await recorder.finalize({ status: "success", steps: 1, policyStop: "success" });
    expect(trace.outcome).toEqual({ status: "success", steps: 1, policyStop: "success" });
    expect(decision.data).toMatchObject({ step: 1, decision: { stop: "success", rationale: "Search [REDACTED]" } });
    expect(verification.data).toMatchObject({ passed: true, step: 1 });
    expect(action.data).toMatchObject({ ok: true, step: 1 });
  });

  it("redacts JSON-escaped input values inside raw transport text", async () => {
    const secret = 'quote" slash\\ newline\nprivate';
    const { dir, recorder } = await fixture({ secret });
    const raw = { method: "speech.capturedOutput", params: { data: `Value ${secret}` } };
    const event = recorder.append("backend.output", { text: secret, raw, rawText: JSON.stringify(raw) }, { source: "screen-reader" });
    await recorder.finalize({ status: "success" });
    expect((event.data as { rawText: string }).rawText).not.toContain(JSON.stringify(secret).slice(1, -1));
    expect((event.data as { rawText: string }).rawText).toContain("[REDACTED]");
    const saved = await readFile(join(dir, "trace.json"), "utf8");
    expect(saved).not.toContain("private");
  });
});

it("preserves opaque valid PNG evidence and truthful flags with one-character inputs", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6LsAAAAASUVORK5CYII=";
  const { recorder } = await fixture({ query: "A" });
  const screenshot = { pngBase64: png, viewport: { w: 1, h: 1 } };
  const event = recorder.append("keyboard.observation", { kind: "keyboard", screenshot, previousScreenshot: screenshot }, { source: "runner" });
  expect(event.data).toEqual({ kind: "keyboard", screenshot, previousScreenshot: screenshot });
  expect(event.redacted).toBe(false);
  const suppressed = recorder.append("keyboard.observation", { kind: "keyboard", screenshot: "[REDACTED]" }, { source: "runner", redacted: true });
  expect(suppressed.redacted).toBe(true);
});

it("retains trusted task mode and offered action identifiers when they match task input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rawstep-mode-trace-"));
  const recorder = new TraceRecorder({ id: "mode", mode: "keyboard", input: { query: "keyboard", action: "Tab" } }, dir);
  await recorder.initialize();
  const event = recorder.append("run.started", { allowedActions: { intents: [], keys: ["Tab"], inputKeys: ["query"], replaceText: true } });
  const trace = await recorder.finalize({ status: "failure" });
  expect(trace.task.mode).toBe("keyboard");
  expect(event.data).toMatchObject({ allowedActions: { keys: ["Tab"] } });
  expect(trace.task.input).toEqual({ query: "[REDACTED]", action: "[REDACTED]" });
});
