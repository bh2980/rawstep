import { isLoopbackHostname } from '@rawstep/core/defaults';
import { BUILTIN_PROFILES, resolveEnvironmentProfile } from '@rawstep/browser/profiles';
import { runEnvironmentMatrix } from '../matrix/index.js';
import { SCREENSHOT_KEYS } from '@rawstep/core/screenshot';
import { assertSystemOneInputs, SystemOneSpeechPolicy, SystemOneScreenshotAdapter, modelBaseURL, type SystemOneClient } from '@rawstep/policies/systemone';
import { LlmTraceAnalyzer } from '@rawstep/reports/analyze/llm';
import { loadCliEnvironment, decisionConfig, createDecisionClient, analysisConfig, type CliEnvironment, type DecisionConfig } from './config.js';
import { OrcaBackend, orcaBridgePath } from '@rawstep/screenreaders/orca';
import { pathToFileURL } from 'node:url';
import type { BrowserSession, CreateBrowserSessionOptions } from '@rawstep/browser/browser';
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AtDriverBackend } from "@rawstep/screenreaders/at-driver";
import { resolveTask, type Backend, type Decision, type DecisionPolicy, type Task } from "@rawstep/core/contracts";
import { loadPolicy, ScriptedPolicy } from "@rawstep/policies/policy";
import { runTask } from "@rawstep/browser/runner";
import { runScreenshotTask } from "@rawstep/browser/screenshot";
import { ScreenshotDecisionPolicy, HttpScreenshotModel } from "@rawstep/policies";
import { MockVoiceOverBackend, runMockVoiceOverTask } from "@rawstep/screenreaders/mock-voiceover";
import { hydrateScreenshots, readTrace, type RunTrace } from "@rawstep/core/trace";
import { analyzeSavedTrace, loadAnalyzer, readAnalysis } from "@rawstep/reports/analyze";
import { writeReport } from "@rawstep/reports/report";
import { writeHints } from "@rawstep/reports/hints";
import { HINTS_SCHEMA_VERSION, type HintReport } from "@rawstep/reports/hints";
import { CLI_USAGE, CliUsageError, parseCliArguments, type CliArguments } from "./args.js";

export { CLI_USAGE, CliUsageError, parseCliArguments } from "./args.js";

/** Injectable boundaries let CLI checks run without a native screen reader or any model. */
export interface CliDependencies {
  startDashboard?: (options: { projectDir: string; port: number }) => Promise<{ url: string; close(): Promise<void> }>;
  env?: CliEnvironment;
  createDecisionClient?: (config: DecisionConfig) => SystemOneClient;
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  createBackend?: (options: ConstructorParameters<typeof AtDriverBackend>[0]) => Backend;
  runTask?: typeof runTask;
  runScreenshotTask?: typeof runScreenshotTask;
  runMockVoiceOverTask?: typeof runMockVoiceOverTask;
  loadPolicy?: typeof loadPolicy;
  readTrace?: typeof readTrace;
  analyzeSavedTrace?: typeof analyzeSavedTrace;
  loadAnalyzer?: typeof loadAnalyzer;
  writeReport?: typeof writeReport;
  writeHints?: typeof writeHints;
  /** Defaults to process; injectable so embedders can scope cancellation. */
  signals?: {
    on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
    off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  };
}

type CliStage = "arguments" | "task-loading" | "policy-loading" | "execution" | "analysis" | "hints" | "report" | "doctor";

