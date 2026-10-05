import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli, parseCliArguments, formatRunResult, type CliDependencies } from "@rawstep/cli/cli";
import { ProjectError } from "@rawstep/project/errors";
import { ProjectStore, initProject } from "@rawstep/project/store";
import { defaultConfig } from "@rawstep/project/config";
import type { RunTaskResult } from "@rawstep/project/run";
import type { RunTrace } from "@rawstep/core/trace";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rawstep-cli-"));
  directories.push(directory);
  return directory;
}
function output(cwd: string) {
  const stdout = vi.fn();
  const stderr = vi.fn();
  return { cwd, stdout, stderr };
}
const text = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.flat().join("");
function fixtureTrace(status: "success" | "failure" = "success"): RunTrace {
  return {
    schemaVersion: "2.2", runId: "cli-test", task: { id: "task" },
    environment: { platform: "test", platformVersion: "unknown", browser: "test", browserVersion: "unknown", screenReader: "test", screenReaderVersion: "unknown" },
    startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z",
    events: [], outcome: { status }, privacy: { inputValues: "redacted", redactionApplied: false },
  };
}

describe("CLI argument contract", () => {
  it("parses the seven commands and their options", () => {
    expect(parseCliArguments(["init"]).command).toBe("init");
    expect(parseCliArguments(["ui", "--port=5432", "--project", "project"]).options).toEqual({ port: "5432", project: "project" });
    expect(parseCliArguments(["run", "login", "--model", "fast", "--profile", "zoom", "--mode", "screenreader", "--repeat", "3", "--out", "out", "--json"])).toMatchObject({
      command: "run", positionals: ["login"], options: { model: "fast", profile: "zoom", mode: "screenreader", repeat: "3", out: "out", json: true },
    });
    expect(parseCliArguments(["analyze", "run-1", "--model", "judge"]).options).toEqual({ model: "judge" });
    expect(parseCliArguments(["hints", "run", "--reference", "other"])).toMatchObject({ command: "hints", positionals: ["run"], options: { reference: "other" } });
    expect(parseCliArguments(["report", "run", "--analysis", "analysis.json", "--out", "x"]).command).toBe("report");
    expect(parseCliArguments(["doctor"]).command).toBe("doctor");
  });
  it.each([
    ["ui", "--port", "0"], ["ui", "--port", "65536"], ["ui", "--port", "1", "--port", "2"], ["ui", "task.json"],
    ["init", "extra"], ["doctor", "--backend", "nvda"],
    ["run"], ["run", "a", "b"], ["run", "a", "--mode", "mock"], ["run", "a", "--repeat", "0"], ["run", "a", "--repeat", "101"], ["run", "a", "--repeat", "two"],
    ["run", "a", "--json=yes"], ["run", "a", "--model"], ["run", "a", "--out", "x", "--out", "y"],
    // Options of the removed commands and of the environment-variable configuration are gone.
    ["run", "a", "--policy", "policy.mjs"], ["run", "a", "--script", "decisions.json"], ["run", "a", "--decision", "systemone"], ["run", "a", "--backend", "voiceover"],
    ["analyze", "run", "--llm"], ["analyze", "run", "--analyzer", "a.mjs"], ["analyze"],
    ["hints"], ["hints", "a", "b"], ["hints", "a", "--out", "x"], ["hints", "a", "--reference"], ["report", "trace.json", "--out"],
    ["mock-run", "task.json"], ["screenshot-run", "task.json"], ["matrix", "task.json"], ["profiles"],
  ])("rejects invalid or retired usage: %j", (...args) => {
    expect(() => parseCliArguments(args)).toThrow();
  });
  it("prints help for the new commands and rejects unknown ones", async () => {
    const io = output(await temporaryDirectory());
    expect(await runCli(["--help"], io)).toBe(0);
    const help = text(io.stdout);
    for (const command of ["rawstep init", "rawstep ui", "rawstep run <task>", "rawstep hints", "rawstep report", "rawstep analyze", "rawstep doctor", "rawstep.config.json"]) expect(help).toContain(command);
    for (const gone of ["mock-run", "screenshot-run", "matrix", "RAWSTEP_DECISION", "RAWSTEP_ANALYSIS", "--decision"]) expect(help).not.toContain(gone);
    expect(await runCli(["legacy-run"], io)).toBe(2);
    expect(text(io.stderr)).toContain("Unknown command: legacy-run");
  });
});

