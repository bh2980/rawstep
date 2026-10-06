import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileTraceSink, MemoryTraceSink, hydrateScreenshots, isScreenshotRef, readTrace, screenshotSha256, TraceRecorder, validateTrace, type RunTrace, type TraceEvent } from "@rawstep/core/trace";
import { summarizeTraceEvidence } from "@rawstep/reports/analyze";
import { renderReportHtml, writeReport } from "@rawstep/reports/report";

const pngBytes = (label: string) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from(label)]);
const shot = (label: string) => ({ pngBase64: pngBytes(label).toString("base64"), viewport: { w: 4, h: 3 } });
const sha = (label: string) => createHash("sha256").update(pngBytes(label)).digest("hex");
async function fixture(input?: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "rawstep-blobs-"));
  const recorder = new TraceRecorder({ id: "blobs", mode: "keyboard", input }, dir);
  await recorder.initialize();
  return { dir, recorder };
}
const timestamp = "2026-01-01T00:00:00.000Z";
function traceOf(events: Array<Pick<TraceEvent, "type" | "data"> & Partial<TraceEvent>>): RunTrace {
  return {
    schemaVersion: "2.2", runId: "inline", task: { id: "inline", mode: "keyboard" },
    environment: { platform: "t", platformVersion: "u", browser: "t", browserVersion: "u", screenReader: "t", screenReaderVersion: "u" },
    startedAt: timestamp, endedAt: timestamp, outcome: { status: "success", reason: "verified", steps: 1 },
    privacy: { inputValues: "redacted", redactionApplied: false },
    events: events.map((event, index) => ({ id: `event-${index + 1}`, seq: index + 1, timestamp, source: "runner", redacted: false, ...event })),
  };
}