export async function runCli(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((text) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text) => process.stderr.write(text));
  const cwd = dependencies.cwd ?? process.cwd();
  let stage: CliStage = "arguments";
  try {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      stdout(CLI_USAGE);
      return 0;
    }
    if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
      const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
      stdout(`${manifest.version}\n`);
      return 0;
    }
    const args = parseCliArguments(argv);
    if (args.command === 'ui') {
      const startDashboard = dependencies.startDashboard ?? (await import('@rawstep/dashboard').catch((error: unknown) => {
        if ((error as { code?: unknown } | null)?.code === 'ERR_MODULE_NOT_FOUND' && String((error as { message?: unknown }).message).includes('@rawstep/dashboard')) throw new CliUsageError('rawstep ui needs the optional @rawstep/dashboard package. Install it next to rawstep to use the dashboard.');
        throw error;
      })).startDashboard;
      const app = await startDashboard({ projectDir: resolve(cwd, String(args.options.project ?? '.')), port: Number(args.options.port ?? 4318) });
      stdout('Rawstep dashboard: ' + app.url + '\n');
      const signals = dependencies.signals ?? process;
      await new Promise<void>((accept, reject) => {
        const stop = () => { signals.off('SIGINT', stop); signals.off('SIGTERM', stop); void app.close().then(accept, reject); };
        signals.on('SIGINT', stop); signals.on('SIGTERM', stop);
      });
      return 0;
    }
    if (args.command === 'profiles') { stdout(JSON.stringify(Object.keys(BUILTIN_PROFILES).map(resolveEnvironmentProfile), null, 2) + '\n'); return 0; }
    if (args.command === 'matrix') {
      stage = 'task-loading'; const path = resolve(cwd,args.positionals[0]!); const task = resolveTask(await readJson(path), dirname(path));
      const profiles = args.options['profile-set'] ? await readJson(resolve(cwd,String(args.options['profile-set']))) : String(args.options.profiles).split(',');
      if (!Array.isArray(profiles)) throw new CliUsageError('Profile set must be a JSON array.');
      const humanEvidence = args.options['human-evidence'] ? await readJson(resolve(cwd,String(args.options['human-evidence']))) : [];
      stage = 'execution';
      const report = await withRunSignals(dependencies.signals ?? process, stderr, signal => runEnvironmentMatrix(task, {
        outDir: resolve(cwd,String(args.options.out)), profiles: profiles.map(resolveEnvironmentProfile), mode: args.options.mode === 'mock' ? 'mock' : 'screenshot', humanEvidence, signal,
        ...(args.options['diagnose-stop']?{stopReasonModel:new HttpScreenshotModel({endpoint:String(args.options['stop-reason-endpoint']??args.options['model-endpoint']),allowRemote:Boolean(args.options['allow-remote-model'])})}:{}),
        headless: !Boolean(args.options.headed), browserExecutablePath: args.options['browser-executable'] ? resolve(cwd,String(args.options['browser-executable'])) : undefined,
        proxyServer: args.options['proxy-server'] ? String(args.options['proxy-server']) : undefined,
        createPolicy: async (_profile, { signal }) => {
          const selected = await selectPolicy(args, cwd, dependencies, args.options.mode !== 'mock', true);
          await prepareDecision(selected.client, task, args.options.mode !== 'mock', signal);
          return selected.policy;
        }
      }));
      stdout(`Matrix ${report.id}: ${report.status}\nReport: ${resolve(cwd,String(args.options.out),'matrix.html')}\n`); return report.status === 'aborted' ? (report.cancellationSignal==='SIGTERM'?143:130) : report.rows.every(row=>row.classification==='task-completed' && row.analysisStatus !== 'failed' && row.reportStatus !== 'failed') ? 0 : 1;
    }
    const getBackend = dependencies.createBackend ?? ((options) => new AtDriverBackend(options));
    if (args.command === "doctor") {
      stage = "doctor";
      return await doctor(args, getBackend, stdout, stderr);
    }
    const inputPath = resolve(cwd, args.positionals[0]!);
    if (args.command === "run" || args.command === "mock-run" || args.command === "screenshot-run") {
      stage = "task-loading";
      const rawTask = await readJson(inputPath);
      if (args.command !== "screenshot-run" && isObject(rawTask) && rawTask.mode === "keyboard") {
        throw new CliUsageError("For keyboard screenshots use rawstep screenshot-run. Native AT tasks require --backend voiceover or nvda.");
      }
      const profile = args.options.profile ? resolveEnvironmentProfile(Object.hasOwn(BUILTIN_PROFILES,String(args.options.profile)) ? String(args.options.profile) : await readJson(resolve(cwd,String(args.options.profile)))) : undefined;
      const task = resolveTask({ ...(rawTask as object), ...(profile ? { profile } : {}) }, dirname(inputPath));
      stage = "policy-loading";
      const { policy, client } = await selectPolicy(args, cwd, dependencies, args.command === 'screenshot-run');
      const outDir = args.options.out
        ? resolve(cwd, String(args.options.out))
        : resolve(cwd, ".rawstep", new Date().toISOString().replace(/[:.]/g, "-"));
      stage = "execution";
      const executionDeadline=Date.now()+task.timeoutMs!;
      let pairedSession: BrowserSession | undefined;
      let pairedSessionHandedOff = false;
      let nativeBackend: Backend | undefined;
      let backendHandedOff = false;
      let trace: RunTrace;
      try { trace = await withRunSignals(dependencies.signals ?? process, stderr, async (signal) => {
      if (args.command === 'run') nativeBackend = args.options.backend === 'orca' ? makeOrcaBackend(args, cwd) : getBackend({ url: String(args.options.endpoint), profile: args.options.backend as 'voiceover' | 'nvda' });
      await prepareDecision(client, task, args.command === 'screenshot-run', AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, executionDeadline - Date.now()))]), nativeBackend);
      if (args.options.backend === 'orca') {
        pairedSession = await awaitPairedBrowser(async () => {
          const module = await import(pathToFileURL(resolveModule(String(args.options['browser-factory']),cwd)).href);
          signal.throwIfAborted();
          if (typeof module.default !== 'function') throw new CliUsageError('Browser factory module must default-export a paired browser-session factory.');
          return module.default(task.url, { headless:false, proxyServer:args.options['proxy-server'] ? String(args.options['proxy-server']) : undefined, profile:task.profile, navigation:task.navigation, verify:task.verify, signal });
        }, signal, Math.max(1,executionDeadline-Date.now()));
        if (pairedSession?.nativeTargetWindowId !== Number(args.options['orca-target-window'])) { await pairedSession?.close(); throw new CliUsageError('Paired browser factory must attest the exact nativeTargetWindowId it owns.'); }
      }
      const remainingTask={...task,timeoutMs:Math.max(1,executionDeadline-Date.now())};
      if(signal.aborted || Date.now()>=executionDeadline) throw new Error('Run setup exhausted the task budget.');
      return args.command === "screenshot-run"
        ? await (dependencies.runScreenshotTask ?? runScreenshotTask)(remainingTask, {
          ...(args.options['diagnose-stop']?{stopReasonModel:new HttpScreenshotModel({endpoint:String(args.options['stop-reason-endpoint']??args.options['model-endpoint']),allowRemote:Boolean(args.options['allow-remote-model'])}),warn:message=>stderr(message+'\n')}:{}),
          policy, outDir, signal, headless: !Boolean(args.options.headed),
          browserExecutablePath: args.options["browser-executable"] ? resolve(cwd, String(args.options["browser-executable"])) : undefined,
        proxyServer: args.options['proxy-server'] ? String(args.options['proxy-server']) : undefined,
          diagnosticScreenshots: Boolean(args.options["diagnostic-screenshots"])
        })
        : args.command === "mock-run"
        ? await (dependencies.runMockVoiceOverTask ?? runMockVoiceOverTask)(remainingTask, {
          policy, outDir, signal, headless: !Boolean(args.options.headed),
          browserExecutablePath: args.options["browser-executable"] ? resolve(cwd, String(args.options["browser-executable"])) : undefined,
        proxyServer: args.options['proxy-server'] ? String(args.options['proxy-server']) : undefined,
          diagnosticScreenshots: Boolean(args.options["diagnostic-screenshots"]),
          warn: message => stderr(`[simulation] ${message}\n`)
        })
        : await (dependencies.runTask ?? runTask)(remainingTask, {
        backend: (backendHandedOff = true, nativeBackend!),
        ...(pairedSession ? { browserSessionFactory: async () => { pairedSessionHandedOff = true; return pairedSession!; } } : {}),
        policy,
        outDir,
        signal,
        headless: false,
        browserExecutablePath: args.options["browser-executable"] ? resolve(cwd, String(args.options["browser-executable"])) : undefined,
        proxyServer: args.options['proxy-server'] ? String(args.options['proxy-server']) : undefined,
        diagnosticScreenshots: Boolean(args.options["diagnostic-screenshots"]),
      }); }); } finally { if (pairedSession && !pairedSessionHandedOff) await pairedSession.close(); if (nativeBackend && !backendHandedOff) await nativeBackend.close(); }
      stdout(`Run ${trace.runId}: ${trace.outcome?.status ?? "inconclusive"}\nTrace: ${resolve(outDir, "trace.json")}\n`);
      if (trace.outcome?.status === "success") return 0;
      printRunFailure(trace, outDir, args, stderr);
      const cancellation = isObject(trace.outcome?.cancellation) ? trace.outcome.cancellation : {};
      return cancellation.signal === "SIGINT" ? 130 : cancellation.signal === "SIGTERM" ? 143 : 1;
    }
    if (args.command === "hints") {
      stage = "hints";
      const { path, report } = await (dependencies.writeHints ?? writeHints)(inputPath, args.options.reference ? { reference: resolve(cwd, String(args.options.reference)) } : {});
      stdout(`Hints: ${report.hints.length} · goal reached: ${report.goalReached ? "yes" : "no"} · steps ${report.steps}${report.reference ? ` · reference ${report.reference.steps} steps` : ""}\n`
        + report.hints.map(hint => `step ${hint.steps.join(",")} · ${hint.kind} · ${hint.certainty} · ${hint.summary}\n`).join("") + `Wrote ${path}\n`);
      return 0;
    }
    stage = args.command === "analyze" ? "analysis" : "report";
    const outDir = args.options.out ? resolve(cwd, String(args.options.out)) : await traceDirectory(inputPath);
    if (args.command === "analyze") {
      const analyzer = args.options.analyzer
        ? await (dependencies.loadAnalyzer ?? loadAnalyzer)(resolveModule(String(args.options.analyzer), cwd))
        : args.options.llm ? new LlmTraceAnalyzer(analysisConfig(args, await loadCliEnvironment(cwd, dependencies.env))) : undefined;
      const analysis = await (dependencies.analyzeSavedTrace ?? analyzeSavedTrace)(inputPath, { analyzer, outDir });
      stdout(`Analysis: ${analysis.status}\nSaved: ${resolve(outDir, "analysis.json")}\n`);
      stdout(`Hints saved: ${(await (dependencies.writeHints ?? writeHints)(inputPath)).path}\n`);
      return analysis.status === "completed" ? 0 : 1;
    }
    // Reports may land anywhere, so embed the screenshots that 2.2 traces keep as blobs next to trace.json.
    const trace = await hydrateScreenshots(await (dependencies.readTrace ?? readTrace)(inputPath), await traceDirectory(inputPath));
    const analysis = args.options.analysis
      ? await readAnalysis(resolve(cwd, String(args.options.analysis)), trace)
      : undefined;
    const hints = await readHints(await traceDirectory(inputPath));
    const paths = await (dependencies.writeReport ?? writeReport)(trace, analysis, outDir, hints ? { hints } : {});
    stdout(`Report: ${paths.htmlPath}\nData: ${paths.jsonPath}\n`);
    return 0;
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\nStage: ${stage}\n`);
    stderr(`Recovery: ${preparationRecovery(stage)}\n`);
    return error instanceof CliUsageError ? 2 : 1;
  }
}

async function selectPolicy(args: CliArguments, cwd: string, dependencies: CliDependencies, visual: boolean, fresh = false): Promise<{ policy: DecisionPolicy; client?: SystemOneClient }> {
  if (args.options.policy) return { policy: await (dependencies.loadPolicy ?? loadPolicy)(resolveModule(String(args.options.policy), cwd), { fresh }) };
  if (args.options.script) return { policy: new ScriptedPolicy(await readDecisions(resolve(cwd, String(args.options.script)))) };
  if (args.options.decision) {
    const config = decisionConfig(args, await loadCliEnvironment(cwd, dependencies.env));
    const base = modelBaseURL(config.baseURL);
    const client = (dependencies.createDecisionClient ?? createDecisionClient)(config);
    const modelGiveUp = !args.options['no-model-give-up'];
    const policy = visual ? new ScreenshotDecisionPolicy({ model: new SystemOneScreenshotAdapter(client), repetitionGuard: Boolean(args.options['repetition-guard']), modelGiveUp }) : new SystemOneSpeechPolicy(client, undefined, undefined, { modelGiveUp });
    if (visual && !isLoopbackHostname(base.hostname) && !args.options['allow-remote-model']) throw new CliUsageError('Remote screenshot transmission requires --allow-remote-model.');
    (dependencies.stderr ?? (text => process.stderr.write(text)))('[privacy] SystemOne receives the goal and live speech/images, which may contain displayed or spoken input values. Saved trace redaction does not anonymize live requests.\n');
    return { client, policy };
  }
  return { policy: new ScreenshotDecisionPolicy({ model: new HttpScreenshotModel({ endpoint: String(args.options['model-endpoint']), allowRemote: Boolean(args.options['allow-remote-model']) }), repetitionGuard: !args.options['no-repetition-guard'], modelGiveUp: !args.options['no-model-give-up'] }) };
}
async function prepareDecision(client: SystemOneClient | undefined, task: Task, visual: boolean, signal: AbortSignal, backend?: Backend): Promise<void> {
  if (!client) return;
  // CLI nonvisual runs without a supplied native backend use the mock runner.
  // Resolve its real candidate count before that runner can launch a browser.
  const capabilities = !visual ? (backend ?? new MockVoiceOverBackend()).capabilities : undefined;
  const inputCount = Object.keys(task.input ?? {}).length;
  const count = visual ? SCREENSHOT_KEYS.length + inputCount * 2 + 3 : capabilities!.keys.length + capabilities!.intents.length +
    (capabilities!.textEntry ? inputCount * (capabilities!.replaceText ? 2 : 1) : 0) + 3;
  assertSystemOneInputs(client, visual ? ['text', 'image'] : ['text'], count, visual ? 2 : 0);
  await client.prepare?.({ signal }); signal.throwIfAborted();
}

function preparationRecovery(stage: CliStage): string {
  switch (stage) {
    case "arguments": return "Check the command and flags with npx rawstep --help.";
    case "task-loading": return "Check that the task file exists, is readable, and contains valid task JSON. Resolve fixture paths relative to the task file. See npx rawstep --help.";
    case "policy-loading": return "Check the --policy module path and its decide() export, or the --script path and decision JSON. See npx rawstep --help.";
    case "execution": return "Check the error, backend setup, and output-directory permissions. Retry with a fresh --out directory. Execution did not return a saved outcome; inspect the output directory before analyzing a trace.";
    case "analysis": return "Check the saved trace path, the selected analyzer module, and output-directory permissions. See npx rawstep --help.";
    case "hints": return "Check that the saved trace path (and --reference path) exist and are valid traces, and that the trace directory is writable. See npx rawstep --help.";
    case "report": return "Check the saved trace path, any --analysis file belongs to that run, and output-directory permissions. See npx rawstep --help.";
    case "doctor": return "Check the backend and WebSocket endpoint, then rerun doctor. Inspect the server log if the connection still fails.";
  }
}

async function doctor(
  args: CliArguments,
  createBackend: NonNullable<CliDependencies["createBackend"]>,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): Promise<number> {
  if (args.options.backend === 'orca') {
    const backend = makeOrcaBackend(args, process.cwd());
    stdout('Orca native speech bridge probe. Requires Linux graphical session, D-Bus/AT-SPI, Speech Dispatcher and exact target window.\n');
    try { stdout(`Handshake: ${JSON.stringify(await backend.start())}\nThis handshake is not proof of usable captured speech.\n`); return 0; }
    catch (error) { stderr(`Orca unavailable: ${errorDetails(error)}\nNo native speech was validated.\n`); return 1; }
    finally { await backend.close(); }
  }
  const profile = args.options.backend as "voiceover" | "nvda";
  stdout(`Node: ${process.version} (requires >=22)\nBackend: ${profile}\n`);
  if (profile === "voiceover") {
    stdout("Native prerequisites: macOS 13+, VoiceOver with the Bocoup Automation Voice selected, a visible browser, and the macOS AT Driver server with its required Accessibility/Automation permissions.\n");
  } else {
    stdout("Native prerequisites: Windows, NVDA with the AT automation add-on and Capture Speech synthesizer, a visible browser, and the companion Go server running.\n");
  }
  stdout("Doctor may probe another host. Actual default runs require the native browser and server on this host, a loopback endpoint, and a visible browser. This command does not install software or grant OS permissions.\n");
  if (!args.options.endpoint) {
    stdout("Connection: not checked. Add --endpoint <ws://...> to test an existing AT Driver server. Native readiness is unverified.\n");
    return 0;
  }
  const backend = createBackend({ url: String(args.options.endpoint), profile });
  let failed = false;
  try {
    const metadata = await backend.start();
    stdout(`AT Driver protocol session: connected\nMetadata: ${JSON.stringify(metadata)}\n`);
    stdout("This verifies the protocol connection only. Verify real spoken output on the target native host before relying on runs.\n");
    return 0;
  } catch (error) {
    failed = true;
    stderr(`Connection: failed\nCause: ${errorDetails(error)}\n`);
    stderr("Recovery: start the native AT Driver server, confirm its WebSocket host, port and path, then rerun this doctor command. For a protocol or session error, inspect the server log and the screen reader/add-on configuration.\n");
    return 1;
  } finally {
    try { await backend.close(); }
    catch (error) {
      if (!failed) throw error;
      stderr(`Cleanup warning: ${errorDetails(error)}\n`);
    }
  }
}

async function withRunSignals<T>(
  signals: NonNullable<CliDependencies["signals"]>,
  stderr: (text: string) => void,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const cancel = (signal: "SIGINT" | "SIGTERM") => () => {
    if (controller.signal.aborted) return;
    controller.abort(signal);
    stderr(`Received ${signal}; stopping active work, preserving its trace, and closing owned resources.\n`);
  };
  const interrupt = cancel("SIGINT");
  const terminate = cancel("SIGTERM");
  signals.on("SIGINT", interrupt);
  signals.on("SIGTERM", terminate);
  try { return await operation(controller.signal); }
  finally {
    signals.off("SIGINT", interrupt);
    signals.off("SIGTERM", terminate);
  }
}

function printRunFailure(trace: RunTrace, outDir: string, args: CliArguments, stderr: (text: string) => void): void {
  const outcome = trace.outcome;
  stderr(`Reason: ${outcome?.reason ?? "No completion reason recorded"}\n`);
  if (outcome?.policyStopSource === "model" || outcome?.policyStopSource === "exploration-guard") stderr(`Stop source: ${outcome.policyStopSource}\n`);
  const stage = typeof outcome?.stage === "string" ? outcome.stage : "not recorded";
  const step = typeof outcome?.step === "number" ? ` (step ${outcome.step})` : "";
  stderr(`Stage: ${stage}${step}\n`);
  if (typeof outcome?.error === "string") stderr(`Detail: ${outcome.error}\n`);
  const cancellation = isObject(outcome?.cancellation) ? outcome.cancellation : undefined;
  if (typeof cancellation?.signal === "string") stderr(`Cancellation: ${cancellation.signal}\n`);
  stderr(`Inspect saved evidence:\n  npx rawstep report ${shellArgument(outDir)}\n  npx rawstep analyze ${shellArgument(outDir)}\n`);
  if (args.command === "run") {
    stderr(`Check the AT connection:\n  npx rawstep doctor --backend ${shellArgument(String(args.options.backend))} --endpoint ${shellArgument(String(args.options.endpoint))}\n`);
  }
  stderr("Retry with a fresh --out directory after addressing the recorded cause.\n");
}

function shellArgument(value: string): string {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) return value;
  return process.platform === "win32" ? `"${value.replace(/"/g, '\\"')}"` : `'${value.replace(/'/g, "'\\''")}'`;
}

function errorDetails(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && !seen.has(current) && messages.length < 5) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    const code = isObject(current) && typeof current.code === "string" ? current.code : undefined;
    const detail = code && !message.includes(code) ? `${message} (${code})` : message;
    if (!messages.includes(detail)) messages.push(detail);
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.join("; caused by: ");
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new CliUsageError(`Cannot read JSON from ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readDecisions(path: string): Promise<Decision[]> {
  const data = await readJson(path);
  if (!Array.isArray(data)) throw new CliUsageError("A decision script must contain a JSON array of policy decisions.");
  for (const [index, decision] of data.entries()) {
    if (!isObject(decision) || (decision.rationale !== undefined && typeof decision.rationale !== "string")) {
      throw new CliUsageError(`Invalid decision at script index ${index}.`);
    }
    const stop = decision.stop === "success" || decision.stop === "stuck" || decision.stop === "uncertain";
    const action = decision.action;
    const actionField = isObject(action) ? ({ intent: "intent", key: "key", typeText: "input", replaceText: "input" } as Record<string, string>)[String(action.kind)] : undefined;
    const validAction = isObject(action) && actionField && typeof action[actionField] === "string" && Boolean(String(action[actionField]).trim());
    if (stop ? action !== undefined : decision.stop !== undefined || !validAction) {
      throw new CliUsageError(`Invalid decision at script index ${index}: expected one action or a success/stuck stop.`);
    }
  }
  return data as Decision[];
}

