import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli, parseCliArguments, type CliDependencies } from "@rawstep/cli/cli";
import type { Backend } from "@rawstep/core/contracts";
import type { RunTrace } from "@rawstep/core/trace";

const directories: string[] = [];
describe('local dashboard command', () => {
  it('shares normal option validation and closes the server on a signal', async () => {
    expect(parseCliArguments(['ui','--port=5432','--project','project']).options.port).toBe('5432');
    for (const args of [['ui','--port','0'],['ui','--port','65536'],['ui','--port','1','--port','2'],['ui','task.json']]) expect(() => parseCliArguments(args)).toThrow();
    const signals=new EventEmitter(), close=vi.fn(async()=>{}), stdout=vi.fn();
    const startDashboard=vi.fn(async()=>({url:'http://127.0.0.1:5432',close}));
    const pending=runCli(['ui','--port=5432','--project','project'],{cwd:'/tmp',signals,startDashboard,stdout,stderr:()=>{}});
    await vi.waitFor(()=>expect(signals.listenerCount('SIGINT')).toBe(1)); signals.emit('SIGINT');
    expect(await pending).toBe(0); expect(startDashboard).toHaveBeenCalledWith({projectDir:'/tmp/project',port:5432}); expect(close).toHaveBeenCalledOnce(); expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
});
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rawstep-cli-v2-"));
  directories.push(directory);
  return directory;
}
function output(cwd: string) {
  const stdout = vi.fn();
  const stderr = vi.fn();
  return { cwd, stdout, stderr };
}
function fixtureTrace(status: "success" | "failure" = "success"): RunTrace {
  return {
    schemaVersion: "2.0", runId: "cli-test", task: { id: "task" },
    environment: { platform: "test", platformVersion: "unknown", browser: "test", browserVersion: "unknown", screenReader: "test", screenReaderVersion: "unknown" },
    startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z",
    events: [], outcome: { status }, privacy: { inputValues: "redacted", redactionApplied: false },
  };
}
function backend(): Backend {
  return {
    capabilities: { intents: [], keys: [], textEntry: false, replaceText: false },
    start: vi.fn(async () => ({ protocol: "at-driver", screenReader: "test" })),
    close: vi.fn(async () => {}), execute: vi.fn(async () => ({})),
    observe: vi.fn(async () => ({ windowId: "test", startedAt: "test", endedAt: "test", reason: "test", outputs: [], speech: [] })),
    subscribe: vi.fn(() => () => {}),
  };
}
async function writeTask(directory: string, extra: Record<string, unknown> = {}): Promise<void> {
  await writeFile(join(directory, "task.json"), JSON.stringify({ url: "fixture.html", goal: "Reach the button", verify: { all: [{ titleIncludes: "Done" }] }, ...extra }));
}
const runArgs = ["run", "task.json", "--script", "decisions.json", "--backend", "voiceover", "--endpoint", "ws://localhost:3030/session", "--out", "result"];

describe("model-neutral CLI argument contract", () => {
  it("accepts explicit backend, policy, and endpoint without model options", () => {
    const parsed = parseCliArguments(["run", "task.json", "--policy=./policy.mjs", "--backend", "nvda", "--endpoint", "ws://localhost:3031"]);
    expect(parsed.options.policy).toBe("./policy.mjs");
    expect(parsed.options.backend).toBe("nvda");
  });
  it("keeps simulated VoiceOver explicit and independent of a native endpoint", () => {
    expect(parseCliArguments(["mock-run", "task.json", "--script", "decisions.json", "--headed"]).options).toEqual({ script: "decisions.json", headed: true });
    expect(() => parseCliArguments(["mock-run", "task.json", "--script", "decisions.json", "--backend", "voiceover"])).toThrow(/Unknown option/);
    expect(() => parseCliArguments(["mock-run", "task.json", "--script", "decisions.json", "--endpoint", "ws://localhost"])).toThrow(/Unknown option/);
    expect(() => parseCliArguments(["run", "task.json", "--script", "decisions.json", "--backend", "mock", "--endpoint", "ws://localhost"])).toThrow(/mock-run/);
    expect(() => parseCliArguments(["mock-run", "task.json"])).toThrow(/exactly one of/);
  });
  it.each([
    ["run", "task.json", "--backend", "voiceover", "--endpoint", "ws://localhost:3030/session"],
    [...runArgs, "--policy", "policy.mjs"],
    [...runArgs, "--model", "arbitrary-model"],
    [...runArgs, "--headless"],
    [...runArgs, "--out", "again"],
    ["doctor", "--backend", "keyboard"],
    ["doctor", "--backend", "nvda", "--endpoint", "https://localhost"],
    ["analyze", "trace.json", "unexpected.json"],
    ["report", "trace.json", "--out"],
  ])("rejects invalid or ambiguous arguments: %j", (...args) => {
    expect(() => parseCliArguments(args)).toThrow();
  });
  it("has provider-free help and rejects the retired legacy command", async () => {
    const io = output(await temporaryDirectory());
    expect(await runCli(["--help"], io)).toBe(0);
    expect(io.stdout.mock.calls.flat().join("")).toContain("No model or API key is required");
    expect(await runCli(["legacy-run"], io)).toBe(2);
    expect(io.stderr.mock.calls.flat().join("")).toContain('Unknown command: legacy-run');
  });
});

describe("run CLI", () => {
  it.each([false, true])("runs explicit simulated VoiceOver without creating a native backend (headed: %s)", async (headed) => {
    const directory = await temporaryDirectory();
    await writeTask(directory);
    await writeFile(join(directory, "decisions.json"), JSON.stringify([{ stop: "success" }]));
    const io = output(directory);
    const execute = vi.fn<NonNullable<CliDependencies["runMockVoiceOverTask"]>>(async (_task, options) => {
      options.warn?.("Simulated VoiceOver approximation; not Apple VoiceOver.");
      return fixtureTrace();
    });
    const createBackend = vi.fn(() => backend());
    const nativeRun = vi.fn();
    const args = ["mock-run", "task.json", "--script", "decisions.json", "--out", "result", "--browser-executable", "browser/chromium", "--diagnostic-screenshots", ...(headed ? ["--headed"] : [])];
    expect(await runCli(args, { ...io, createBackend, runTask: nativeRun, runMockVoiceOverTask: execute })).toBe(0);
    expect(createBackend).not.toHaveBeenCalled();
    expect(nativeRun).not.toHaveBeenCalled();
    expect(execute.mock.calls[0]![1]).toMatchObject({ headless: !headed, outDir: join(directory, "result"), browserExecutablePath: join(directory, "browser/chromium"), diagnosticScreenshots: true });
    expect(execute.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    expect(io.stderr.mock.calls.flat().join("")).toContain("[simulation] Simulated VoiceOver approximation; not Apple VoiceOver");
  });
  it("reports simulated failures without suggesting native AT Driver setup", async () => {
    const directory = await temporaryDirectory();
    await writeTask(directory);
    await writeFile(join(directory, "decisions.json"), JSON.stringify([{ stop: "success" }]));
    const io = output(directory);
    expect(await runCli(["mock-run", "task.json", "--script", "decisions.json"], { ...io, runMockVoiceOverTask: async () => fixtureTrace("failure") })).toBe(1);
    const text = io.stderr.mock.calls.flat().join("");
    expect(text).toContain("npx rawstep report");
    expect(text).not.toContain("rawstep doctor");
  });
  it.each([["SIGINT", 130], ["SIGTERM", 143]] as const)("saves a %s cancellation and removes temporary signal handlers", async (signal, expectedCode) => {
    const directory = await temporaryDirectory();
    await writeTask(directory);
    await writeFile(join(directory, "decisions.json"), JSON.stringify([{ stop: "success" }]));
    const signals = new EventEmitter();
    const existing = vi.fn();
    signals.on("SIGINT", existing);
    const execute = vi.fn<NonNullable<CliDependencies["runTask"]>>(async (_task, options) => {
      expect(options.signal?.aborted).toBe(false);
      signals.emit(signal);
      expect(options.signal?.aborted).toBe(true);
      expect(options.signal?.reason).toBe(signal);
      signals.emit(signal === "SIGINT" ? "SIGTERM" : "SIGINT");
      expect(options.signal?.reason).toBe(signal);
      return { ...fixtureTrace(), outcome: { status: "aborted", reason: "aborted", stage: "policy", step: 2,
        cancellation: { signal, stage: "policy", step: 2 } } };
    });
    const io = output(directory);
    expect(await runCli(runArgs, { ...io, signals, createBackend: () => backend(), runTask: execute })).toBe(expectedCode);
    expect(signals.listeners("SIGINT")).toEqual([existing]);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    const text = io.stderr.mock.calls.flat().join("");
    expect(text).toContain("Reason: aborted");
    expect(text).toContain("Stage: policy (step 2)");
    expect(text).toContain(`Cancellation: ${signal}`);
    expect(text).toContain("npx rawstep report");
    expect(text).toContain("npx rawstep doctor --backend voiceover");
  });
  it("removes run signal handlers even when execution throws", async () => {
    const directory = await temporaryDirectory();
    await writeTask(directory);
    await writeFile(join(directory, "decisions.json"), JSON.stringify([{ stop: "success" }]));
    const signals = new EventEmitter();
    const io = output(directory);
    expect(await runCli(runArgs, { ...io, signals, createBackend: () => backend(), runTask: async () => { throw new Error("trace cannot be initialized"); } })).toBe(1);
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(io.stderr.mock.calls.flat().join("")).toContain("Stage: execution");
    expect(io.stderr.mock.calls.flat().join("")).toContain("fresh --out directory");
    expect(io.stdout.mock.calls.flat().join("")).not.toContain("Trace:");
  });
  it("identifies missing task files before claiming a saved trace exists", async () => {
    const directory = await temporaryDirectory();
    const io = output(directory);
    const createBackend = vi.fn(() => backend());
    expect(await runCli(runArgs, { ...io, createBackend })).toBe(2);
    const text = io.stderr.mock.calls.flat().join("");
    expect(text).toContain("Stage: task-loading");
    expect(text).toContain("Check that the task file exists");
    expect(text).toContain("npx rawstep --help");
    expect(io.stdout.mock.calls.flat().join("")).not.toContain("Trace:");
    expect(createBackend).not.toHaveBeenCalled();
  });
  it("identifies missing policy modules with relevant recovery guidance", async () => {
    const directory = await temporaryDirectory();
    await writeTask(directory);
    const io = output(directory);
    const createBackend = vi.fn(() => backend());
    expect(await runCli(["run", "task.json", "--policy", "missing.mjs", "--backend", "voiceover", "--endpoint", "ws://localhost:3030"], { ...io, createBackend })).toBe(1);
    const text = io.stderr.mock.calls.flat().join("");
    expect(text).toContain("Stage: policy-loading");
    expect(text).toContain("Check the --policy module path and its decide() export");
    expect(io.stdout.mock.calls.flat().join("")).not.toContain("Trace:");
    expect(createBackend).not.toHaveBeenCalled();
  });
  it("prints the recorded failure cause and stage without claiming a report already exists", async () => {
    const directory = await temporaryDirectory();
    await writeTask(directory);
    await writeFile(join(directory, "decisions.json"), JSON.stringify([{ stop: "success" }]));
    const io = output(directory);
    const trace = { ...fixtureTrace("failure"), outcome: { status: "failure" as const, reason: "error", stage: "backend.start", step: 0, error: "Connection refused: ECONNREFUSED" } };
    expect(await runCli(runArgs, { ...io, createBackend: () => backend(), runTask: async () => trace })).toBe(1);
    const text = io.stderr.mock.calls.flat().join("");
    expect(text).toContain("Reason: error");
    expect(text).toContain("Stage: backend.start (step 0)");
    expect(text).toContain("Detail: Connection refused: ECONNREFUSED");
    expect(text).toContain("fresh --out directory");
    expect(io.stdout.mock.calls.flat().join("")).not.toContain("Report:");
  });
  it("runs screenshot keyboard scripts without a native backend or provider", async () => {
    const directory = await temporaryDirectory();
    await writeTask(directory, { mode: "keyboard" });
    await writeFile(join(directory, "decisions.json"), JSON.stringify([{ stop: "success" }]));
    const io = output(directory);
    const execute = vi.fn<NonNullable<CliDependencies["runScreenshotTask"]>>(async () => fixtureTrace());
    const createBackend = vi.fn(() => backend());
    expect(await runCli(["screenshot-run", "task.json", "--script", "decisions.json", "--out", "result"], { ...io, createBackend, runScreenshotTask: execute })).toBe(0);
    expect(createBackend).not.toHaveBeenCalled();
    expect(execute.mock.calls[0]![1].headless).toBe(true);
    expect(io.stderr.mock.calls.flat().join("")).not.toContain("deprecated");
  });
  it("runs a scripted policy with no old config or provider credentials", async () => {
    const directory = await temporaryDirectory();
    await writeTask(directory);
    await writeFile(join(directory, "decisions.json"), JSON.stringify([{ stop: "success" }]));
    const device = backend();
    const execute = vi.fn<NonNullable<CliDependencies["runTask"]>>(async () => fixtureTrace());
    const io = output(directory);
    const exitCode = await runCli(runArgs, { ...io, createBackend: () => device, runTask: execute });
    expect(exitCode).toBe(0);
    const [task, options] = execute.mock.calls[0]!;
    expect(task.url).toBe(pathToFileURL(join(directory, "fixture.html")).href);
    expect(options.backend).toBe(device);
    expect(options.outDir).toBe(join(directory, "result"));
    expect(options.headless).toBe(false);
    expect(await options.policy.decide({} as never)).toEqual({ stop: "success" });
    expect(io.stdout.mock.calls.flat().join("")).toContain("Run cli-test: success");
  });
  it("loads a trusted local policy module without a model-specific adapter", async () => {
    const directory = await temporaryDirectory();
    await writeTask(directory);
    await writeFile(join(directory, "policy.mjs"), 'export const policy = { decide: () => ({ stop: "stuck", rationale: "fixture" }) };');
    const execute = vi.fn(async () => fixtureTrace("failure"));
    const io = output(directory);
    expect(await runCli(["run", "task.json", "--policy", "policy.mjs", "--backend", "nvda", "--endpoint", "ws://localhost:3031"], { ...io, createBackend: () => backend(), runTask: execute })).toBe(1);
    expect(execute).toHaveBeenCalledOnce();
  });
  it("rejects old keyboard mode and malformed scripts before creating a backend", async () => {
    const directory = await temporaryDirectory();
    const io = output(directory);
    const createBackend = vi.fn(() => backend());
    await writeTask(directory, { mode: "keyboard" });
    expect(await runCli(runArgs, { ...io, createBackend })).toBe(2);
    expect(io.stderr.mock.calls.flat().join("")).toContain('screenshot-run');
    await writeTask(directory);
    await writeFile(join(directory, "decisions.json"), JSON.stringify([{ action: { kind: "anything" } }]));
    expect(await runCli(runArgs, { ...io, createBackend })).toBe(2);
    expect(createBackend).not.toHaveBeenCalled();
  });
});

describe("offline analysis and reports", () => {
  it("analyzes and renders a saved trace without starting a backend", async () => {
    const directory = await temporaryDirectory();
    const source = JSON.stringify(fixtureTrace());
    await writeFile(join(directory, "trace.json"), source);
    const io = output(directory);
    const createBackend = vi.fn(() => backend());
    expect(await runCli(["analyze", "trace.json"], { ...io, createBackend })).toBe(0);
    expect(await runCli(["report", "trace.json", "--analysis", "analysis.json"], { ...io, createBackend })).toBe(0);
    expect(await readFile(join(directory, "trace.json"), "utf8")).toBe(source);
    expect(await readFile(join(directory, "report.html"), "utf8")).toContain("cli-test");
    expect(createBackend).not.toHaveBeenCalled();
  });
  it("returns a failure for analyzer errors while preserving the original trace", async () => {
    const directory = await temporaryDirectory();
    const source = JSON.stringify(fixtureTrace());
    await writeFile(join(directory, "trace.json"), source);
    await writeFile(join(directory, "analyzer.mjs"), 'export default { id: "broken", analyze() { throw new Error("offline analyzer failed"); } };');
    const io = output(directory);
    expect(await runCli(["analyze", "trace.json", "--analyzer", "analyzer.mjs"], io)).toBe(1);
    expect(JSON.parse(await readFile(join(directory, "analysis.json"), "utf8")).status).toBe("failed");
    expect(await readFile(join(directory, "trace.json"), "utf8")).toBe(source);
  });
  it("refuses analysis from a different run", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "trace.json"), JSON.stringify(fixtureTrace()));
    await writeFile(join(directory, "analysis.json"), JSON.stringify({ schemaVersion: "1.0", traceSchemaVersion: "2.0", runId: "another-run", status: "completed", findings: [] }));
    const io = output(directory);
    expect(await runCli(["report", "trace.json", "--analysis", "analysis.json"], io)).toBe(1);
    expect(io.stderr.mock.calls.flat().join("")).toMatch(/run|trace/i);
  });
});