describe("local dashboard command", () => {
  it("closes the server on a signal and starts it in the project directory", async () => {
    const signals = new EventEmitter(), close = vi.fn(async () => {}), stdout = vi.fn();
    const startDashboard = vi.fn(async () => ({ url: "http://127.0.0.1:5432", close }));
    const pending = runCli(["ui", "--port=5432", "--project", "project"], { cwd: "/tmp", signals, startDashboard, stdout, stderr: () => {} });
    await vi.waitFor(() => expect(signals.listenerCount("SIGINT")).toBe(1)); signals.emit("SIGINT");
    expect(await pending).toBe(0); expect(startDashboard).toHaveBeenCalledWith({ projectDir: "/tmp/project", port: 5432 }); expect(close).toHaveBeenCalledOnce(); expect(signals.listenerCount("SIGTERM")).toBe(0);
  });
});

describe("init", () => {
  it("writes a default rawstep.config.json and refuses to overwrite it", async () => {
    const directory = await temporaryDirectory(), io = output(directory);
    expect(await runCli(["init"], io)).toBe(0);
    expect(text(io.stdout)).toContain(join(directory, "rawstep.config.json"));
    expect(JSON.parse(await readFile(join(directory, "rawstep.config.json"), "utf8"))).toEqual(defaultConfig());
    await writeFile(join(directory, "rawstep.config.json"), "{\"mine\":true}");
    expect(await runCli(["init"], io)).toBe(1);
    expect(text(io.stderr)).toContain("already exists");
    expect(await readFile(join(directory, "rawstep.config.json"), "utf8")).toBe("{\"mine\":true}");
    await expect(initProject(directory)).rejects.toBeInstanceOf(ProjectError);
  });
  it("initializes the directory given by --project", async () => {
    const directory = await temporaryDirectory(), io = output(directory);
    expect(await runCli(["init", "--project", "sub/app"], io)).toBe(0);
    expect((await new ProjectStore(join(directory, "sub/app")).read()).config.profiles).toHaveLength(1);
  });
});

