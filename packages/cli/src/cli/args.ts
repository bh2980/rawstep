export type Command = "ui" | "profiles" | "matrix" | "run" | "mock-run" | "screenshot-run" | "analyze" | "hints" | "report" | "doctor";
export type CliArguments = {
  command: Command;
  positionals: string[];
  options: Record<string, string | boolean>;
};

export class CliUsageError extends Error {
  override name = "CliUsageError";
}

const decisionOptions = ['decision', 'decision-provider', 'decision-base-url', 'decision-model', 'decision-inputs'] as const;
const guardOptions = ['repetition-guard', 'no-repetition-guard', 'no-model-give-up'] as const;
const optionsByCommand: Record<Command, readonly string[]> = {
  ui: ['port', 'project'],
  profiles: [],
  matrix: [...decisionOptions, ...guardOptions, "diagnose-stop", "stop-reason-endpoint", "profiles", "profile-set", "mode", "policy", "script", "model-endpoint", "allow-remote-model", "out", "headed", "browser-executable", "proxy-server", "human-evidence"],
  run: [...decisionOptions, 'no-model-give-up', "profile", "browser-factory", "orca-target-window", "orca-python", "orca-bridge", "policy", "script", "backend", "endpoint", "out", "diagnostic-screenshots", "browser-executable", "proxy-server"],
  "mock-run": [...decisionOptions, 'no-model-give-up', "profile", "policy", "script", "out", "headed", "diagnostic-screenshots", "browser-executable", "proxy-server"],
  "screenshot-run": [...decisionOptions, ...guardOptions, "script", "diagnose-stop", "stop-reason-endpoint", "profile", "policy", "model-endpoint", "allow-remote-model", "out", "headed", "diagnostic-screenshots", "browser-executable", "proxy-server"],
  analyze: ["analyzer", "llm", "analysis-provider", "analysis-base-url", "analysis-model", "out"],
  hints: ["reference"],
  report: ["analysis", "out"],
  doctor: ["backend", "endpoint", "orca-target-window", "orca-python", "orca-bridge"],
};
const booleanOptions = new Set(["llm", "diagnostic-screenshots", "headed", "allow-remote-model", "diagnose-stop", ...guardOptions]);