describe("doctor", () => {
  it("reports unverified native prerequisites without connecting by default", async () => {
    const io = output(await temporaryDirectory());
    const createBackend = vi.fn(() => backend());
    expect(await runCli(["doctor", "--backend", "nvda"], { ...io, createBackend })).toBe(0);
    expect(io.stdout.mock.calls.flat().join("")).toContain("Native readiness is unverified");
    expect(createBackend).not.toHaveBeenCalled();
  });
  it("probes an explicit endpoint and closes the session", async () => {
    const io = output(await temporaryDirectory());
    const device = backend();
    expect(await runCli(["doctor", "--backend", "voiceover", "--endpoint", "ws://localhost:3030/session"], { ...io, createBackend: () => device })).toBe(0);
    expect(device.start).toHaveBeenCalledOnce();
    expect(device.close).toHaveBeenCalledOnce();
    expect(io.stdout.mock.calls.flat().join("")).toContain("protocol connection only");
  });
  it("closes a failed protocol probe and reports failure", async () => {
    const io = output(await temporaryDirectory());
    const device = backend();
    device.start = vi.fn(async () => { throw new Error("connection refused"); });
    expect(await runCli(["doctor", "--backend", "nvda", "--endpoint", "ws://localhost:3031"], { ...io, createBackend: () => device })).toBe(1);
    expect(device.close).toHaveBeenCalledOnce();
    expect(io.stderr.mock.calls.flat().join("")).toContain("connection refused");
  });
  it("preserves the connection cause when cleanup also fails", async () => {
    const io = output(await temporaryDirectory());
    const device = backend();
    device.start = vi.fn(async () => { throw new Error("WebSocket connection failed", { cause: Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" }) }); });
    device.close = vi.fn(async () => { throw new Error("cleanup failed"); });
    expect(await runCli(["doctor", "--backend", "nvda", "--endpoint", "ws://localhost:3031"], { ...io, createBackend: () => device })).toBe(1);
    const text = io.stderr.mock.calls.flat().join("");
    expect(text).toContain("Connection: failed");
    expect(text).toContain("ECONNREFUSED");
    expect(text).toContain("Recovery: start the native AT Driver server");
    expect(text).toContain("Cleanup warning: cleanup failed");
  });
});

it("preserves the rawstep compatibility release over real workspace packages", async () => {
  const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, "../packages/rawstep/package.json"), "utf8"));
  expect(manifest.name).toBe("rawstep");
  expect(manifest.private).not.toBe(true);
  expect(manifest.bin.rawstep).toBe("./dist/cli/bin.js");
  expect(manifest.files).toEqual(["dist", "README.md", "README.ko.md", "LICENSE", "docs/*.md", "examples/v2", "fixtures/simple-cta.html", "fixtures/native-voiceover.html", "fixtures/mock-voiceover-system.html", "examples/screenshot/*.json", "examples/screenshot/*.mjs", "examples/screenshot/*.md", "examples/screenshot/*.py", "examples/screenshot/*.txt", "fixtures/screenshot-keyboard.html", "fixtures/screenshot-workflow.html", "examples/profiles/*.json", "examples/profiles/*.md", "examples/orca/*.mjs", "examples/orca/*.html", "examples/orca/*.md", "fixtures/environment-lab.html", "fixtures/visual-study/*.html"]);
  expect(manifest.exports["./mock-voiceover"]).toEqual({ types: "./dist/mock-voiceover/index.d.ts", import: "./dist/mock-voiceover/index.js", default: "./dist/mock-voiceover/index.js" });
  expect(Object.keys(manifest.dependencies)).toEqual(["@rawstep/core", "@rawstep/policies", "@rawstep/browser", "@rawstep/screenreaders", "@rawstep/reports", "@rawstep/cli"]);
  expect(JSON.stringify(manifest.dependencies)).not.toMatch(/guidepup|anthropic|openai|ollama|virtual-screen-reader/);
  expect(manifest.exports["./policy"].types).toBe("./dist/policy/index.d.ts");
});