const result: RunTaskResult = {
  runs: [
    { runId: "r1", outDir: "/p/.rawstep/runs/x/run-1", outcome: { status: "success" }, hints: { schemaVersion: "2.0", runId: "r1", taskId: "t", steps: 7, durationMs: 10, goalReached: true, hints: [{ kind: "slow-run", source: "run", certainty: "observed", steps: [], summary: "7 steps against a 3-step reference run (+4).", detail: {}, evidence: [] }], limitations: [] } },
    { runId: "r2", outDir: "/p/.rawstep/runs/x/run-2", outcome: { status: "failure", reason: "max-steps" }, hints: { schemaVersion: "2.0", runId: "r2", taskId: "t", steps: 40, durationMs: 10, goalReached: false, hints: [], limitations: [] } },
  ],
  findings: [
    { kind: "backtracking", source: "model", runs: 1, totalRuns: 2, occurrences: [] },
    { kind: "focus-lost", source: "page", target: { role: "button", name: "Pay" }, runs: 2, totalRuns: 2, occurrences: [] },
    { kind: "missing-announcement", source: "page", runs: 1, totalRuns: 2, occurrences: [] },
  ],
};
describe("run", () => {
  it("passes the options to runTask, prints outcomes and findings grouped as Page and Model, and exits 0 whatever the outcome", async () => {
    const directory = await temporaryDirectory(), io = output(directory), runTask = vi.fn(async () => result);
    expect(await runCli(["run", "login", "--model", "fast", "--profile", "zoom", "--mode", "screenreader", "--repeat", "2", "--out", "out"], { ...io, runTask })).toBe(0);
    expect(runTask).toHaveBeenCalledWith("login", expect.objectContaining({ projectDir: directory, model: "fast", profile: "zoom", mode: "screenreader", repeat: 2, outDir: join(directory, "out"), signal: expect.any(AbortSignal) }));
    const out = text(io.stdout);
    expect(out).toContain("Run 1 of 2: goal reached · 7 steps");
    expect(out).toContain("Run 2 of 2: goal not reached (max-steps) · 40 steps");
    expect(out.indexOf("Page")).toBeLessThan(out.indexOf("Model"));
    expect(out).toContain('button "Pay" · focus-lost · 2 of 2 runs');
    expect(out).toContain("(no element) · missing-announcement · 1 of 2 runs");
    expect(out).toContain("(no element) · backtracking · 1 of 2 runs");
  });
  it("defaults to keyboard mode with one run and the current directory", async () => {
    const directory = await temporaryDirectory(), io = output(directory), runTask = vi.fn(async (_task: string, _options?: unknown) => result);
    expect(await runCli(["run", "task.json"], { ...io, runTask })).toBe(0);
    expect(runTask.mock.calls[0]).toEqual(["task.json", expect.objectContaining({ projectDir: directory, mode: "keyboard", repeat: 1 })]);
    expect(runTask.mock.calls[0]![1]).not.toHaveProperty("model");
  });
  it("prints the result object with --json", async () => {
    const io = output(await temporaryDirectory());
    expect(await runCli(["run", "task.json", "--json"], { ...io, runTask: async () => result })).toBe(0);
    expect(JSON.parse(text(io.stdout))).toEqual(result);
    expect(text(io.stderr)).not.toContain("Running");
  });
  it("reports errors with a non-zero exit code and no stack", async () => {
    const io = output(await temporaryDirectory());
    const runTask = async () => { throw new ProjectError("no-config", "rawstep.config.json was not found. Create it with `rawstep init` or `rawstep ui`.", 404); };
    expect(await runCli(["run", "task.json"], { ...io, runTask })).toBe(1);
    expect(text(io.stderr)).toContain("rawstep.config.json was not found"); expect(text(io.stderr)).not.toContain("(no-config)");
    expect(text(io.stdout)).toBe("");
  });
  it.each([["SIGINT", 130], ["SIGTERM", 143]] as const)("exits %s-style on cancellation and removes its signal handlers", async (signal, code) => {
    const signals = new EventEmitter(), io = output(await temporaryDirectory());
    const runTask = vi.fn(async (_task: string, options?: { signal?: AbortSignal }) => new Promise<RunTaskResult>((_accept, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new ProjectError("cancelled", "The run was cancelled.")), { once: true });
    }));
    const pending = runCli(["run", "task.json"], { ...io, signals, runTask });
    await vi.waitFor(() => expect(signals.listenerCount(signal)).toBe(1)); signals.emit(signal);
    expect(await pending).toBe(code);
    expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
    expect(text(io.stderr)).toContain("cancelled");
  });
  it("removes its signal handlers when the run throws", async () => {
    const signals = new EventEmitter(), io = output(await temporaryDirectory());
    expect(await runCli(["run", "task.json"], { ...io, signals, runTask: async () => { throw new Error("boom"); } })).toBe(1);
    expect(signals.listenerCount("SIGINT") + signals.listenerCount("SIGTERM")).toBe(0);
  });
  it("formats a run without an outcome and a run without findings", () => {
    const out = formatRunResult({ runs: [{ runId: "x", outDir: "/o", outcome: undefined, hints: { ...result.runs[1]!.hints, steps: 0 } }], findings: [] });
    expect(out).toContain("Run 1 of 1: no outcome recorded · 0 steps"); expect(out).toContain("No page or model findings.");
  });
});

describe("offline analysis and reports", () => {
  it("analyzes and renders a saved trace locally, without a project config", async () => {
    const directory = await temporaryDirectory();
    const source = JSON.stringify(fixtureTrace());
    await writeFile(join(directory, "trace.json"), source);
    const io = output(directory);
    expect(await runCli(["analyze", "trace.json"], io)).toBe(0);
    expect(await runCli(["report", "trace.json", "--analysis", "analysis.json"], io)).toBe(0);
    expect(await readFile(join(directory, "trace.json"), "utf8")).toBe(source);
    expect(await readFile(join(directory, "report.html"), "utf8")).toContain("cli-test");
  });
  it("refuses analysis from a different run", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "trace.json"), JSON.stringify(fixtureTrace()));
    await writeFile(join(directory, "analysis.json"), JSON.stringify({ schemaVersion: "1.0", traceSchemaVersion: "2.2", runId: "another-run", status: "completed", findings: [] }));
    const io = output(directory);
    expect(await runCli(["report", "trace.json", "--analysis", "analysis.json"], io)).toBe(1);
    expect(text(io.stderr)).toMatch(/run|trace/i);
  });
  it("needs the analysis model named by --model to exist in rawstep.config.json", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "trace.json"), JSON.stringify(fixtureTrace()));
    const io = output(directory);
    expect(await runCli(["analyze", "trace.json", "--model", "judge"], io)).toBe(1);
    expect(text(io.stderr)).toContain("rawstep.config.json was not found");
    await initProject(directory);
    expect(await runCli(["analyze", "trace.json", "--model", "judge"], io)).toBe(1);
    expect(text(io.stderr)).toContain('No model "judge"');
  });
});