export function parseCliArguments(argv: readonly string[]): CliArguments {
  const [name, ...args] = argv;
  if (!name || !Object.hasOwn(optionsByCommand, name)) {
    throw new CliUsageError(`Unknown command: ${name ?? "(none)"}. Use rawstep --help.`);
  }
  const command = name as Command;
  const result: CliArguments = { command, positionals: [], options: {} };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]!;
    if (!token.startsWith("--")) {
      if (token.startsWith("-")) throw new CliUsageError(`Unknown option: ${token}`);
      result.positionals.push(token);
      continue;
    }
    const equalIndex = token.indexOf("=");
    const option = token.slice(2, equalIndex < 0 ? undefined : equalIndex);
    if (!optionsByCommand[command].includes(option)) {
      throw new CliUsageError(`Unknown option for ${command}: --${option}`);
    }
    if (Object.hasOwn(result.options, option)) {
      throw new CliUsageError(`Option --${option} may only be provided once.`);
    }
    if (booleanOptions.has(option)) {
      if (equalIndex >= 0) throw new CliUsageError(`--${option} does not take a value.`);
      result.options[option] = true;
      continue;
    }
    const value = equalIndex < 0 ? args[++i] : token.slice(equalIndex + 1);
    if (!value || value.startsWith("--")) throw new CliUsageError(`Option --${option} requires a value.`);
    result.options[option] = value;
  }
  const expectedPositionals = command === "doctor" || command === "profiles" || command === 'ui' ? 0 : 1;
  if (result.positionals.length !== expectedPositionals) {
    throw new CliUsageError(expectedPositionals === 0 ? `${command} does not accept positional arguments.` : `${command} requires exactly one ${(command === "run" || command === "mock-run" || command === "screenshot-run") ? "task JSON file" : "trace file or run directory"}.`);
  }
  if (command === 'ui' && result.options.port && (!/^[0-9]+$/.test(String(result.options.port)) || Number(result.options.port) < 1 || Number(result.options.port) > 65535)) throw new CliUsageError('--port must be an integer from 1 to 65535.');
  if (command === "run" || command === "mock-run") {
    if ([result.options.policy, result.options.script, result.options.decision].filter(Boolean).length !== 1) {
      throw new CliUsageError(`${command} requires exactly one of --policy, --script, or --decision systemone.`);
    }
    if (command === "run") {
      requireOption(result, "backend");
      if (result.options.backend !== "orca") requireOption(result, "endpoint");
      else { requireOption(result, "browser-factory"); requireOption(result, "orca-target-window"); }
    }
  }
  if (command === "screenshot-run") {
    if ([result.options.policy, result.options.script, result.options.decision, result.options['model-endpoint']].filter(Boolean).length !== 1) throw new CliUsageError('screenshot-run requires exactly one of --policy, --script, --decision systemone, or --model-endpoint.');
    if (result.options["allow-remote-model"] && !result.options["model-endpoint"] && !result.options.decision) throw new CliUsageError("--allow-remote-model requires --model-endpoint or --decision systemone.");
  }
  if (command === "doctor") requireOption(result, "backend");
  if (result.options.backend && !["voiceover", "nvda", "orca"].includes(String(result.options.backend))) {
    throw new CliUsageError("--backend must be voiceover, nvda or orca. For simulated VoiceOver use mock-run; for keyboard screenshots use screenshot-run.");
  }
  if (result.options.backend === 'orca' && result.options.endpoint) throw new CliUsageError('Orca uses a local speech bridge, not --endpoint.');
  if (result.options['orca-target-window'] && !/^[1-9][0-9]*$/.test(String(result.options['orca-target-window']))) throw new CliUsageError('--orca-target-window must be a positive decimal X11 window id.');
  if (command === 'matrix') {
    if (Boolean(result.options.profiles) === Boolean(result.options['profile-set'])) throw new CliUsageError('matrix requires --profiles <names> or --profile-set <json>.');
    if (!['screenshot','mock'].includes(String(result.options.mode ?? 'screenshot'))) throw new CliUsageError('CLI matrix --mode must be screenshot or mock; native matrices require explicit paired backend API factories.');
    if ([result.options.policy,result.options.script,result.options.decision,result.options['model-endpoint']].filter(Boolean).length !== 1) throw new CliUsageError('matrix requires exactly one policy, script, SystemOne decision, or model endpoint.');
    if (result.options['model-endpoint'] && result.options.mode === 'mock') throw new CliUsageError('Screenshot model endpoint cannot be used with mock speech.');
    requireOption(result,'out');
  }
  if (result.options.decision && result.options.decision !== 'systemone') throw new CliUsageError('--decision must be systemone.');
  if (decisionOptions.slice(1).some(option => result.options[option]) && !result.options.decision) throw new CliUsageError('Decision configuration flags require --decision systemone.');
  if (result.options['repetition-guard'] && result.options['no-repetition-guard']) throw new CliUsageError('Choose --repetition-guard or --no-repetition-guard, not both.');
  if (guardOptions.some(option => result.options[option]) && !result.options.decision && !result.options['model-endpoint']) throw new CliUsageError('--repetition-guard, --no-repetition-guard and --no-model-give-up require --decision systemone or --model-endpoint.');
  if ((result.options['repetition-guard'] || result.options['no-repetition-guard']) && (command === 'mock-run' || command === 'run' || (command === 'matrix' && result.options.mode === 'mock'))) throw new CliUsageError('--repetition-guard and --no-repetition-guard apply only to screenshot exploration.');
  if (result.options.llm && result.options.analyzer) throw new CliUsageError('Choose --llm or --analyzer, not both.');
  if (['analysis-provider', 'analysis-base-url', 'analysis-model'].some(option => result.options[option]) && !result.options.llm) throw new CliUsageError('Analysis configuration flags require --llm.');
  if (result.options['diagnose-stop'] && !result.options['model-endpoint'] && !result.options['stop-reason-endpoint']) throw new CliUsageError('--diagnose-stop requires a model endpoint for the optional hypothesis call.');
  if (result.options['stop-reason-endpoint'] && !result.options['diagnose-stop']) throw new CliUsageError('--stop-reason-endpoint requires --diagnose-stop.');
  if (result.options.endpoint) validateEndpoint(String(result.options.endpoint));
  return result;
}

function requireOption(args: CliArguments, name: string): void {
  if (!args.options[name]) throw new CliUsageError(`${args.command} requires --${name}.`);
}

export function validateEndpoint(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new CliUsageError("--endpoint must be an absolute ws:// or wss:// URL."); }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new CliUsageError("--endpoint must use ws:// or wss://.");
  }
}

