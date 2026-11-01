import { runRulesOverrideSchema, type RunRulesOverride } from '@rawstep/project/config';

export type Command = 'init' | 'ui' | 'run' | 'suite' | 'compare' | 'hints' | 'report' | 'analyze' | 'doctor';
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
  run: ['project', 'profile', 'repeat', 'parallel', 'rule', 'note', 'json', 'baseline', 'fail-on', 'save-summary', 'junit'],
  suite: ['project', 'tag', 'profile', 'repeat', 'parallel', 'rule', 'note', 'json', 'baseline', 'fail-on', 'save-summary', 'junit'],
  compare: ['fail-on', 'json', 'junit'],
  hints: ['reference'],
  report: ['analysis', 'out'],
  analyze: ['project', 'llm', 'out'],
  doctor: ['project'],
};
const repeatableOptions = new Set(['rule', 'tag']);
/** Options that repeat for one command only: `suite` may run several profiles, `run` one. */
const repeatableFor: Partial<Record<Command, readonly string[]>> = { suite: ['profile'] };
const booleanOptions = new Set(['json', 'llm']);
const positionalsByCommand: Record<Command, { count: number; noun: string }> = {
  init: { count: 0, noun: '' }, ui: { count: 0, noun: '' }, doctor: { count: 0, noun: '' },
  run: { count: 1, noun: 'task id or task JSON file' },
  suite: { count: -1, noun: 'task ids or task JSON files' },
  compare: { count: 2, noun: 'baseline and batch (summary.json files or batch folders)' },
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
    const repeatable = repeatableOptions.has(option) || !!repeatableFor[command]?.includes(option);
    if (!repeatable && Object.hasOwn(result.options, option)) {
      throw new CliUsageError(`Option --${option} may only be provided once.`);
    }
    if (booleanOptions.has(option)) {
      if (equalIndex >= 0) throw new CliUsageError(`--${option} does not take a value.`);
      result.options[option] = true;
      continue;
    }
    const value = equalIndex < 0 ? args[++i] : token.slice(equalIndex + 1);
    if (!value || value.startsWith('--')) throw new CliUsageError(`Option --${option} requires a value.`);
    if (repeatable) result.options[option] = [...(result.options[option] as string[] | undefined ?? []), value];
    else result.options[option] = value;
  }
  const { count, noun } = positionalsByCommand[command];
  // A count of -1 takes any number (suite: none means every registered task, or the tagged ones).
  if (count >= 0 && result.positionals.length !== count) {
    throw new CliUsageError(count === 0 ? `${command} does not accept positional arguments.` : count === 1 ? `${command} requires exactly one ${noun}.` : `${command} requires a ${noun}.`);
  }
  if (command === 'ui' && result.options.port !== undefined && (!/^[0-9]+$/.test(String(result.options.port)) || Number(result.options.port) < 1 || Number(result.options.port) > 65535)) throw new CliUsageError('--port must be an integer from 1 to 65535.');
  if (command === 'run' || command === 'suite') {
    if (result.options.repeat !== undefined && (!/^[0-9]+$/.test(String(result.options.repeat)) || Number(result.options.repeat) < 1 || Number(result.options.repeat) > 100)) throw new CliUsageError('--repeat must be an integer from 1 to 100.');
    if (result.options.parallel !== undefined && (!/^[0-9]+$/.test(String(result.options.parallel)) || Number(result.options.parallel) < 1 || Number(result.options.parallel) > 8)) throw new CliUsageError('--parallel must be an integer from 1 to 8.');
    if (typeof result.options.note === 'string' && result.options.note.length > 200) throw new CliUsageError('--note may be at most 200 characters.');
    parseRunRules(result.options.rule as string[] | undefined);
  }
  if (result.options['fail-on'] !== undefined) {
    if (command !== 'compare' && result.options.baseline === undefined) throw new CliUsageError('--fail-on needs --baseline: it names the changes against the baseline that fail the command.');
    parseGates(String(result.options['fail-on']));
  }
  return result;
}

/** The gates `--fail-on` names, comma-separated: reach, moves, stuck, missing. */
export function parseGates(value: string): string[] {
  const gates = value.split(',').map(gate => gate.trim()).filter(Boolean), known = ['reach', 'moves', 'stuck', 'missing'];
  const unknown = gates.filter(gate => !known.includes(gate));
  if (!gates.length || unknown.length) throw new CliUsageError(`--fail-on takes ${known.join(', ')} (comma-separated)${unknown.length ? `, not ${unknown.join(', ')}` : ''}.`);
  return gates;
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
                     [--repeat <n>] [--parallel <n>] [--note <text>] [--json] [--project <dir>]
  rawstep suite [<task>...] [--tag <tag>]... [--profile <id|name>]... [--rule <name>=<value>]...
                     [--repeat <n>] [--parallel <n>] [--note <text>] [--json] [--project <dir>]
                     [--baseline <summary>] [--fail-on <gates>] [--save-summary <file>] [--junit <file>]
  rawstep compare <baseline> <batch> [--fail-on <gates>] [--junit <file>] [--json]
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
  suite     Run several tasks as one batch: the ones named, the ones with a --tag, or every task in rawstep.config.json,
            each under every --profile, and print each task's result under each profile.
  compare   Compare a batch with a baseline, per task and profile, with the spread between repeats in mind: what changed beyond
            noise (reach, moves, stuck places). Each side is a summary.json file or a batch folder.
  hints     List the places worth a look in a saved run (hints.json is written next to the trace).
  report    Write report.html and report.json for a saved run.
  analyze   Analyze a saved run. Without --llm the analysis is a local summary; --llm sends the saved
            events to the project's analysis model.
  doctor    Check that a browser can launch, the config parses, each task file is a valid task, each profile can run,
            each API key works and its model is listed (a request to the provider) and, for a native screen reader,
            that its AT Driver endpoint answers.

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
  --parallel machine.parallelRuns (1); how many runs go at once, each its own browser. Tasks where a person passes bot checks in a launched browser go one at a time
  --note     what this batch is for ("made Add to cart a button"), shown with it in the dashboard
  Runs are saved as one batch in <project>/.rawstep/experiments/<id>/, one folder per run, with summary.json; the dashboard lists them.

Against a baseline (run, suite):
  --baseline     a summary.json (one saved with --save-summary and committed) or a batch folder; prints what changed beyond noise
  --fail-on      reach (the default with --baseline); comma-separated, any of reach (reached share dropped), moves (reaching it took
                 more moves), stuck (a new stuck place), missing (a task or profile of the baseline not run)
  --save-summary write this batch's summary.json to a file too, e.g. to commit as the next baseline
  --junit        write JUnit XML, one test case per task and profile
  In GitHub Actions the summary table is added to the job summary ($GITHUB_STEP_SUMMARY).

Exit codes (run, suite): 0 when every run gave a measurement (reached the goal, gave up, or said it was done but the goal was not reached);
1 on errors, including any run that ended on one; 2 on bad usage; 3 when no run broke but at least one was not measured (a limit,
a block, a model that was unsure); 4 when --fail-on caught a change against the baseline (compare too); 130 or 143 when cancelled. Other commands: 0 on success, 1 on errors, 2 on bad usage.
Rawstep reports friction hints, not pass or fail.

The model receives the speech the screen reader produces, the goal, named input keys and the action history,
never the DOM, the diagnostic screenshots or verifier results. Saved traces redact input values.
`;