describe("schema 2.2 screenshot blobs", () => {
  it("stores keyboard.observation screenshots as references and keeps base64 out of trace.json and trace.jsonl", async () => {
    const { dir, recorder } = await fixture();
    const image = shot("one");
    const event = recorder.append("keyboard.observation", { kind: "keyboard", screenshot: image, previousScreenshot: shot("zero") }, { source: "runner" });
    const trace = await recorder.finalize({ status: "success", reason: "verified" });
    const ref = { sha256: sha("one"), blob: `blobs/${sha("one")}.png`, bytes: pngBytes("one").length, viewport: { w: 4, h: 3 } };
    expect(event.data).toMatchObject({ screenshot: ref });
    expect(isScreenshotRef((event.data as { screenshot: unknown }).screenshot)).toBe(true);
    expect(trace.schemaVersion).toBe("2.2");
    expect(trace.events[0]!.data).toMatchObject({ screenshot: ref });
    expect(Buffer.from(await readFile(join(dir, ref.blob))).equals(pngBytes("one"))).toBe(true);
    for (const file of ["trace.json", "trace.jsonl"]) {
      const text = await readFile(join(dir, file), "utf8");
      expect(text).not.toContain("pngBase64");
      expect(text).not.toContain(image.pngBase64);
      expect(text).toContain(ref.sha256);
    }
    expect((await readTrace(dir)).events[0]!.data).toMatchObject({ screenshot: ref });
  });

  it("stores identical screenshots once", async () => {
    const { dir, recorder } = await fixture();
    for (let i = 0; i < 3; i++) recorder.append("keyboard.observation", { screenshot: shot("same"), previousScreenshot: shot("same") }, { source: "runner" });
    recorder.append("keyboard.observation", { screenshot: shot("other") }, { source: "runner" });
    await recorder.finalize({ status: "success" });
    expect((await readdir(join(dir, "blobs"))).sort()).toEqual([`${sha("other")}.png`, `${sha("same")}.png`].sort());
  });

  it("does not corrupt a reference when a sensitive input is a substring of its sha256", async () => {
    const hash = sha("secret-adjacent");
    const { dir, recorder } = await fixture({ query: hash.slice(10, 16) });
    const event = recorder.append("keyboard.observation", { screenshot: shot("secret-adjacent"), note: `typed ${hash.slice(10, 16)}` }, { source: "runner" });
    const data = event.data as { screenshot: { sha256: string; blob: string }; note: string };
    expect(data.screenshot.sha256).toBe(hash);
    expect(data.screenshot.blob).toBe(`blobs/${hash}.png`);
    expect(isScreenshotRef(data.screenshot)).toBe(true);
    expect(data.note).toBe("typed [REDACTED]");
    expect(event.redacted).toBe(true);
    const trace = await recorder.finalize({ status: "success" });
    const hydrated = await hydrateScreenshots(trace, dir);
    expect((hydrated.events[0]!.data as { screenshot: { pngBase64?: string } }).screenshot.pngBase64).toBe(pngBytes("secret-adjacent").toString("base64"));
  });

  it("holds events and blobs in a MemoryTraceSink", async () => {
    const sink = new MemoryTraceSink();
    const recorder = new TraceRecorder({ id: "memory", mode: "keyboard" }, sink);
    await recorder.initialize();
    recorder.append("keyboard.observation", { screenshot: shot("mem") }, { source: "runner" });
    const trace = await recorder.finalize({ status: "success" });
    expect(recorder.outDir).toBeUndefined();
    expect(sink.events).toHaveLength(1);
    expect(JSON.stringify(sink.events)).not.toContain("pngBase64");
    expect([...sink.blobs.keys()]).toEqual([`blobs/${sha("mem")}.png`]);
    expect(Buffer.from(sink.blobs.get(`blobs/${sha("mem")}.png`)!).equals(pngBytes("mem"))).toBe(true);
    expect((sink.trace as RunTrace).outcome?.status).toBe("success");
    const hydrated = await hydrateScreenshots(trace, sink);
    expect(screenshotSha256((hydrated.events[0]!.data as { screenshot: unknown }).screenshot)).toBe(sha("mem"));
  });

  it("passes redacted events to onEvent and ignores a throwing listener", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rawstep-onevent-"));
    const seen: TraceEvent[] = [];
    let calls = 0;
    const recorder = new TraceRecorder({ id: "events", input: { password: "hunter2" } }, dir, { onEvent: (event) => {
      calls++; seen.push(event); (event.data as { text?: string }).text = "tampered";
      if (calls === 1) throw new Error("listener failure");
    } });
    await recorder.initialize();
    const first = recorder.append("screen-reader.output", { text: "hunter2 entered" });
    const second = recorder.append("screen-reader.output", { text: "plain" });
    const trace = await recorder.finalize({ status: "success" });
    expect(calls).toBe(2);
    expect(JSON.stringify(seen)).not.toContain("hunter2");
    expect(seen[0]).toMatchObject({ id: first.id, redacted: true, data: { text: "tampered" } });
    expect(first.data).toEqual({ text: "[REDACTED] entered" });
    expect(second.data).toEqual({ text: "plain" });
    expect(trace.events.map((event) => event.data)).toEqual([{ text: "[REDACTED] entered" }, { text: "plain" }]);
    expect((await readFile(join(dir, "trace.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("hydrates matching blobs and leaves missing or mismatched references untouched", async () => {
    const sink = new MemoryTraceSink();
    const recorder = new TraceRecorder({ id: "hydrate", mode: "keyboard" }, sink);
    await recorder.initialize();
    for (const label of ["good", "gone", "bad"]) recorder.append("keyboard.observation", { screenshot: shot(label) }, { source: "runner" });
    const trace = await recorder.finalize({ status: "success" });
    sink.blobs.delete(`blobs/${sha("gone")}.png`);
    sink.blobs.set(`blobs/${sha("bad")}.png`, new Uint8Array([1, 2, 3]));
    const hydrated = await hydrateScreenshots(trace, sink);
    const screens = hydrated.events.map((event) => (event.data as { screenshot: Record<string, unknown> }).screenshot);
    expect(screens[0]!.pngBase64).toBe(pngBytes("good").toString("base64"));
    expect(screens[0]!.viewport).toEqual({ w: 4, h: 3 });
    expect(screens[1]).toEqual((trace.events[1]!.data as { screenshot: unknown }).screenshot);
    expect(screens[2]).toEqual((trace.events[2]!.data as { screenshot: unknown }).screenshot);
    expect(JSON.stringify(trace)).not.toContain("pngBase64");
  });

  it("accepts only the current schema and does not treat inline PNGs in a saved trace as screenshots", () => {
    const inline = shot("inline");
    const trace = traceOf([
      { type: "policy.decision", source: "policy", data: { step: 1, decision: { action: { kind: "key", key: "Tab" } } } },
      { type: "keyboard.observation", data: { screenshot: inline } },
    ]);
    expect(() => validateTrace(trace)).not.toThrow();
    for (const schemaVersion of ["2.0", "2.1", "3.0"]) expect(() => validateTrace({ ...trace, schemaVersion })).toThrow("Unsupported trace schema version");
    expect(screenshotSha256(inline)).toBeUndefined();
    expect(summarizeTraceEvidence(trace).readableScreenshotEvents).toHaveLength(0);
    expect(renderReportHtml(trace)).not.toContain(inline.pngBase64);
  });

  it("renders blob references relative to the trace, and embeds pixels after hydration", async () => {
    const { dir, recorder } = await fixture();
    recorder.append("keyboard.observation", { screenshot: shot("report") }, { source: "runner" });
    const trace = await recorder.finalize({ status: "success", reason: "verified" });
    expect(summarizeTraceEvidence(trace).readableScreenshotEvents).toHaveLength(1);
    const html = renderReportHtml(trace);
    expect(html).toContain(`<img alt="Keyboard viewport screenshot" style="max-width:100%;height:auto" src="blobs/${sha("report")}.png">`);
    expect(html).not.toContain("data:image/png;base64,");
    const out = await mkdtemp(join(tmpdir(), "rawstep-report-elsewhere-"));
    const { htmlPath } = await writeReport(await hydrateScreenshots(trace, dir), undefined, out);
    const embedded = await readFile(htmlPath, "utf8");
    expect(embedded).toContain(`src="data:image/png;base64,${pngBytes("report").toString("base64")}"`);
    expect(embedded).not.toContain('src="blobs/');
  });

  it("rejects blob names that could leave the trace directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "rawstep-sink-"));
    const dir = join(parent, "run");
    const sink = new FileTraceSink(dir);
    await sink.initialize({ schemaVersion: "2.2" });
    await writeFile(join(parent, "outside.png"), "outside");
    for (const name of ["blobs/../../outside.png", "../outside.png", "/etc/passwd.png", "blobs/a.txt", "blobs/..\\x.png"]) {
      expect(() => sink.putBlob(name, new Uint8Array([1]))).toThrow("Invalid trace blob name");
      expect(await sink.readBlob(name)).toBeUndefined();
    }
    expect(() => new MemoryTraceSink().putBlob("../x.png", new Uint8Array([1]))).toThrow("Invalid trace blob name");
    sink.putBlob(`blobs/${sha("ok")}.png`, new Uint8Array([1]));
    expect([...(await sink.readBlob(`blobs/${sha("ok")}.png`))!]).toEqual([1]);
  });
});
