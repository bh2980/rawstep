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
  run: ['project', 'preset', 'combo', 'actions', 'environment', 'at', 'mode', 'repeat', 'max-replans', 'max-task-actions', 'diagnose-stop', 'out', 'json'],
  hints: ['reference'],
  report: ['analysis', 'out'],
  analyze: ['project', 'llm', 'out'],
  doctor: ['project'],
};
const booleanOptions = new Set(['json', 'llm', 'diagnose-stop']);
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
    for (const [option, min, max] of [['max-replans', 0, 100], ['max-task-actions', 1, 1000]] as const) {
      const value = result.options[option];
      if (value !== undefined && (!/^[0-9]+$/.test(String(value)) || Number(value) < min || Number(value) > max)) throw new CliUsageError(`--${option} must be an integer from ${min} to ${max}.`);
    }
  }
  return result;
}

export const CLI_USAGE = `Rawstep: run a keyboard or screen reader task on a web page and see where the run got slow or took detours

Usage:
  rawstep init [--project <dir>]
  rawstep ui [--port <port>] [--project <dir>]
  rawstep run <task> [--preset <id|name>] [--combo <id|name>] [--actions <id|name>] [--environment <id|name>]
                     [--at <id|name>] [--mode keyboard|screenreader] [--max-replans <n>] [--max-task-actions <n>] [--diagnose-stop]
                     [--repeat <n>] [--out <dir>] [--json] [--project <dir>]
  rawstep hints <run-dir> [--reference <run-dir>]
  rawstep report <run-dir> [--analysis <analysis.json>] [--out <dir>]
  rawstep analyze <run-dir> [--llm] [--out <dir>] [--project <dir>]
  rawstep doctor [--project <dir>]

Commands:
  init      Write a default rawstep.config.json. An existing file is never overwritten.
  ui        Open the dashboard to set up connections, experiment conditions and tasks, and to run experiments.
  run       Run a task from rawstep.config.json (by id) or a task JSON file under experiment conditions (model combo,
            action set, page environment, assistive technology), then print the conditions, each run's outcome and the
            findings gathered across the runs, grouped as Page, Run and Model. Runs of a planned combo also write
            plan.json and plan.md. With an analysis model (the combo's or the project's) each run is also analysed.
  hints     List the places worth a look in a saved run (hints.json is written next to the trace).
  report    Write report.html and report.json for a saved run.
  analyze   Analyze a saved run. Without --llm the analysis is a local summary; --llm sends the saved
            events (PNG bytes omitted) to the project's analysis model.
  doctor    Check that a browser can launch, the config parses, credentials are set and, for a native
            screen reader, that its AT Driver endpoint answers.

Configuration:
  Everything lives in rawstep.config.json in the project directory: connections (where models are
  reached), model combos (who plans and who acts), action sets, page and assistive-technology environments,
  run rules, presets, tasks, project models (analysis, check suggestions) and machine settings. The dashboard and the CLI read the same file. Commit it with your project.
  API keys are never in that file: it names environment variables, and their values go in .env.local
  (do not commit it) or the process environment.

Run defaults:
  --preset, --combo, --actions, --environment (page), --at (assistive technology)
                 each the task's own, then its preset's, then the first shared one
  --max-replans, --max-task-actions
                 override the run rules for these runs
  --mode     keyboard
  --repeat   1; repeats are compared with the fastest run that reached the goal
  --out      <project>/.rawstep/runs/<timestamp>-<id>/, one run-<n> directory per repeat

Exit codes: 0 when the runs completed, whether or not the goal was reached; 1 on errors; 2 on bad usage;
130 or 143 when cancelled by SIGINT or SIGTERM. Rawstep reports friction hints, not pass or fail.

Screenshots can expose private page contents; the model receives pixels, the goal, named input keys and the
action history, never the DOM or verifier results. Saved traces redact input values.
`;