/** A saved trace with eleven Tab presses before activation (an excess-keystrokes hint) and the given step count. */
function frictionTrace(runId: string, steps: number, tabs = 11): RunTrace {
  const decisions = [...Array.from({ length: tabs }, () => "Tab"), "Enter"].map((key, index) => ({ type: "policy.decision", data: { step: index + 1, decision: { action: { kind: "key", key } } } }));
  return { ...fixtureTrace(), runId, outcome: { status: "success", steps },
    events: decisions.map((event, index) => ({ id: `event-${index + 1}`, seq: index + 1, timestamp: "2026-01-01T00:00:00.000Z", source: "policy" as const, redacted: false, ...event })) };
}

describe("hints command", () => {
  it("parses hints with an optional reference and rejects other options", () => {
    expect(parseCliArguments(["hints", "run", "--reference", "other"])).toMatchObject({ command: "hints", positionals: ["run"], options: { reference: "other" } });
    for (const args of [["hints"], ["hints", "a", "b"], ["hints", "a", "--out", "x"], ["hints", "a", "--reference"]]) expect(() => parseCliArguments(args)).toThrow();
  });
  it("prints hints and writes hints.json next to the trace without changing it", async () => {
    const directory = await temporaryDirectory();
    const source = JSON.stringify(frictionTrace("hint-run", 12));
    await writeFile(join(directory, "trace.json"), source);
    const io = output(directory);
    expect(await runCli(["hints", "trace.json"], io)).toBe(0);
    const text = io.stdout.mock.calls.flat().join("");
    expect(text).toContain("Hints: 1 · goal reached: yes · steps 12\n");
    expect(text).toContain("step 1,12 · excess-keystrokes · observed · 11 navigation keys");
    expect(text).toContain(`Wrote ${join(directory, "hints.json")}`);
    const written = JSON.parse(await readFile(join(directory, "hints.json"), "utf8"));
    expect(written).toMatchObject({ runId: "hint-run", goalReached: true, steps: 12 });
    expect(written.hints.map((hint: { kind: string }) => hint.kind)).toEqual(["excess-keystrokes"]);
    expect(await readFile(join(directory, "trace.json"), "utf8")).toBe(source);
  });
  it("accepts run directories and compares against a reference run", async () => {
    const directory = await temporaryDirectory();
    await mkdir(join(directory, "slow")); await mkdir(join(directory, "fast"));
    await writeFile(join(directory, "slow", "trace.json"), JSON.stringify(frictionTrace("slow-run", 12)));
    await writeFile(join(directory, "fast", "trace.json"), JSON.stringify(frictionTrace("fast-run", 4, 1)));
    const io = output(directory);
    expect(await runCli(["hints", "slow", "--reference", "fast"], io)).toBe(0);
    const text = io.stdout.mock.calls.flat().join("");
    expect(text).toContain("Hints: 2 · goal reached: yes · steps 12 · reference 4 steps\n");
    expect(text).toContain("step  · slow-run · observed · 12 steps against a 4-step reference run (+8).");
    expect(JSON.parse(await readFile(join(directory, "slow", "hints.json"), "utf8")).reference).toMatchObject({ runId: "fast-run", steps: 4 });
  });
  it("reports a missing trace as a hints-stage failure", async () => {
    const io = output(await temporaryDirectory());
    expect(await runCli(["hints", "missing.json"], io)).toBe(1);
    expect(io.stderr.mock.calls.flat().join("")).toMatch(/missing\.json/);
  });
  it("is written by analyze and rendered by report when present next to the trace", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "trace.json"), JSON.stringify(frictionTrace("analyze-run", 12)));
    const io = output(directory);
    expect(await runCli(["report", "trace.json"], io)).toBe(0);
    expect(await readFile(join(directory, "report.html"), "utf8")).not.toContain("Friction hints");
    expect(await runCli(["analyze", "trace.json"], io)).toBe(0);
    expect(io.stdout.mock.calls.flat().join("")).toContain(`Hints saved: ${join(directory, "hints.json")}`);
    expect(JSON.parse(await readFile(join(directory, "hints.json"), "utf8")).hints).toHaveLength(1);
    expect(await runCli(["report", "trace.json"], io)).toBe(0);
    expect(await readFile(join(directory, "report.html"), "utf8")).toContain("Friction hints");
    expect(JSON.parse(await readFile(join(directory, "report.json"), "utf8")).hints.hints).toHaveLength(1);
  });
});