/** A hints.json next to the trace is optional report input; absent or unreadable means no hints section. */
async function readHints(directory: string): Promise<HintReport | undefined> {
  try { const value: unknown = JSON.parse(await readFile(resolve(directory, "hints.json"), "utf8")); return isObject(value) && value.schemaVersion === HINTS_SCHEMA_VERSION && Array.isArray(value.hints) ? value as HintReport : undefined; }
  catch { return undefined; }
}

async function traceDirectory(path: string): Promise<string> {
  return (await stat(path)).isDirectory() ? path : dirname(path);
}

function resolveModule(modulePath: string, cwd: string): string {
  return modulePath.startsWith("file:") ? fileURLToPath(modulePath) : resolve(cwd, modulePath);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function makeOrcaBackend(args: CliArguments, cwd: string): OrcaBackend {
  const python = args.options['orca-python'] ? String(args.options['orca-python']) : 'python3';
  return new OrcaBackend({ ...(args.options['orca-bridge'] || args.options['orca-python'] ? {bridgeCommand:[python,args.options['orca-bridge'] ? resolve(cwd,String(args.options['orca-bridge'])) : orcaBridgePath()] as const} : {}), ...(args.options['orca-target-window'] ? {targetWindowId:Number(args.options['orca-target-window'])} : {}) });
}

async function awaitPairedBrowser(work:()=>Promise<BrowserSession>, external:AbortSignal, timeoutMs:number):Promise<BrowserSession>{
  const signal=AbortSignal.any([external,AbortSignal.timeout(timeoutMs)]);signal.throwIfAborted();
  return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve().then(work).then(session=>{signal.removeEventListener('abort',abort);if(signal.aborted){void session.close().catch(()=>{});reject(signal.reason)}else resolve(session)},error=>{signal.removeEventListener('abort',abort);reject(error)});});
}