export const CLI_USAGE = `Rawstep: model-neutral screen reader and screenshot task traces

Usage:
  rawstep profiles
  rawstep matrix <task.json> --profiles default,reflow-text,forced-colors --model-endpoint <http://localhost:port/choose> --out <new-dir>
  rawstep ui [--port <port>] [--project <directory>]
  rawstep screenshot-run <task.json> --model-endpoint <http://localhost:port/choose> [--out <dir>] [--headed]
  rawstep screenshot-run <task.json> --policy <module> [--out <dir>] [--headed]
  rawstep run <task.json> --policy <module> --backend voiceover|nvda --endpoint <ws://...> [--out <dir>]
  rawstep run <task.json> --script <decisions.json> --backend voiceover|nvda --endpoint <ws://...> [--out <dir>]
  rawstep mock-run <task.json> --policy <module>|--script <decisions.json> [--out <dir>] [--headed]
  rawstep screenshot-run <task.json> --script <decisions.json> [--out <dir>]
  rawstep screenshot-run <task.json> --decision systemone [--decision-* overrides] [--out <dir>]
  rawstep run <task.json> --decision systemone --backend voiceover|nvda --endpoint <ws://...> [--out <dir>]
  rawstep analyze <trace.json|run-dir> [--analyzer <module>|--llm] [--out <dir>]
  rawstep hints <trace.json|run-dir> [--reference <trace.json|run-dir>]
  rawstep report <trace.json|run-dir> [--analysis <analysis.json>] [--out <dir>]
  rawstep doctor --backend voiceover|nvda [--endpoint <ws://...>]

Run options:
  --diagnose-stop           Optional bounded post-run reason-choice inference, never an action or verdict
  --profile <name|json>      Apply and verify a reproducible browser environment profile
  --diagnostic-screenshots   Save diagnostic images; they are never screen-reader policy observations
  --proxy-server <url>       Explicit credential-free HTTP(S)/SOCKS proxy
  --browser-executable <path> Use an explicitly selected installed Chromium binary
  --allow-remote-model      Explicitly send screenshots and task goal/history to a remote HTTPS model endpoint
  --headed                  Show Chromium for screenshot-run or mock-run (headless by default)
  --repetition-guard        Stop screenshot runs on repeated identical screens (default: on for --model-endpoint, off for --decision systemone)
  --no-repetition-guard     Never stop on repeated screens; visualState is still recorded
  --no-model-give-up        Remove the model's stop:stuck and stop:uncertain choices (stop:success stays)
  --decision systemone      Explicit structured decision model; never a generative fallback
  --decision-provider       vercel-evaluation, systemone-http, or openrouter-systemone
  --decision-base-url       API root ending in /v1; provider determines evaluate or systemone route
  --decision-model          Explicit model identity; never automatically replaced
  --decision-inputs         text or text,image; screenshots require confirmed image support
  --llm                     Explicit post-run text analysis only (analyze command)
  --analysis-provider       openai-compatible
  --analysis-base-url       API root; /chat/completions is appended
  --analysis-model          Explicit analysis model

Policies export a default or named policy object implementing decide().
Scripts contain a JSON array of decisions. No model or API key is required.
Only --decision systemone and analyze --llm load RAWSTEP_DECISION_* or RAWSTEP_ANALYSIS_*.
Precedence: explicit CLI overrides > process env > .env.local > .env. Libraries use injected config.
API keys are environment-only, not CLI flags. Legacy AI_* variables are ignored.
Analyzers run separately against a saved trace. A custom analyzer may send data externally;
review the trace and the module before using it. Default analysis stays local; --llm explicitly opts into network analysis.
AT Driver servers and screen readers must be installed and started separately.
Orca runs require --backend orca --browser-factory <trusted module> --orca-target-window <X11 id>; no endpoint.
The paired factory must create the exact visible Linux browser before the local Orca handshake.
Doctor can check the protocol connection; real VoiceOver/NVDA behavior requires native testing.
mock-run uses a stateful browser-backed VoiceOver approximation with simulated output.
It requires Chromium, not macOS or AT Driver. It does not run Apple VoiceOver or establish native accessibility conformance.
screenshot-run is first-class screenshot-only, keyboard-only exploration with a pluggable decision model.
The /choose adapter remains available; SystemOne uses a separately running compatible service. Scripts are explicitly selected deterministic checks, never automatic fallback.
Screenshots can expose private page contents. The model receives pixels, goal, named input keys and keyboard history, never DOM/AX or verifier results.
hints lists places worth a human look in a saved run (for example excess Tab presses), never a pass/fail verdict; analyze also writes hints.json next to the trace.
LLM analysis sends every saved event with PNG bytes omitted, validates evidence IDs, and never changes runOutcome.
VoiceOver remains unverified until an actual native slice passes; NVDA is experimental pending Windows evidence.
`;