describe("doctor", () => {
  async function project(configure?: (config: ReturnType<typeof defaultConfig>) => void) {
    const directory = await temporaryDirectory(), config = defaultConfig(); configure?.(config);
    await writeFile(join(directory, "rawstep.config.json"), JSON.stringify(config));
    return directory;
  }
  it("passes when the browser launches, the config parses and the simulation needs no screen reader", async () => {
    const directory = await project(), io = output(directory), launchBrowser = vi.fn(async () => {});
    expect(await runCli(["doctor"], { ...io, launchBrowser })).toBe(0);
    const out = text(io.stdout);
    expect(out).toContain("ok    Browser"); expect(out).toContain("ok    Config"); expect(out).toContain("skip  Screen reader");
    expect(launchBrowser).toHaveBeenCalledOnce();
  });
  it("fails when the browser cannot launch, with the way out", async () => {
    const io = output(await project());
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => { throw new Error("no chromium"); } })).toBe(1);
    expect(text(io.stdout)).toMatch(/FAIL\s+Browser: no chromium.*playwright install/);
  });
  it("fails without a config file but still checks the browser", async () => {
    const io = output(await temporaryDirectory()), launchBrowser = vi.fn(async () => {});
    expect(await runCli(["doctor"], { ...io, launchBrowser })).toBe(1);
    expect(text(io.stdout)).toContain("FAIL  Config: rawstep.config.json was not found");
    expect(launchBrowser).toHaveBeenCalledOnce();
  });
  it("reports an invalid config", async () => {
    const directory = await temporaryDirectory(), io = output(directory);
    await writeFile(join(directory, "rawstep.config.json"), JSON.stringify({ version: 2 }));
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => {} })).toBe(1);
    expect(text(io.stdout)).toContain("FAIL  Config");
  });
  it("checks that the key of each connection is set, without printing it", async () => {
    const present = "RAWSTEP_DOCTOR_PRESENT_KEY", absent = "RAWSTEP_DOCTOR_ABSENT_KEY";
    const directory = await project(config => {
      config.connections.push({ id: "a", name: "With key", provider: "openai", baseURL: "http://127.0.0.1:1234/v1", apiKeyEnv: present, timeoutMs: 1000 }, { id: "b", name: "Missing key", provider: "openai", baseURL: "http://127.0.0.1:1235/v1", apiKeyEnv: absent, timeoutMs: 1000 }, { id: "c", name: "Local", provider: "openai", baseURL: "http://127.0.0.1:1236/v1", timeoutMs: 1000 });
    });
    await writeFile(join(directory, ".env.local"), `${present}="secret-doctor-value"\n`);
    const io = output(directory);
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => {} })).toBe(1);
    const out = text(io.stdout);
    expect(out).toContain(`ok    Connection With key: ${present} is set`); expect(out).toContain(`FAIL  Connection Missing key: ${absent} is missing`); expect(out).toContain("ok    Connection Local: no API key needed");
    expect(out).not.toContain("secret-doctor-value");
  });
  it("probes the native screen reader endpoint when machine.backend is native", async () => {
    const directory = await project(config => { config.machine.backend = "voiceover"; config.machine.atEndpoint = "ws://127.0.0.1:9333"; });
    const io = output(directory), checkNativeBackend = vi.fn(async () => ({}));
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => {}, checkNativeBackend })).toBe(0);
    expect(checkNativeBackend).toHaveBeenCalledWith({ profile: "voiceover", url: "ws://127.0.0.1:9333" });
    expect(text(io.stdout)).toContain("ok    Screen reader: voiceover AT Driver answered");
    const failing = output(directory);
    expect(await runCli(["doctor"], { ...failing, launchBrowser: async () => {}, checkNativeBackend: async () => { throw new Error("ECONNREFUSED"); } })).toBe(1);
    expect(text(failing.stdout)).toContain("FAIL  Screen reader: voiceover AT Driver at ws://127.0.0.1:9333: ECONNREFUSED");
  });
});
