export type Command = 'init' | 'ui' | 'run' | 'hints' | 'report' | 'analyze' | 'doctor';
export type CliArguments = {
  command: Command;
  positionals: string[];
  options: Record<string, string | boolean>;
};

export class CliUsageError extends Error {
  override name = 'CliUsageError';
}

const optionsByCommand: Record<Command, readonly string[]> = {
  init: ['project'],
  ui: ['port', 'project'],
  run: ['project', 'agent', 'environment', 'mode', 'repeat', 'out', 'json'],
  hints: ['reference'],
  report: ['analysis', 'out'],
  analyze: ['project', 'llm', 'out'],
  doctor: ['project'],
};
const booleanOptions = new Set(['json', 'llm']);
const positionalsByCommand: Record<Command, { count: number; noun: string }> = {
  init: { count: 0, noun: '' }, ui: { count: 0, noun: '' }, doctor: { count: 0, noun: '' },
  run: { count: 1, noun: 'task id or task JSON file' },
  hints: { count: 1, noun: 'run directory' }, report: { count: 1, noun: 'run directory' }, analyze: { count: 1, noun: 'run directory' },
};

export function parseCliArguments(argv: readonly string[]): CliArguments {
  const [name, ...args] = argv;
  if (!name || !Object.hasOwn(optionsByCommand, name)) {
    throw new CliUsageError(`Unknown command: ${name ?? '(none)'}. Use rawstep --help.`);
  }
  const command = name as Command;
  const result: CliArguments = { command, positionals: [], options: {} };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]!;
    if (!token.startsWith('--')) {
      if (token.startsWith('-')) throw new CliUsageError(`Unknown option: ${token}`);
      result.positionals.push(token);
      continue;
    }
    const equalIndex = token.indexOf('=');
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
    if (!value || value.startsWith('--')) throw new CliUsageError(`Option --${option} requires a value.`);
    result.options[option] = value;
  }
  const { count, noun } = positionalsByCommand[command];
  if (result.positionals.length !== count) {
    throw new CliUsageError(count === 0 ? `${command} does not accept positional arguments.` : `${command} requires exactly one ${noun}.`);
  }
  if (command === 'ui' && result.options.port !== undefined && (!/^[0-9]+$/.test(String(result.options.port)) || Number(result.options.port) < 1 || Number(result.options.port) > 65535)) throw new CliUsageError('--port must be an integer from 1 to 65535.');
  if (command === 'run') {
    if (result.options.mode !== undefined && !['keyboard', 'screenreader'].includes(String(result.options.mode))) throw new CliUsageError('--mode must be keyboard or screenreader.');
    if (result.options.repeat !== undefined && (!/^[0-9]+$/.test(String(result.options.repeat)) || Number(result.options.repeat) < 1 || Number(result.options.repeat) > 100)) throw new CliUsageError('--repeat must be an integer from 1 to 100.');
  }
  return result;
}

export const CLI_USAGE = `Rawstep: run a keyboard or screen reader task on a web page and see where the run got slow or took detours

Usage:
  rawstep init [--project <dir>]
  rawstep ui [--port <port>] [--project <dir>]
  rawstep run <task> [--agent <id|name>] [--environment <id|name>] [--mode keyboard|screenreader]
                     [--repeat <n>] [--out <dir>] [--json] [--project <dir>]
  rawstep hints <run-dir> [--reference <run-dir>]
  rawstep report <run-dir> [--analysis <analysis.json>] [--out <dir>]
  rawstep analyze <run-dir> [--llm] [--out <dir>] [--project <dir>]
  rawstep doctor [--project <dir>]

Commands:
  init      Write a default rawstep.config.json. An existing file is never overwritten.
  ui        Open the dashboard to set up connections, agents, environments and tasks, and to run experiments.
  run       Run a task from rawstep.config.json (by id) or a task JSON file with an agent in an environment,
            then print each run's outcome and the findings gathered across the runs, grouped as Page and Model.
            When the project has an analysis model, each run is also analysed by that LLM.
  hints     List the places worth a look in a saved run (hints.json is written next to the trace).
  report    Write report.html and report.json for a saved run.
  analyze   Analyze a saved run. Without --llm the analysis is a local summary; --llm sends the saved
            events (PNG bytes omitted) to the project's analysis model.
  doctor    Check that a browser can launch, the config parses, credentials are set and, for a native
            screen reader, that its AT Driver endpoint answers.

Configuration:
  Everything lives in rawstep.config.json in the project directory: connections (where models are
  reached), agents (planner, executor per mode, actions and limits), environments (page conditions),
  tasks, the analysis model and machine settings. The dashboard and the CLI read the same file. Commit it with your project.
  API keys are never in that file: it names environment variables, and their values go in .env.local
  (do not commit it) or the process environment.

Run defaults:
  --agent        the task's agent, otherwise the first agent
  --environment  the task's environment, otherwise the first environment
  --mode     keyboard
  --repeat   1; repeats are compared with the fastest run that reached the goal
  --out      <project>/.rawstep/runs/<timestamp>-<id>/, one run-<n> directory per repeat

Exit codes: 0 when the runs completed, whether or not the goal was reached; 1 on errors; 2 on bad usage;
130 or 143 when cancelled by SIGINT or SIGTERM. Rawstep reports friction hints, not pass or fail.

Screenshots can expose private page contents; the model receives pixels, the goal, named input keys and the
action history, never the DOM or verifier results. Saved traces redact input values.
`;
