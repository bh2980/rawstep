import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, parseCliArguments, formatRunResult, formatSuiteResult, nodeSupported, type CliDependencies } from "@rawstep/cli/cli";
import { BrowserConnectError } from "@rawstep/browser/browser";
import { ProjectError } from "@rawstep/project/errors";
import { ProjectStore, demoConfig, initProject } from "@rawstep/project/store";
import type { ProviderId } from "@rawstep/project/config";
import { defaultConfig } from "@rawstep/project/config";
import type { RunSuiteResult, RunTaskResult } from "@rawstep/project/run";
import type { RunTrace } from "@rawstep/core/trace";
import type { CheckKind, ModelInspection } from "@rawstep/project/checks";

const directories: string[] = [];
// Providers' standard key variables are read too; a developer's own keys must not leak into the tests.
beforeEach(() => { for (const name of ["RAWSTEP_OPENROUTER_API_KEY", "RAWSTEP_ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "OPENROUTER_API_KEY"]) vi.stubEnv(name, ""); });
afterEach(async () => {
  vi.unstubAllEnvs();
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
  // init looks for coding-agent CLIs on PATH; tests never depend on what this computer has installed.
  return { cwd, stdout, stderr, findAgent: async (): Promise<ProviderId | undefined> => undefined };
}
const text = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.flat().join("");
function fixtureTrace(status: "success" | "failure" = "success"): RunTrace {
  return {
    schemaVersion: "3.0", runId: "cli-test", task: { id: "task" },
    environment: { platform: "test", platformVersion: "unknown", browser: "test", browserVersion: "unknown", screenReader: "test", screenReaderVersion: "unknown" },
    startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:00:01.000Z",
    events: [], outcome: { status }, privacy: { inputValues: "redacted", redactionApplied: false },
  };
}

describe("CLI argument contract", () => {
  it("parses the eight commands and their options", () => {
    expect(parseCliArguments(["init"]).command).toBe("init");
    expect(parseCliArguments(["ui", "--port=5432", "--project", "project"]).options).toEqual({ port: "5432", project: "project" });
    expect(parseCliArguments(["run", "login", "--profile", "zoom", "--repeat", "3", "--parallel", "2", "--note", "button fixed", "--json"])).toMatchObject({
      command: "run", positionals: ["login"], options: { profile: "zoom", repeat: "3", parallel: "2", note: "button fixed", json: true },
    });
    // A suite takes any number of tasks, and its tags and profiles repeat.
    expect(parseCliArguments(["suite", "--tag", "checkout", "--tag=login", "--profile", "a", "--profile", "b", "--parallel", "4"])).toMatchObject({
      command: "suite", positionals: [], options: { tag: ["checkout", "login"], profile: ["a", "b"], parallel: "4" },
    });
    expect(parseCliArguments(["suite", "one", "two"]).positionals).toEqual(["one", "two"]);
    expect(parseCliArguments(["run", "login", "--profile=strict", "--rule", "maxPlannerCalls=1", "--rule=stepActionLimit=30", "--rule", "repetitionGuard=false"]).options)
      .toEqual({ profile: "strict", rule: ["maxPlannerCalls=1", "stepActionLimit=30", "repetitionGuard=false"] });
    expect(parseCliArguments(["analyze", "run-1", "--llm"]).options).toEqual({ llm: true });
    expect(() => parseCliArguments(["run", "login", "--combo", "zoom"])).toThrow(/Unknown option for run: --combo/);
    expect(() => parseCliArguments(["run", "login", "--agent", "zoom"])).toThrow(/Unknown option for run: --agent/);
    expect(parseCliArguments(["hints", "run", "--reference", "other"])).toMatchObject({ command: "hints", positionals: ["run"], options: { reference: "other" } });
    expect(parseCliArguments(["report", "run", "--analysis", "analysis.json", "--out", "x"]).command).toBe("report");
    expect(parseCliArguments(["doctor"]).command).toBe("doctor");
  });
  it.each([
    ["ui", "--port", "0"], ["ui", "--port", "65536"], ["ui", "--port", "1", "--port", "2"], ["ui", "task.json"],
    ["init", "extra"], ["doctor", "--backend", "nvda"],
    ["run"], ["run", "a", "b"], ["run", "a", "--mode", "screenreader"], ["run", "a", "--mode", "keyboard"], ["run", "a", "--repeat", "0"], ["run", "a", "--repeat", "101"], ["run", "a", "--repeat", "two"],
    ["run", "a", "--json=yes"], ["run", "a", "--model"], ["run", "a", "--model", "fast"], ["analyze", "run", "--model", "judge"], ["run", "a", "--out", "x"], ["run", "a", "--profile", "x", "--profile", "y"],
    ["run", "a", "--parallel", "0"], ["suite", "--parallel", "9"], ["suite", "--repeat", "0"], ["suite", "--tag"],
    ["run", "a", "--rule", "maxPlannerCalls=1001"], ["run", "a", "--rule", "maxPlannerCalls=-1"], ["run", "a", "--rule", "stepActionLimit=0"], ["run", "a", "--rule", "stepActionLimit=many"],
    ["run", "a", "--rule", "survey=wide"], ["run", "a", "--rule", "repetitionGuard=auto"], ["run", "a", "--rule", "repetitionGuard=on"], ["run", "a", "--rule", "modelGiveUp=true"], ["run", "a", "--rule", "maxStateVisits=3"], ["run", "a", "--rule", "maxPlannerCalls"], ["run", "a", "--rule", "maxPlannerCalls="], ["run", "a", "--rule", "nope=1"], ["run", "a", "--max-replans", "1"], ["run", "a", "--max-task-actions", "5"], ["ui", "--rule", "maxPlannerCalls=1"],
    ["run", "a", "--diagnose-stop"], ["run", "a", "--profile"], ["run", "a", "--profile", "x", "--profile", "y"], ["run", "a", "--preset", "x"], ["run", "a", "--at", "nvda"], ["analyze", "run", "--combo", "x"], ["doctor", "--profile", "x"],
    // Options of the removed commands and of the environment-variable configuration are gone.
    ["run", "a", "--policy", "policy.mjs"], ["run", "a", "--script", "decisions.json"], ["run", "a", "--decision", "systemone"], ["run", "a", "--backend", "voiceover"],
    ["analyze", "run", "--profile", "judge"], ["analyze", "run", "--analyzer", "a.mjs"], ["analyze"],
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
    for (const gone of ["mock-run", "screenshot-run", "matrix", "RAWSTEP_DECISION", "RAWSTEP_ANALYSIS", "--decision", "--mode", "--diagnose-stop", "keyboard", "pixels"]) expect(help).not.toContain(gone);
    expect(await runCli(["legacy-run"], io)).toBe(2);
    expect(text(io.stderr)).toContain("Unknown command: legacy-run");
  });
});

describe("local dashboard command", () => {
  it("closes the server on a signal and starts it in the project directory", async () => {
    const signals = new EventEmitter(), close = vi.fn(async () => {}), stdout = vi.fn();
    const startDashboard = vi.fn(async () => ({ url: "http://127.0.0.1:5432", close }));
    const cwd = await temporaryDirectory();
    const pending = runCli(["ui", "--port=5432", "--project", "project"], { cwd, signals, startDashboard, stdout, stderr: () => {}, findAgent: async () => undefined });
    await vi.waitFor(() => expect(signals.listenerCount("SIGINT")).toBe(1)); signals.emit("SIGINT");
    expect(await pending).toBe(0); expect(startDashboard).toHaveBeenCalledWith({ projectDir: join(cwd, "project"), port: 5432 }); expect(close).toHaveBeenCalledOnce(); expect(signals.listenerCount("SIGTERM")).toBe(0);
    // The first `ui` in an empty folder starts with the demo, as `init` does; a second one leaves the project as it is.
    expect((await new ProjectStore(join(cwd, "project")).read()).config.tasks.map(t => t.id)).toEqual(["demo"]);
    expect(text(stdout)).toContain("with a demo task");
    const again = vi.fn(), second = runCli(["ui", "--project", "project"], { cwd, signals, startDashboard, stdout: again, stderr: () => {} });
    await vi.waitFor(() => expect(signals.listenerCount("SIGINT")).toBe(1)); signals.emit("SIGINT");
    expect(await second).toBe(0); expect(text(again)).not.toContain("demo task");
  });
});

describe("init", () => {
  it("writes a project with the demo task, says what to run next, and refuses to overwrite it", async () => {
    const directory = await temporaryDirectory(), io = output(directory);
    expect(await runCli(["init"], io)).toBe(0);
    expect(text(io.stdout)).toContain(join(directory, "rawstep.config.json"));
    expect(text(io.stdout)).toMatch(/npx rawstep run demo\s+the demo task on a plan written beforehand[\s\S]*Settings > AI connections[\s\S]*A coding-agent CLI you are signed in to/);
    expect(JSON.parse(await readFile(join(directory, "rawstep.config.json"), "utf8"))).toEqual(demoConfig());
    // A coding-agent CLI on this computer is only named, never connected: connecting sends what the user hears to its provider.
    const found = await temporaryDirectory(), withAgent = { ...output(found), findAgent: async () => "claudeCode" as const };
    expect(await runCli(["init"], withAgent)).toBe(0);
    expect(text(withAgent.stdout)).toContain("Claude Code is installed on this computer");
    expect((await new ProjectStore(found).read()).config.connections).toEqual([]);
    await writeFile(join(directory, "rawstep.config.json"), "{\"mine\":true}");
    expect(await runCli(["init"], io)).toBe(1);
    expect(text(io.stderr)).toContain("already exists");
    expect(await readFile(join(directory, "rawstep.config.json"), "utf8")).toBe("{\"mine\":true}");
    await expect(initProject(directory)).rejects.toBeInstanceOf(ProjectError);
  });
  it("initializes the directory given by --project", async () => {
    const directory = await temporaryDirectory(), io = output(directory);
    expect(await runCli(["init", "--project", "sub/app"], io)).toBe(0);
    expect((await new ProjectStore(join(directory, "sub/app")).read()).config.profiles).toHaveLength(2);
  });
});

/** Which task and profile a fixture run belongs to. */
const where = { taskId: "t", taskName: "Task", profileId: "default", profileName: "Careful reader" };
const result: RunTaskResult = {
  batch: { id: "b", dir: "/p/.rawstep/experiments/b" },
  conditions: {
    profile: { id: "default", name: "Careful reader" }, combo: { id: "default", name: "Default", planner: "Claude · plan" }, actionSet: { id: "basic", name: "Basic" },
    pageEnvironment: { id: "default", name: "Careful reader", profile: "default" }, atEnvironment: { id: "default", name: "Careful reader", backend: "simulation" },
  },
  warnings: [],
  runs: [
    { ...where, runId: "r1", outDir: "/p/.rawstep/experiments/b/r1", outcome: { status: "success" }, hints: { schemaVersion: "3.0", runId: "r1", taskId: "t", steps: 7, durationMs: 10, goalReached: true, hints: [{ kind: "slow-run", source: "run", certainty: "observed", steps: [], summary: "7 steps against a 3-step reference run (+4).", detail: {}, evidence: [] }], limitations: [] } },
    { ...where, runId: "r2", outDir: "/p/.rawstep/experiments/b/r2", outcome: { status: "inconclusive", reason: "maxSteps" }, hints: { schemaVersion: "3.0", runId: "r2", taskId: "t", steps: 40, durationMs: 10, goalReached: false, hints: [], limitations: [] } },
  ],
  findings: [
    { kind: "backtracking", source: "model", runs: 1, totalRuns: 2, occurrences: [] },
    { kind: "replan", source: "model", runs: 1, totalRuns: 2, occurrences: [] },
    { kind: "focus-lost", source: "page", target: { role: "button", name: "Pay" }, runs: 2, totalRuns: 2, occurrences: [] },
    { kind: "missing-announcement", source: "page", runs: 1, totalRuns: 2, occurrences: [] },
  ],
};
/** Every run gave a measurement: it reached the goal. */
const measured: RunTaskResult = { ...result, runs: [result.runs[0]!] };
describe("run", () => {
  it("passes the options to runTask, prints the conditions, how each run ended and what it cost, and findings grouped as Page and Model, and exits 3 when a run was not measured", async () => {
    const directory = await temporaryDirectory(), io = output(directory), runTask = vi.fn(async () => result);
    expect(await runCli(["run", "login", "--profile", "zoom", "--repeat", "2", "--parallel", "2", "--note", "button fixed"], { ...io, runTask })).toBe(3);
    expect(runTask).toHaveBeenCalledWith("login", expect.objectContaining({ projectDir: directory, profile: "zoom", repeat: 2, parallel: 2, note: "button fixed", signal: expect.any(AbortSignal) }));
    const out = text(io.stdout);
    expect(out.startsWith("Conditions: Careful reader (planner Claude · plan)\n  page default · screen reader simulation\n")).toBe(true);
    expect(out.indexOf("Conditions:")).toBeLessThan(out.indexOf("Run 1 of 2"));
    expect(out).toContain("(no element) · replan · 1 of 2 runs");
    expect(out).toContain("Run 1 of 2: reached the goal · 7 moves");
    // A limit ending the run says nothing about the user: not measured, with the limit named.
    expect(out).toContain("Run 2 of 2: not measured (max steps) · 40 moves");
    expect(out).toContain("Could a first-time user do it? reached the goal in 1 of 2 runs · not measured 1");
    expect(out).toContain("Cost of reaching it: 7 moves");
    expect(out.indexOf("Page")).toBeLessThan(out.indexOf("Model"));
    expect(out).toContain('button "Pay" · focus-lost · 2 of 2 runs');
    expect(out).toContain("(no element) · missing-announcement · 1 of 2 runs");
    expect(out).toContain("(no element) · backtracking · 1 of 2 runs");
  });
  it("maps the profile flag and the run-rule flags to runTask options, and passes none that were not given", async () => {
    const directory = await temporaryDirectory(), io = output(directory), runTask = vi.fn(async (_task: string, _options?: unknown) => measured);
    expect(await runCli(["run", "t", "--profile", "strict", "--rule", "maxPlannerCalls=1", "--rule", "stepActionLimit=30", "--rule", "survey=headings"], { ...io, runTask })).toBe(0);
    expect(runTask.mock.calls[0]![1]).toMatchObject({ profile: "strict", runRules: { maxPlannerCalls: 1, stepActionLimit: 30, survey: "headings" } });
    await runCli(["run", "t", "--rule", "stepActionLimit=5"], { ...io, runTask });
    expect(runTask.mock.calls[1]![1]).toMatchObject({ runRules: { stepActionLimit: 5 } }); expect((runTask.mock.calls[1]![1] as { runRules: object }).runRules).not.toHaveProperty("maxPlannerCalls");
    // Each value is read as its rule's type, and the last of a repeated rule wins.
    await runCli(["run", "t", "--rule", "maxPlannerCalls=2", "--rule", "repetitionGuard=false", "--rule", "stepActionLimit=7", "--rule", "survey=headings", "--rule", "maxPlannerCalls=3"], { ...io, runTask });
    expect((runTask.mock.calls[2]![1] as { runRules: object }).runRules).toEqual({ maxPlannerCalls: 3, repetitionGuard: false, stepActionLimit: 7, survey: "headings" });
    await runCli(["run", "t"], { ...io, runTask });
    for (const key of ["profile", "runRules"]) expect(runTask.mock.calls[3]![1]).not.toHaveProperty(key);
  });
  it("shows why a run broke and does not count it as a try", () => {
    const broke = { ...where, runId: "r1", outDir: "/p/run-1", outcome: { status: "failure" as const, reason: "error", stage: "browser-start", error: "page.goto: net::ERR_FILE_NOT_FOUND at file:///p/page.html\nCall log: ..." }, hints: { ...result.runs[0]!.hints, steps: 0, hints: [] } };
    const out = formatRunResult({ ...result, runs: [broke], findings: [] });
    expect(out).toContain("  Error (browser-start): page.goto: net::ERR_FILE_NOT_FOUND at file:///p/page.html\n");
    expect(out).not.toContain("Call log");
    expect(out).toContain("Could a first-time user do it? not known: the run ended before the user could try (see the error above)");
    expect(formatRunResult({ ...result, runs: [result.runs[0]!, broke] })).toMatch(/reached the goal in \d of 1 runs.* · 1 more ended on an error \(not counted\)/);
  });
  it("says why a user gave up and on which broken expectation, and lists where pressing did not respond as expected", () => {
    const stuck = { kind: "expectation-broken" as const, source: "model" as const, target: { role: "button", name: "Size" }, certainty: "observed" as const, steps: [17], summary: "", evidence: [],
      detail: { assumption: { id: "A3", text: "Pressing Size announces it as selected" }, pressed: 16, gaveUpOn: true } };
    const guess = { ...stuck, target: { role: "cell", name: "1%" }, steps: [30], detail: { assumption: { id: "A4", text: "Buy comes after the table" } } };
    const out = formatRunResult({ ...result, runs: [{ ...where, runId: "r1", outDir: "/p/run-1", outcome: { status: "failure", reason: "policy-stuck", policyStopSource: "user-gave-up" }, hints: { schemaVersion: "3.0", runId: "r1", taskId: "t", steps: 34, durationMs: 1, goalReached: false, limitations: [],
      hints: [stuck, guess, { kind: "early-stop", source: "model", certainty: "observed", steps: [34], summary: "The user gave up", evidence: [], detail: { stopSource: "user-gave-up", giveUp: { reason: "Size never selects", tried: ["A3"] } } },
        { kind: "goal-word-stretch", source: "run", certainty: "observed", steps: [3, 11], summary: "9 moves", evidence: [], detail: { moves: 9 } },
        ...[["failures", 12], ["failures", 20], ["no-change", 25]].map(([trigger, step]) => ({ kind: "replan" as const, source: "run" as const, certainty: "observed" as const, steps: [step as number], summary: "replanned", evidence: [], detail: { trigger } }))] } }],
      findings: [{ kind: "expectation-broken", source: "model", target: stuck.target, runs: 1, totalRuns: 1, occurrences: [{ runId: "r1", steps: [17], certainty: "observed", detail: stuck.detail }] },
        { kind: "expectation-broken", source: "model", target: guess.target, runs: 1, totalRuns: 1, occurrences: [{ runId: "r1", steps: [30], certainty: "observed", detail: guess.detail }] }] });
    expect(out).toContain("Run 1 of 1: gave up · 34 moves");
    expect(out).toContain('  Why: "Size never selects"');
    expect(out).toContain('  Rests on A3 "Pressing Size announces it as selected" · broke at step 17 after pressing button "Size"');
    expect(out).toContain("longest without a goal word: 9 moves · wrong guesses about where something is: 1");
    expect(out).toContain("  new plans: 3 (actions kept failing 2, actions changed nothing 1)"); expect(out).not.toContain("replanned");
    expect(out).not.toContain("early-stop");
    expect(out).toContain('  button "Size" · 1 of 1 runs · 1 give-up rest on it');
    // A guess about where something is broke on whatever the cursor was on: not a stuck place.
    expect(out).not.toContain('cell "1%"');
    expect(out).toContain("Could a first-time user do it? reached the goal in 0 of 1 runs · gave up 1");
  });
  it("lists the warnings under the conditions, and shows a profile that reads a plan file as its planner", () => {
    const planned = formatRunResult({ ...result, conditions: { ...result.conditions, profile: { name: "Planner pair" }, combo: { name: "Planner pair", planFile: "plans/t.json" } }, warnings: ["The analysis model is not an LLM; no analysis is written."] });
    expect(planned).toContain("Conditions: Planner pair (planner plan file plans/t.json)");
    expect(planned).toContain("  note: The analysis model is not an LLM");
    expect(planned.indexOf("note:")).toBeLessThan(planned.indexOf("Run 1 of 2"));
  });
  it("leaves everything else to the profile and runTask's defaults, in the current directory", async () => {
    const directory = await temporaryDirectory(), io = output(directory), runTask = vi.fn(async (_task: string, _options?: unknown) => measured);
    expect(await runCli(["run", "task.json"], { ...io, runTask })).toBe(0);
    expect(runTask.mock.calls[0]).toEqual(["task.json", expect.objectContaining({ projectDir: directory })]);
    // Repeats and runs at once are left to runTask (one run, the project's machine.parallelRuns).
    expect(runTask.mock.calls[0]![1]).not.toHaveProperty("repeat"); expect(runTask.mock.calls[0]![1]).not.toHaveProperty("parallel");
    expect(runTask.mock.calls[0]![1]).not.toHaveProperty("mode"); expect(runTask.mock.calls[0]![1]).not.toHaveProperty("model"); expect(runTask.mock.calls[0]![1]).not.toHaveProperty("profile");
  });
  it("prints the result object with --json", async () => {
    const io = output(await temporaryDirectory());
    expect(await runCli(["run", "task.json", "--json"], { ...io, runTask: async () => measured })).toBe(0);
    expect(JSON.parse(text(io.stdout))).toEqual(measured);
    expect(text(io.stderr)).not.toContain("Running");
  });
  it("runs a suite by tags and profiles, prints each task under each profile and the batch, and exits like run", async () => {
    const directory = await temporaryDirectory(), io = output(directory);
    const [reached, unmeasured] = result.runs as [RunSuiteResult["runs"][number], RunSuiteResult["runs"][number]];
    const other = { ...reached, taskId: "u", taskName: "Checkout", runId: "r3" };
    const suite: RunSuiteResult = { batch: result.batch, warnings: [], runs: [reached, unmeasured, other], groups: [
      { taskId: "t", taskName: "Task", profileId: "default", profileName: "Careful reader", runs: [reached, unmeasured], findings: [] },
      { taskId: "u", taskName: "Checkout", profileId: "default", profileName: "Careful reader", runs: [other], findings: [] },
    ] };
    const runSuite = vi.fn(async () => suite);
    expect(await runCli(["suite", "--tag", "shop", "--profile", "default", "--repeat", "2"], { ...io, runSuite })).toBe(3);
    expect(runSuite).toHaveBeenCalledWith(expect.objectContaining({ projectDir: directory, tags: ["shop"], profiles: ["default"], repeat: 2 }));
    const out = text(io.stdout);
    expect(out).toContain("Task: reached the goal in 1 of 2 runs · not measured 1\n  cost of reaching it: 7 moves");
    expect(out).toContain("Checkout: reached the goal in 1 of 1 runs");
    expect(out).toContain("All 3 runs: reached the goal in 2 of 3 runs · not measured 1");
    expect(out).toContain("Batch: /p/.rawstep/experiments/b");
    expect(formatSuiteResult({ ...suite, runs: [reached, other], groups: suite.groups.map(g => ({ ...g, runs: g.runs.filter(r => r !== unmeasured) })) })).toContain("All 2 runs: reached the goal in 2 of 2 runs");
  });
  it("exits 0 when every run gave a measurement, 3 when none broke but one was not measured, and 1 when any ended on an error", async () => {
    const io = () => output("/unused");
    const run = (runs: RunTaskResult["runs"]) => runCli(["run", "task.json"], { ...io(), runTask: async () => ({ ...result, runs }) });
    const [reached, unmeasured] = result.runs as [RunTaskResult["runs"][number], RunTaskResult["runs"][number]];
    const withOutcome = (outcome: RunTaskResult["runs"][number]["outcome"]) => ({ ...reached, outcome });
    expect(await run([reached, withOutcome({ status: "failure", reason: "policy-stuck", policyStopSource: "user-gave-up" }), withOutcome({ status: "failure", reason: "verification-failed" })])).toBe(0);
    expect(await run([reached, unmeasured])).toBe(3);
    expect(await run([withOutcome({ status: "failure", reason: "timeout" })])).toBe(3);
    expect(await run([withOutcome({ status: "failure", reason: "access-blocked" })])).toBe(3);
    expect(await run([withOutcome({ status: "failure", reason: "error", stage: "browser-start", error: "boom" })])).toBe(1);
    // An error wins over a run that was only not measured.
    expect(await run([unmeasured, withOutcome({ status: "failure", reason: "trace-persistence-error" })])).toBe(1);
    // 2 stays bad usage.
    expect(await runCli(["run"], io())).toBe(2);
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
    const out = formatRunResult({ batch: result.batch, conditions: {}, warnings: [], runs: [{ ...where, runId: "x", outDir: "/o", outcome: undefined, hints: { ...result.runs[1]!.hints, steps: 0 } }], findings: [] });
    expect(out).toContain("Run 1 of 1: no outcome recorded · 0 moves"); expect(out).toContain("No findings."); expect(out).not.toContain("Conditions:");
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
    await writeFile(join(directory, "analysis.json"), JSON.stringify({ schemaVersion: "1.0", traceSchemaVersion: "3.0", runId: "another-run", status: "completed", findings: [] }));
    const io = output(directory);
    expect(await runCli(["report", "trace.json", "--analysis", "analysis.json"], io)).toBe(1);
    expect(text(io.stderr)).toMatch(/run|trace/i);
  });
  it("needs a project with an analysis model for --llm", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "trace.json"), JSON.stringify(fixtureTrace()));
    const io = output(directory);
    expect(await runCli(["analyze", "trace.json", "--llm"], io)).toBe(1);
    expect(text(io.stderr)).toContain("rawstep.config.json was not found");
    await initProject(directory);
    expect(await runCli(["analyze", "trace.json", "--llm"], io)).toBe(1);
    expect(text(io.stderr)).toContain("project has no analysis model");
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
    expect(text).toContain("whole run · slow-run · observed · 12 steps against a 4-step reference run (+8).");
    expect(text).toContain("Against the reference run: 1 new, 0 gone, 0 in both\n");
    expect(text).toContain("New in this run:\n  step 1,12 · excess-keystrokes · observed");
    expect(text).toContain("observed: recorded directly · suspected: inferred from indirect signals, may be wrong\n");
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

/** What a model list check found, for the doctor tests that stand in for the provider. */
const inspected = (kind: CheckKind, cause?: ProjectError): ModelInspection => ({ check: { ok: kind === "ready", kind, via: "model-list", checkedAt: "2026-01-01T00:00:00.000Z" }, ...(cause ? { cause } : {}) });

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
    expect(out).toContain("1 run profiles");
    expect(launchBrowser).toHaveBeenCalledOnce();
  });
  it("warns about a profile that cannot run yet and a project without tasks, and fails on a missing plan file", async () => {
    const directory = await project(config => { config.profiles.push({ ...config.profiles[0]!, id: "filed", name: "Filed", planner: { planFile: "plans/missing.json" } }); });
    const io = output(directory);
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => {} })).toBe(1);
    const out = text(io.stdout);
    expect(out).toMatch(/warn  Tasks: none yet/); expect(out).toMatch(/warn  Profile Default: no planner yet, so it cannot run/);
    expect(out).toMatch(/FAIL  Profile Filed: its plan file plans\/missing.json is missing/);
    const demo = await temporaryDirectory(); await initProject(demo);
    const ready = output(demo);
    expect(await runCli(["doctor"], { ...ready, launchBrowser: async () => {} })).toBe(0);
    expect(text(ready.stdout)).toMatch(/ok    Profile Written plan \(no model\): follows the plan file rawstep\/demo\/plan.json/);
  });
  it("fails when the browser cannot launch, with the way out", async () => {
    const io = output(await project());
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => { throw new Error("no chromium"); } })).toBe(1);
    expect(text(io.stdout)).toMatch(/FAIL\s+Browser: no chromium.*playwright install/);
  });
  it("reports why a connected browser failed without the generic launch advice", async () => {
    const io = output(await project());
    const refused = new BrowserConnectError("http://localhost:9222", "refused", "The browser at http://localhost:9222 answered but refused the connection (Browser.setDownloadBehavior). Close guest, incognito and profile-picker windows in that Chrome, or restart it with a fresh --user-data-dir, then try again.", new Error("raw protocol text"));
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => { throw refused; } })).toBe(1);
    expect(text(io.stdout)).toMatch(/FAIL\s+Browser: The browser at http:\/\/localhost:9222 answered but refused the connection \(Browser.setDownloadBehavior\)\. Close guest.*machine\.browserEndpoint/);
    expect(text(io.stdout)).not.toContain("raw protocol text");
    expect(text(io.stdout)).not.toContain("playwright install");
  });
  it("fails without a config file but still checks the browser", async () => {
    const io = output(await temporaryDirectory()), launchBrowser = vi.fn(async () => {});
    expect(await runCli(["doctor"], { ...io, launchBrowser })).toBe(1);
    expect(text(io.stdout)).toContain("FAIL  Config: rawstep.config.json was not found");
    expect(launchBrowser).toHaveBeenCalledOnce();
  });
  it("reports an invalid config, and an old one with what to do instead", async () => {
    const directory = await temporaryDirectory(), io = output(directory);
    await writeFile(join(directory, "rawstep.config.json"), JSON.stringify({ version: 5 }));
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => {} })).toBe(1);
    expect(text(io.stdout)).toContain("FAIL  Config");
    const old = output(directory);
    await writeFile(join(directory, "rawstep.config.json"), JSON.stringify({ version: 2 }));
    expect(await runCli(["doctor"], { ...old, launchBrowser: async () => {} })).toBe(1);
    expect(text(old.stdout)).toMatch(/FAIL  Config: .*version 2.*rawstep init/);
    const run = output(directory);
    expect(await runCli(["run", "task.json"], run)).toBe(1);
    expect(text(run.stderr)).toMatch(/version 2.*rawstep init/);
  });
  it("checks the key of each provider and keyed custom connection, without printing it", async () => {
    const present = "RAWSTEP_DOCTOR_PRESENT_KEY", absent = "RAWSTEP_DOCTOR_ABSENT_KEY", optional = "RAWSTEP_DOCTOR_OPTIONAL_KEY";
    const base = { timeoutMs: 1000 };
    const directory = await project(config => {
      config.connections.push(
        { ...base, id: "a", name: "With key", provider: "custom", baseURL: "http://127.0.0.1:1234/v1", apiKeyEnv: present },
        { ...base, id: "b", name: "Optional key", provider: "custom", baseURL: "http://127.0.0.1:1235/v1", apiKeyEnv: optional },
        { ...base, id: "c", name: "Local", provider: "custom", baseURL: "http://127.0.0.1:1236/v1" },
        { ...base, id: "d", name: "Hosted", provider: "anthropic" },
      );
    });
    await writeFile(join(directory, ".env.local"), `${present}="secret-doctor-value"\n`);
    vi.stubEnv("RAWSTEP_ANTHROPIC_API_KEY", "");
    const io = output(directory), checkModel = vi.fn(async (_model: unknown, _key: string) => inspected("ready"));
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => {}, checkModel })).toBe(1);
    const out = text(io.stdout);
    // A key that is set is tried against the server; the line names the variable and says it works, not that it is set.
    expect(out).toMatch(new RegExp(`ok    Key With key: ${present} works \\(\\d+\\.\\d s\\)`)); expect(out).not.toContain("is set");
    expect(checkModel).toHaveBeenCalledOnce(); expect(checkModel).toHaveBeenCalledWith({ provider: "custom", baseURL: "http://127.0.0.1:1234/v1" }, "secret-doctor-value");
    expect(out).toContain(`ok    Key Optional key: ${optional} is not set (optional for this server)`);
    expect(out).toContain("ok    Key Local: no API key needed"); expect(out).toContain("FAIL  Key Anthropic: RAWSTEP_ANTHROPIC_API_KEY is missing");
    expect(out).toContain("(ANTHROPIC_API_KEY also works)");
    expect(out).not.toContain("secret-doctor-value");
  });
  describe("API keys and models", () => {
    const model = "vendor/model-name:free";
    const keyed = () => project(config => {
      config.connections.push({ id: "or", name: "OpenRouter", provider: "openrouter", timeoutMs: 1000 });
      config.profiles[0] = { ...config.profiles[0]!, planner: { connectionId: "or", modelId: model, instructions: "" } };
    });
    const doctor = async (check: (m: unknown, key: string) => Promise<ModelInspection>) => {
      const io = output(await keyed()), checkModel = vi.fn(check);
      const code = await runCli(["doctor"], { ...io, launchBrowser: async () => {}, checkModel });
      return { code, out: text(io.stdout), checkModel };
    };
    it("names the variable that supplied the key and the model it found in the provider's list", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-standard-doctor");
      const { code, out, checkModel } = await doctor(async () => inspected("ready"));
      expect(code).toBe(0);
      expect(out).toMatch(/ok    Profile Default: plans with OpenRouter · vendor\/model-name:free/);
      expect(out).toMatch(/ok    Key OpenRouter: OPENROUTER_API_KEY works · model vendor\/model-name:free listed \(\d+\.\d s\)/);
      expect(checkModel).toHaveBeenCalledWith({ provider: "openrouter", modelId: model }, "sk-standard-doctor");
      expect(out).not.toContain("sk-standard-doctor");
      // RAWSTEP_ wins when both are set.
      vi.stubEnv("RAWSTEP_OPENROUTER_API_KEY", "sk-own-doctor");
      expect((await doctor(async () => inspected("ready"))).out).toContain("RAWSTEP_OPENROUTER_API_KEY works");
    });
    it.each([
      ["a refused key", () => inspected("rejected", Object.assign(new ProjectError("model-http", "HTTP 401", 502), { httpStatus: 401 })), /FAIL  Key OpenRouter: OPENROUTER_API_KEY was refused by OpenRouter \(HTTP 401\)/],
      ["a model that is not listed", () => inspected("model-not-listed"), /FAIL  Key OpenRouter: OPENROUTER_API_KEY works, but OpenRouter does not list model vendor\/model-name:free\. Check the model ID \(OpenRouter ids look like vendor\/model/],
      ["a provider that does not answer in time", () => inspected("unreachable", new ProjectError("model-timeout", "slow", 502)), /FAIL  Key OpenRouter: OpenRouter did not answer the model list request in time/],
      ["a provider that cannot be reached", () => inspected("unreachable", new ProjectError("model-unreachable", "down", 502)), /FAIL  Key OpenRouter: cannot reach OpenRouter/],
    ])("fails on %s", async (_name, inspection, line) => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-standard-doctor");
      const { code, out } = await doctor(async () => inspection());
      expect(code).toBe(1); expect(out).toMatch(line);
    });
    it("reports a check that itself threw as a failed line, and still runs the checks after it", async () => {
      vi.stubEnv("OPENROUTER_API_KEY", "sk-standard-doctor");
      const { code, out } = await doctor(async () => { throw new Error("socket hang up"); });
      expect(code).toBe(1); expect(out).toContain("FAIL  Key OpenRouter: OPENROUTER_API_KEY could not be checked: socket hang up");
      expect(out).toContain("skip  Screen reader");
    });
    it("fails a profile whose key is missing instead of calling it ok, and asks the provider nothing", async () => {
      const { code, out, checkModel } = await doctor(async () => inspected("ready"));
      expect(code).toBe(1);
      expect(out).toContain("FAIL  Profile Default: cannot run: it plans with OpenRouter · vendor/model-name:free, but the key RAWSTEP_OPENROUTER_API_KEY or OPENROUTER_API_KEY is not set");
      expect(out).toContain("FAIL  Key OpenRouter: RAWSTEP_OPENROUTER_API_KEY is missing. Add RAWSTEP_OPENROUTER_API_KEY=... to .env.local or export it (OPENROUTER_API_KEY also works)");
      expect(checkModel).not.toHaveBeenCalled();
    });
  });
  it("checks every registered task file on its own: a broken task is a FAIL line and the other checks still run", async () => {
    const directory = await project(config => { config.tasks.push({ id: "ghost", name: "Ghost", file: "ghost.json" }, { id: "bad", name: "Bad", file: "bad.json" }, { id: "partial", name: "Partial", file: "partial.json" }, { id: "fine", name: "Fine", file: "fine.json" }); });
    await writeFile(join(directory, "bad.json"), "{nope"); await writeFile(join(directory, "partial.json"), JSON.stringify({ goal: "No start page" }));
    await writeFile(join(directory, "fine.json"), JSON.stringify({ url: "https://example.com", goal: "Pay", verify: { all: [{ textVisible: "Done" }] } }));
    const io = output(directory);
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => {} })).toBe(1);
    const out = text(io.stdout);
    expect(out).toContain("FAIL  Task ghost: Task file ghost.json was not found.");
    expect(out).toMatch(/FAIL  Task bad: Task file bad.json is not valid JSON/); expect(out).toMatch(/FAIL  Task partial: /);
    expect(out).toContain("ok    Task fine: fine.json is a valid task");
    expect(out).toContain("ok    Config"); expect(out).toContain("warn  Profile Default"); expect(out).toContain("ok    Browser"); expect(out).toContain("skip  Screen reader");
    // Only the broken task cannot be used.
    const run = output(directory);
    expect(await runCli(["run", "ghost"], run)).toBe(1); expect(text(run.stderr)).toContain("Task file ghost.json was not found.");
  });
  it("says whether a coding-agent CLI is missing, did not answer, or needs a sign-in, in terms of the agent's own CLI", async () => {
    const directory = await project(config => { config.connections.push({ id: "ag", name: "Antigravity", provider: "antigravity", timeoutMs: 1000 }, { id: "cc", name: "Claude Code", provider: "claudeCode", timeoutMs: 1000 }); });
    const io = output(directory);
    const checkAgent = async (connection: { provider: string }) => {
      if (connection.provider === "antigravity") throw new ProjectError("agent-missing", "agy_acp_server.par was not found on PATH. The agy CLI alone is not enough: Antigravity needs its ACP server binary agy_acp_server.par (from the ACP registry) on PATH.", 502);
      throw new ProjectError("agent-signed-out", "Claude Code needs a sign-in. Run `claude` once and sign in there (`/login`).", 502);
    };
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => {}, checkAgent })).toBe(1);
    const out = text(io.stdout);
    expect(out).toContain("FAIL  Antigravity: agy_acp_server.par was not found on PATH. The agy CLI alone is not enough");
    expect(out).toContain("FAIL  Claude Code: Claude Code needs a sign-in. Run `claude` once and sign in there");
    expect(out).not.toContain("dashboard connection check");
  });
  it("says which tasks need a Chrome you started yourself, ends a browser failure with exactly one period, and explains an invalid machine setting", async () => {
    const connecting = async (endpoint: string) => {
      const directory = await project(config => { config.machine.browserEndpoint = endpoint; config.tasks.push({ id: "shop", name: "Shop", file: "shop.json" }); });
      await writeFile(join(directory, "shop.json"), JSON.stringify({ url: "https://shop.example/", goal: "Buy", verify: { all: [{ urlIncludes: "done" }] }, browser: { mode: "connect", copySignIn: true } }));
      return directory;
    };
    const connected = output(await connecting("http://localhost:9222"));
    expect(await runCli(["doctor"], { ...connected, launchBrowser: async () => {} })).toBe(0);
    expect(text(connected.stdout)).toContain("ok    Browser for tasks: Shop runs in the Chrome you started (http://localhost:9222)");
    const missing = output(await connecting(""));
    expect(await runCli(["doctor"], { ...missing, launchBrowser: async () => {} })).toBe(1);
    expect(text(missing.stdout)).toContain("FAIL  Browser for tasks: Shop needs a Chrome you started yourself, but machine.browserEndpoint is empty");
    const failing = output(await project());
    expect(await runCli(["doctor"], { ...failing, launchBrowser: async () => { throw new Error("no chromium."); } })).toBe(1);
    expect(text(failing.stdout)).toMatch(/Browser: no chromium\. Install one/); expect(text(failing.stdout)).not.toContain("..");
    const old = output(await project(config => { (config.machine as Record<string, unknown>).personCheck = true; }));
    expect(await runCli(["doctor"], { ...old, launchBrowser: async () => {} })).toBe(1);
    expect(text(old.stdout)).toContain('rawstep.config.json · machine.personCheck: unknown field "personCheck"');
    const proxy = output(await project(config => { config.machine.proxyServer = "ftp://localhost:8080"; }));
    expect(await runCli(["doctor"], { ...proxy, launchBrowser: async () => {} })).toBe(1);
    expect(text(proxy.stdout)).toContain("machine.proxyServer: proxyServer must be a credential-free HTTP(S) or SOCKS URL");
  });
  it("probes the endpoint of each native screen reader environment once, with the machine's address or the usual one", async () => {
    const directory = await project(config => {
      const base = config.profiles[0]!;
      config.profiles.push({ ...base, id: "vo", name: "VoiceOver", screenReader: "voiceover" }, { ...base, id: "vo2", name: "VoiceOver again", screenReader: "voiceover" }, { ...base, id: "nvda", name: "NVDA", screenReader: "nvda" });
      config.machine.atEndpoints.voiceover = "ws://127.0.0.1:9333";
    });
    const io = output(directory), checkNativeBackend = vi.fn(async () => ({}));
    expect(await runCli(["doctor"], { ...io, launchBrowser: async () => {}, checkNativeBackend })).toBe(0);
    expect(checkNativeBackend).toHaveBeenCalledTimes(2);
    expect(checkNativeBackend).toHaveBeenCalledWith({ profile: "voiceover", url: "ws://127.0.0.1:9333" });
    expect(checkNativeBackend).toHaveBeenCalledWith({ profile: "nvda", url: "ws://localhost:3031/session" });
    expect(text(io.stdout)).toContain("ok    Screen reader: voiceover AT Driver answered");
    expect(text(io.stdout)).toContain("ok    Screen reader: nvda AT Driver answered");
    const failing = output(directory);
    expect(await runCli(["doctor"], { ...failing, launchBrowser: async () => {}, checkNativeBackend: async () => { throw new Error("ECONNREFUSED"); } })).toBe(1);
    expect(text(failing.stdout)).toContain("FAIL  Screen reader: voiceover AT Driver at ws://127.0.0.1:9333: ECONNREFUSED");
  });
});

describe("doctor Node check", () => {
  it("needs 22.12 or later, comparing the minor version too", () => {
    expect(nodeSupported("22.11.0")).toBe(false);
    expect(nodeSupported("22.0.0")).toBe(false);
    expect(nodeSupported("21.99.0")).toBe(false);
    expect(nodeSupported("22.12.0")).toBe(true);
    expect(nodeSupported("24.19.0")).toBe(true);
  });
});
