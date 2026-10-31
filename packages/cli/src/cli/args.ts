import { runRulesOverrideSchema, type RunRulesOverride } from '@rawstep/project/config';

export type Command = 'init' | 'ui' | 'run' | 'hints' | 'report' | 'analyze' | 'doctor';
export type CliArguments = {
  command: Command;
  positionals: string[];
  /** Repeatable options (`--rule`) hold every value given, in order; the others hold the one value or `true`. */
  options: Record<string, string | boolean | string[]>;
};

export class CliUsageError extends Error {
  override name = 'CliUsageError';
}

const optionsByCommand: Record<Command, readonly string[]> = {
  init: ['project'],
  ui: ['port', 'project'],
  run: ['project', 'profile', 'repeat', 'rule', 'out', 'json'],
  hints: ['reference'],
  report: ['analysis', 'out'],
  analyze: ['project', 'llm', 'out'],
  doctor: ['project'],
};
const repeatableOptions = new Set(['rule']);
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
    if (!repeatableOptions.has(option) && Object.hasOwn(result.options, option)) {
      throw new CliUsageError(`Option --${option} may only be provided once.`);
    }
    if (booleanOptions.has(option)) {
      if (equalIndex >= 0) throw new CliUsageError(`--${option} does not take a value.`);
      result.options[option] = true;
      continue;
    }
    const value = equalIndex < 0 ? args[++i] : token.slice(equalIndex + 1);
    if (!value || value.startsWith('--')) throw new CliUsageError(`Option --${option} requires a value.`);
    if (repeatableOptions.has(option)) result.options[option] = [...(result.options[option] as string[] | undefined ?? []), value];
    else result.options[option] = value;
  }
  const { count, noun } = positionalsByCommand[command];
  if (result.positionals.length !== count) {
    throw new CliUsageError(count === 0 ? `${command} does not accept positional arguments.` : `${command} requires exactly one ${noun}.`);
  }
  if (command === 'ui' && result.options.port !== undefined && (!/^[0-9]+$/.test(String(result.options.port)) || Number(result.options.port) < 1 || Number(result.options.port) > 65535)) throw new CliUsageError('--port must be an integer from 1 to 65535.');
  if (command === 'run') {
    if (result.options.repeat !== undefined && (!/^[0-9]+$/.test(String(result.options.repeat)) || Number(result.options.repeat) < 1 || Number(result.options.repeat) > 100)) throw new CliUsageError('--repeat must be an integer from 1 to 100.');
    parseRunRules(result.options.rule as string[] | undefined);
  }
  return result;
}

/** What the CLI reads of a run rule's schema (zod's): its type, and the choices or bounds that describe it. */
type RuleSchema = { def: { type: string }; unwrap?: () => RuleSchema; options?: string[]; isInt?: boolean; minValue?: number | null; maxValue?: number | null; safeParse(value: unknown): { success: boolean } };
const ruleSchemas = runRulesOverrideSchema.shape as unknown as Record<string, RuleSchema>;
/** Describes what a run rule accepts, from its schema: the choices of an enum, true or false, or a number range. */
function allowedValues(schema: RuleSchema): string {
  const inner = schema.def.type === 'optional' && schema.unwrap ? schema.unwrap() : schema;
  if (inner.def.type === 'enum') return `one of ${(inner.options ?? []).join(', ')}`;
  if (inner.def.type === 'boolean') return 'true or false';
  if (inner.def.type === 'number') return `${inner.isInt ? 'an integer' : 'a number'} from ${inner.minValue} to ${inner.maxValue}`;
  return 'a valid value';
}
/**
 * The run rules named by `--rule <name>=<value>` entries, each value read as the rule's type (a number, `true` or `false`, or text)
 * and the whole override checked with the run rules schema. The last entry for a rule wins.
 */
export function parseRunRules(entries: readonly string[] | undefined): RunRulesOverride {
  const raw: Record<string, unknown> = {};
  for (const entry of entries ?? []) {
    const at = entry.indexOf('=');
    const name = at < 0 ? entry : entry.slice(0, at), text = at < 0 ? '' : entry.slice(at + 1);
    const schema = Object.hasOwn(ruleSchemas, name) ? ruleSchemas[name] : undefined;
    if (!schema) throw new CliUsageError(`--rule ${name || entry} is not a run rule. Use one of ${Object.keys(ruleSchemas).join(', ')}.`);
    if (at < 0 || !text) throw new CliUsageError(`--rule ${name} needs a value: --rule ${name}=<value>.`);
    const value = [text, text === 'true' ? true : text === 'false' ? false : undefined, text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : undefined]
      .find(candidate => candidate !== undefined && schema.safeParse(candidate).success);
    if (value === undefined) throw new CliUsageError(`--rule ${name}=${text} is not valid: ${name} must be ${allowedValues(schema)}.`);
    raw[name] = value;
  }
  return runRulesOverrideSchema.parse(raw);
}

export const CLI_USAGE = `Rawstep: run a screen reader task on a web page and see where the run got slow or took detours

Usage:
  rawstep init [--project <dir>]
  rawstep ui [--port <port>] [--project <dir>]
  rawstep run <task> [--profile <id|name>] [--rule <name>=<value>]...
                     [--repeat <n>] [--out <dir>] [--json] [--project <dir>]
  rawstep hints <run-dir> [--reference <run-dir>]
  rawstep report <run-dir> [--analysis <analysis.json>] [--out <dir>]
  rawstep analyze <run-dir> [--llm] [--out <dir>] [--project <dir>]
  rawstep doctor [--project <dir>]

Commands:
  init      Write rawstep.config.json with a demo task that runs at once on a written plan (no model). An existing file
            is never overwritten.
  ui        Open the dashboard to set up connections, experiment conditions and tasks, and to run experiments.
  run       Run a task from rawstep.config.json (by id) or a task JSON file with a run profile (models, allowed
            actions, page environment, screen reader, run rules), then print the conditions, each run's outcome and the
            findings gathered across the runs, grouped as Page, Run and Model. Runs also write plan.json and plan.md. With an analysis model (the project's) each run is also analysed.
  hints     List the places worth a look in a saved run (hints.json is written next to the trace).
  report    Write report.html and report.json for a saved run.
  analyze   Analyze a saved run. Without --llm the analysis is a local summary; --llm sends the saved
            events to the project's analysis model.
  doctor    Check that a browser can launch, the config parses, each profile can run, credentials are set and, for a
            native screen reader, that its AT Driver endpoint answers.

Configuration:
  Everything lives in rawstep.config.json in the project directory: connections (where models are
  reached; the model and effort are picked where used), run profiles (who plans, allowed actions,
  page environment, screen reader, run rules), tasks, project models (analysis, check suggestions) and machine settings. The dashboard and the CLI read the same file. Commit it with your project.
  API keys are never in that file: it names environment variables, and their values go in .env.local
  (do not commit it) or the process environment.

Run defaults:
  --profile  <id|name>; the run profile to use; without it, the project's first profile
  --rule     <name>=<value>, repeatable; overrides one run rule for these runs (the profile's, then these), e.g. --rule maxPlannerCalls=20 --rule survey=headings;
             see the runRules section of docs/reference/config.md for the rules
  --repeat   1; repeats are compared with the fastest run that reached the goal
  --out      <project>/.rawstep/runs/<timestamp>-<id>/, one run-<n> directory per repeat

Exit codes: 0 when the runs completed, whether or not the goal was reached; 1 on errors, including any run that ended on one; 2 on bad usage;
130 or 143 when cancelled by SIGINT or SIGTERM. Rawstep reports friction hints, not pass or fail.

The model receives the speech the screen reader produces, the goal, named input keys and the action history,
never the DOM, the diagnostic screenshots or verifier results. Saved traces redact input values.
`;
