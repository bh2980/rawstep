# API reference

This page is for people who call Rawstep from code: a test that runs a task and checks the findings, a script that reads saved runs, or a custom decision policy. It lists `runTask` and `runSuite`, the import paths the `rawstep` package exposes, and how to write your own policy.

Rawstep is an ES module package for Node 22.12 or newer. The CLI and the dashboard are built on the same calls. Use the [CLI reference](./cli.md) if you only want commands.

```ts
import { runTask, runSuite } from 'rawstep';
```

## `runTask`

`runTask` runs a task from a project (`rawstep.config.json`), exactly as `npx rawstep run` does, and returns the runs and the findings. The runs are saved as one batch in `<projectDir>/.rawstep/experiments/<id>/`, the place the dashboard lists (see the [results reference](./results.md#where-runs-are-written)).

```ts
function runTask(task: string, options?: RunTaskOptions): Promise<RunTaskResult>;
```

`task` is a task id from the config, or the path of a task JSON file (a relative path is resolved from `projectDir`). The task file format is in the [task reference](./task.md).

It resolves when the runs finish, whatever way they ended: reaching the goal is one signal in the hints, not a verdict, so a run that did not reach its goal still resolves. So does a run that broke: it resolves as a run that ended on an error (`outcome.reason` is `error`). It rejects when the runs could not start, or when they were cancelled (see [Errors](#errors)). A third argument exists for Rawstep's own tests; do not use it.

### Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `projectDir` | `string` | the current directory | The folder that holds `rawstep.config.json`. |
| `profile` | `string` | the task's first usual profile (`profiles` on the task in the config), else the first profile in the config | The run profile, by id or name. A task file has no profile of its own. |
| `runRules` | `Partial<RunRules>` | none | Run rules for these runs only, over the profile's. Same names as `--rule` in the [CLI](./cli.md#rawstep-run); values and ranges are in the [config reference](./config.md). |
| `repeat` | `number` | `1` | How many times to run the task. An integer from 1 to 100. The runs are compared with the fastest one that reached the goal. |
| `parallel` | `number` | the project's `machine.parallelRuns` (1) | How many runs go at once, an integer from 1 to 8. Same as `--parallel`: see [Runs at the same time](./cli.md#runs-at-the-same-time). |
| `note` | `string` | none | What this batch is for, up to 200 characters (`made Add to cart a button`). The dashboard shows it. |
| `signal` | `AbortSignal` | none | Cancels the runs. The traces kept so far still get their hints, rule-based analysis and report (no model analysis), then `runTask` rejects with `cancelled`. |
| `onEvent` | `(event: TraceEvent) => void` | none | Called with every stored (already redacted) trace event as it is recorded. An error in the listener does not affect the run. |

### Return value

`RunTaskResult`:

| Field | Type | Meaning |
| --- | --- | --- |
| `batch` | `{ id: string; dir: string }` | The batch the runs were saved as: its id and its folder. |
| `summary` | batch summary | The batch summed up per task and profile: endings, the moves of runs that reached the goal, stuck places. The same content is saved as `summary.json` in the batch folder. Fields: [the batch summary](./results.md#the-batch-summary). |
| `conditions` | `Record<string, unknown>` | What the runs were made with: profile, planner, action set, page environment, screen reader, run rules. The same record is in each trace. |
| `warnings` | `string[]` | Things worth knowing that did not stop the runs, for example that the analysis key is not set so the runs get the rule-based analysis only. |
| `runs` | array | One entry per repeat, in order. |
| `findings` | `HintFinding[]` | Hints gathered across all runs by kind and page element. |

Each entry of `runs`:

| Field | Type | Meaning |
| --- | --- | --- |
| `runId` | `string` | The run's id, as in its trace. |
| `taskId`, `taskName` | `string` | The task the run was of. A task file that is not registered has an id made from its file name. |
| `profileId`, `profileName` | `string` | The run profile the run used. |
| `outDir` | `string` | The run folder, inside the batch folder (see the [results reference](./results.md)). |
| `outcome` | `RunOutcome \| undefined` | What the trace recorded: `status` (`success`, `failure`, `inconclusive`, `aborted`), `reason`, and, for a run the planner or a guard stopped, `policyStopSource`. |
| `hints` | `HintReport` | The run's friction hints, with `steps`, `durationMs` and `goalReached`. |

A `HintFinding` is the same kind of hint about the same element across runs: `kind`, `source` (`page`, `model` or `run`), an optional `target` (`{ role, name? }`), `runs` (how many runs show it), `totalRuns`, and every `occurrences` entry (`runId`, `steps`, `certainty`, `detail`). Run-level hints that describe a run rather than the page (`slow-run`, `goal-met-at-start` and the other `run` kinds) are left out of `findings` but stay in each run's `hints`. See [hint kinds](./results.md#hint-kinds).

To turn an outcome into one of the four endings (see [concepts](../concepts.md)), call `runEnding` from `rawstep` or `rawstep/hints`, as the CLI does:

```ts
import { runEnding, runTask } from 'rawstep';

const { runs } = await runTask('demo', { repeat: 3 });
for (const run of runs) {
  const stop = run.outcome?.policyStopSource;
  console.log(runEnding(run.outcome, typeof stop === 'string' ? stop : undefined));
  // { ending: 'reached' | 'gave-up' | 'mistaken' | 'unmeasured', by?: UnmeasuredBy }
}
```

`ending` is a `RunEnding`: `reached` (reached the goal), `gave-up`, `mistaken` (said it was done, but the goal was not reached) or `unmeasured` (not measured). For `unmeasured`, `by` is an `UnmeasuredBy`: `planner-calls`, `no-allowed-action`, `max-steps`, `timeout`, `repetition-guard`, `model-uncertain` or `other`. It returns `undefined` when there is no outcome. It does not single out a run that ended on an error (`outcome.reason` `error` or `trace-persistence-error`) or was cancelled (`status` `aborted`): leave those out first, as the CLI does, because they say nothing about the page.

### Example: use it in a test

```ts
import { runTask } from 'rawstep';
import { expect, it } from 'vitest';

it('a first-time screen reader user can add the mug to the cart', async () => {
  const { runs, findings } = await runTask('demo', { repeat: 3 });
  const reached = runs.filter(run => run.outcome?.status === 'success');
  expect(reached.length).toBeGreaterThanOrEqual(2);
  expect(findings.filter(finding => finding.source === 'page')).toEqual([]);
});
```

The thresholds are yours. Rawstep reports friction hints; it does not decide what is acceptable.

### Errors

`runTask` rejects with a `ProjectError` (also exported from `rawstep`) for setup problems. It has a stable `code`, a message for people, and an HTTP-style `status` the dashboard uses. Codes you can branch on:

| `code` | When |
| --- | --- |
| `no-config`, `invalid-config`, `old-config` | There is no `rawstep.config.json`, it does not parse, or it is an older version. |
| `task-not-found`, `profile-not-found` | The id or name is not in the config (and, for a task, there is no file at that path). |
| `invalid-task` | A task file that is not registered is not valid JSON. A task that fails validation rejects with an `Error` whose message names the field. |
| `invalid-repeat`, `invalid-parallel` | `repeat` is not an integer from 1 to 100, or `parallel` is not an integer from 1 to 8. |
| `missing-credential` | The planner's model needs a key that is not in `.env.local` or the environment. |
| `plan-file-invalid` | The profile's plan file is missing, not JSON, or not a plan with tasks. |
| `planner-model-invalid`, `plan-file-task`, `voiceover-macos`, `nvda-windows`, `endpoint-not-loopback`, `unsupported-action`, `unknown-input` | The profile cannot run here: no planner, a plan file that needs a task file, a native screen reader on the wrong OS or without a loopback AT Driver address, or actions or inputs the screen reader or task do not have. |
| `browser-endpoint-missing` | The task's `browser.mode` is `connect`, but `machine.browserEndpoint` is empty ([task reference](./task.md#browser)). |
| `cancelled` | `signal` was aborted. Traces written so far are kept, with their hints and report. |

A run that breaks while it runs (the page does not load, the model fails, the run could not start) does not reject: its `outcome.reason` is `error` and the message is in `outcome.error`. A run that could not start has no trace, so its `outcome` is made from the error (`stage` `setup`). A missing analysis key is not an error either; it adds a `warnings` entry.

## `runSuite`

`runSuite` runs several tasks under one or more profiles as one batch, exactly as `npx rawstep suite` does.

```ts
function runSuite(options?: RunSuiteOptions): Promise<RunSuiteResult>;
```

It takes the options of `runTask` (`projectDir`, `runRules`, `repeat`, `parallel`, `note`, `signal`, `onEvent`), except that `profile` is replaced by `profiles`, plus these:

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tasks` | `string[]` | none | Tasks by id, or by the path of a task file. |
| `tags` | `string[]` | none | Adds the registered tasks that have any of these tags. |
| `profiles` | `string[]` | each task's usual profiles, else the first profile in the config | Run profiles by id or name. When given, every task runs under each one; without them, each task runs with its own usual profiles. |

With neither `tasks` nor `tags`, it runs every registered task. A tag that no task has rejects with `no-tasks`. It resolves like `runTask`: runs that did not reach the goal, or that ended on an error, still resolve; setup problems and cancellation reject, with the same codes.

`RunSuiteResult`:

| Field | Type | Meaning |
| --- | --- | --- |
| `batch` | `{ id: string; dir: string }` | The batch the runs were saved as. |
| `summary` | batch summary | As for `runTask`: the whole batch, one cell per task under a profile. |
| `warnings` | `string[]` | As for `runTask`. |
| `runs` | array | Every run of the batch, with the fields listed under [`runTask`](#return-value). |
| `groups` | array | One entry per task under a profile: `taskId`, `taskName`, `profileId`, `profileName`, its `runs`, and its `findings` (hints gathered across just those runs). |

```ts
const { groups } = await runSuite({ tags: ['checkout'], repeat: 3, parallel: 2 });
for (const group of groups) {
  const reached = group.runs.filter(run => run.outcome?.status === 'success').length;
  console.log(`${group.taskName} · ${group.profileName}: ${reached} of ${group.runs.length} reached the goal`);
}
```

### Comparing with a baseline from code

`summary` is plain JSON (`schemaVersion` `"1.0"`), so you can save it, commit it and read it back. The functions that compare two summaries are exported from `rawstep/hints`:

```ts
import { compareSummaries, gatedChanges, validateBatchSummary } from 'rawstep/hints';
import { readFile } from 'node:fs/promises';
import { runSuite } from 'rawstep';

const baseline = validateBatchSummary(JSON.parse(await readFile('rawstep-baseline.json', 'utf8')));
const { summary } = await runSuite({ tags: ['checkout'], repeat: 3 });
const comparison = compareSummaries(baseline, summary);
const caught = gatedChanges(comparison, ['reach']);
if (caught.length) console.log(caught.map(change => change.text));
```

| Name | What it does |
| --- | --- |
| `compareSummaries(base, head, rules?)` | Compares cell by cell. Returns `{ base, head, cells, changes }`. Each cell says whether `reach` and `moves` are `changed`, `within-noise`, `too-few-runs` or `missing`, and lists its `changes`. `rules` overrides the noise rules (`minRuns`, `movesShare`, `movesSlack`, `stuckShare`); the defaults, `DEFAULT_NOISE`, are what the CLI uses. |
| `gatedChanges(comparison, gates)` | The changes the gates catch. `gates` are names from `GATES`: `reach`, `moves`, `stuck`, `missing`. An unknown name throws. |
| `validateBatchSummary(value)` | Checks a parsed file is a summary this version reads, and returns it. Throws otherwise. |
| `buildBatchSummary(batch, runs)` | Sums up finished runs per task and profile. |
| `summaryMarkdown(summary, comparison?, gates?)`, `junitXml(summary, comparison?, gates?)` | The job summary table and the JUnit XML the CLI writes. |

A `change` has a `kind` (`reach-drop`, `reach-rise`, `moves-up`, `moves-down`, `stuck-new`, `stuck-gone`, `cell-new` or `cell-gone`), the task and profile, and a `text` for people. The comparison says what changed beyond noise; it does not say which side is better. The rules are in [Using Rawstep in CI](../ci.md#what-is-compared).

The types `BatchSummary`, `SummaryCell`, `SummaryComparison` and `Change` come from `rawstep/hints` too. They are not on the `rawstep` root. `runTask` and `runSuite` do not take a baseline: pass `--baseline` to the CLI, or compare the `summary` you get back as above.

## Import paths

`rawstep` is one package with one entry per area. The root re-exports what most programs need; the sub-paths hold the rest. The list below is the package's `exports` map. The names on the `rawstep` root are pinned by the public API test, so a change there is a change to this page.

| Import | What it is for | Main names |
| --- | --- | --- |
| `rawstep` | The high-level calls, plus the most used pieces of the paths below. | `runTask`, `runSuite`, `ProjectError`, `ScriptedPolicy`, `loadPolicy`, `OrchestratedSpeechPolicy`, `LlmPlanner`, `readTrace`, `TraceRecorder`, `extractHints`, `aggregateHints`, `writeHints`, `runEnding`, `analyzeTrace`, `writeReport`, `runMockVoiceOverTask`, `AtDriverBackend`, `resolveTask`; types `RunEnding`, `UnmeasuredBy`, `EndingOf`, `RunTaskOptions`, `RunTaskResult`, `RunSuiteOptions`, `RunSuiteResult`, `SuiteGroup`, `BatchRun`, `BatchRef` |
| `rawstep/project` | The project layer behind `runTask` and `runSuite`: config schema, reading and writing a project, checking and executing a run. | `runTask`, `runSuite`, `ProjectStore`, `configSchema`, `parseConfig`, `defaultConfig`, `initProject`, `checkRun`, `executeRun`, `finalizeRun`, `compareRepeats`, `projectAnalyzer`, `loadPlanFile`, `ProjectError`, `CONFIG_FILE` |
| `rawstep/runner` | The low-level runner: one task, a backend you give it, a policy you give it. | `runWithPolicy`, `validateDecision`, `confirmationHeard`; type `RunOptions` |
| `rawstep/policy` | Decision policies and the plan document. | `ScriptedPolicy`, `loadPolicy`, `OrchestratedSpeechPolicy`, `FixedPlanner`, `planFileSchema`, `planDraftSchema`, `renderPlanMarkdown`, `speechChoices`, `followPlan` |
| `rawstep/contracts` | Task and run types and checks. | `resolveTask`, `describeInputs`, `matchesText`, `validateNavigation`, `MAX_SCRIPT_SOURCE`, `STOP_SOURCES`; types `Task`, `DecisionPolicy`, `Decision`, `Backend`, `VerifyRule` and the rest of the contract types |
| `rawstep/trace` | The saved trace: write, read, validate, redact. | `readTrace`, `traceFilePath`, `validateTrace`, `TraceRecorder`, `FileTraceSink`, `MemoryTraceSink`, `createRedactor`, `REDACTED`, `TRACE_SCHEMA_VERSION`, `writeJsonAtomic` |
| `rawstep/hints` | Friction hints from a saved trace, how a run ended, and the comparison of two batches. | `extractHints`, `aggregateHints`, `writeHints`, `selectReference`, `summarizeRun`, `runEnding`, `isStuck`, `isWrongGuess`, `HINTS_SCHEMA_VERSION`, `HINT_SOURCES`, `DEFAULT_HINT_THRESHOLDS`, `compareSummaries`, `gatedChanges`, `validateBatchSummary`, `buildBatchSummary`, `summaryMarkdown`, `junitXml`, `GATES`, `DEFAULT_NOISE`; types `RunEnding`, `UnmeasuredBy`, `EndingOf`, `BatchSummary`, `SummaryComparison` |
| `rawstep/analyze` | Analysis of a saved trace: the rule-based one, and the model-based one. | `analyzeTrace`, `analyzeSavedTrace`, `deterministicAnalyzer`, `LlmTraceAnalyzer`, `loadAnalyzer`, `readAnalysis`, `validateAnalysisReport`, `ANALYSIS_SCHEMA_VERSION` |
| `rawstep/report` | The HTML and JSON report. | `writeReport`, `renderReportHtml`, `summarizeTrace`, `escapeHtml` |
| `rawstep/browser` | Opening the browser a run uses. | `createBrowserSession`, `closeBrowserSession`, `BrowserSetupError`, `BrowserConnectError`, `BrowserAccessBlockedError`, `validateCdpEndpoint`, `validateProxyServer` |
| `rawstep/verify` | The completion checks (the oracle). | `verifyTask`, `evaluateVerifyRule`, `runScriptCheck`, `formatVerificationFeedback`, `MAX_VERIFICATION_RETRIES` |
| `rawstep/profiles` | Page environment profiles (viewport, text size and spacing, colour scheme, contrast, reduced motion). | `BUILTIN_PROFILES`, `DEFAULT_PROFILE`, `resolveEnvironmentProfile`, `applyProfile`, `verifyLiveProfile`, `collectBrowserDiagnostics`, `ProfileApplicationError` |
| `rawstep/mock-voiceover` | The simulated VoiceOver. | `runMockVoiceOverTask`, `MockVoiceOverBackend`, `formatSimulatedSpeech`, `MOCK_VOICEOVER_WARNING`, `MOCK_VOICEOVER_LIMITATIONS`, `MOCK_VOICEOVER_PROFILE` |
| `rawstep/at-driver` | The client for a native screen reader through an AT Driver server. | `AtDriverBackend`, `AtDriverClient`, `AtDriverError`, `getAtDriverProfile`, `AT_DRIVER_KEYS` |
| `rawstep/evidence` | The research corpus behind the simulator's wording. Large; loaded only when you import it. | `EVIDENCE_CATALOG`, `listCorpusRules`, `compareEvidenceCase`, `summarizeEvidenceCoverage`, `UnsupportedCorpusPatternError` |
| `rawstep/cli` | The CLI as a function, for embedding or testing. | `runCli`, `parseCliArguments`, `formatRunResult`, `formatSuiteResult`, `endingText`, `CLI_USAGE`, `CliUsageError` |
| `rawstep/package.json` | The package manifest. | |

The package also installs the `rawstep` command (`bin`).

### The low-level runner: `runWithPolicy`

`import { runWithPolicy } from 'rawstep/runner'` runs one task with a backend and a policy you give it: `runWithPolicy(task: Task, options: RunOptions): Promise<RunTrace>`. It writes the trace and returns it. It does not read a config, write hints or write a report. `runTask` and `runSuite` (above) are the calls that run tasks from a project.

`RunOptions` for the low-level runner (the required ones are `backend`, `policy` and `outDir`):

| Option | Meaning |
| --- | --- |
| `backend` | A `Backend`: `MockVoiceOverBackend`, `AtDriverBackend`, or your own. |
| `policy` | A `DecisionPolicy` (see below). |
| `outDir` | The run folder. It is created; a folder that already has a trace is never replaced. |
| `allowedActions` | Narrows the backend's intents, keys, input keys, `typeText`, `replaceText`. Asking for something the backend does not have throws. |
| `profile` | A page environment profile (name or object). |
| `signal` | Cancels the run; the trace is saved with an `aborted` outcome. |
| `confirmationGrace` | Actions to go on after the goal is reached when nothing the user heard said so (default 0). |
| `headless`, `browserExecutablePath`, `browserEndpoint`, `proxyServer` | How the browser is launched or reached. `browserEndpoint` is the address of a Chrome you started yourself. |
| `diagnosticScreenshots` | Save a screenshot per step for people reading the run (never given to the policy). |
| `onEvent` | Receives every stored trace event. |
| `observe` | The page observer that feeds hints; on by default. |
| `conditions` | A record of the experiment conditions, saved at `run.started`. |
| `includeSensitiveInputValues` | Opt in to keeping input values in the trace. Off by default; see [redaction](./results.md#redaction). |
| `personCheck` | Wait for a person to pass a site's own human check. Rawstep never answers a check itself. |

`runMockVoiceOverTask(task, options)` from `rawstep` (or `rawstep/mock-voiceover`) is the runner with the simulated VoiceOver as the backend: the same options minus `backend`, plus `warn`. It prints a notice to stderr that the output is simulated unless you pass `warn: () => {}`.

## Writing your own policy

A policy decides what the user does next. Rawstep calls it once per step with what a first-time screen reader user could know, and carries out what it returns. This is the same contract the built-in policy follows. The built-in policy turns a plan into decisions; to use your own logic instead, pass your policy to `runWithPolicy` or `runMockVoiceOverTask`.

### The contract

```ts
interface DecisionPolicy {
  decide(input: {
    goal: string;
    context?: string;
    observation: Observation;
    history: readonly HistoryEntry[];
    allowedActions: AllowedActions;
    inputs: Readonly<Record<string, InputDescriptor>>;
    signal: AbortSignal;
  }): Decision | Promise<Decision>;
  /** Optional: diagnostics saved as `policy.evidence` events. */
  takeDecisionEvidence?(): readonly unknown[];
}
```

What `decide` receives:

| Field | Meaning |
| --- | --- |
| `goal` | The task's goal, as written. |
| `context` | The task's `context`: what the user knows about the site and page before starting. Absent when the task has none. |
| `observation` | What the screen reader said after the last action: `speech` (an array of lines), `provenance` (`simulation` or `native`), `title` (the page title, once it has been spoken), and the collection `window`. No DOM, no accessibility tree, no screenshot, no verifier result. |
| `history` | Every earlier step: `step`, the `decision`, the `observation` that followed and the `execution` result (`ok`, `error`, `failure` of `not-editable` or `backend`). |
| `allowedActions` | What this run allows: `intents`, `keys`, `inputKeys`, `typeText`, `replaceText`. |
| `inputs` | The task's named inputs. Each is `{ sensitive, description?, value? }`. A `value` is present only for inputs marked `sensitive: false`; secrets are names only. |
| `signal` | Aborts when the run is cancelled or its time budget runs out. |

What it returns, a `Decision`:

| Shape | Meaning |
| --- | --- |
| `{ action: { kind: 'intent', intent }, rationale? }` | A screen reader move or command, for example `next`, `heading.next`, `activate`. The names come from `allowedActions.intents`. |
| `{ action: { kind: 'key', key }, rationale? }` | A key press from `allowedActions.keys`. |
| `{ action: { kind: 'typeText', input }, rationale? }` | Type the task input named `input` into the focused editable field. |
| `{ action: { kind: 'replaceText', input }, rationale? }` | Replace the focused field's text with that input. |
| `{ stop: 'success' \| 'stuck' \| 'uncertain', rationale?, stopSource? }` | End the run. The verifier still decides whether the goal was reached; `stuck` is recorded as giving up, `uncertain` as not measured. |

Rules the runner enforces:

- An action outside `allowedActions` (an intent the screen reader does not have, an input the task does not name) ends the run on an error. A `policy.rejected` event records it.
- After every action the runner checks the goal. When it holds, the run ends as reached (with `confirmationGrace` set, it goes on a few more actions if nothing the user heard said so); you do not need to return `stop: 'success'`.
- Sensitive input values are masked in `observation.speech` and in the title before your policy sees them. After text entry, the typing step's echo is withheld (`[typed input withheld]`).
- The run's `maxSteps` and `timeoutMs` still apply to your policy.

The intents the simulated VoiceOver offers are `next`, `previous`, `readCurrent`, `readFocused`, `activate`, `heading.next`, `heading.previous`, `form.next`, `form.previous`, `link.next`, `link.previous`, `headings.list`, `links.list` and `formControls.rotor`. A run profile can narrow them. Use `allowedActions` at run time rather than hard-coding the list.

### Ready-made policies

| Name | From | What it does |
| --- | --- | --- |
| `ScriptedPolicy` | `rawstep`, `rawstep/policy` | Plays a fixed list of decisions, then stops as `stuck` with the rationale "Script exhausted." For tests and replays. |
| `loadPolicy(path, { fresh? })` | `rawstep`, `rawstep/policy` | Imports a JavaScript module and returns its default (or named `policy`) export, which must have a `decide` function. It runs trusted local code. `fresh: true` loads a new instance each time. |
| `OrchestratedSpeechPolicy` | `rawstep`, `rawstep/policy` | The policy `rawstep run` uses: it takes a `Planner`, keeps the plan document and carries out each task as written. See [planning](../planning.md). |
| `FixedPlanner` | `rawstep/policy` | A `Planner` that always returns the plan you give it (a plan file). |
| `LlmPlanner` | `rawstep` | A `Planner` backed by a language model. |

### Example: a small policy

This policy walks item by item until it hears the button, then presses it. It gives up after 20 moves.

```js
// my-policy.mjs
export default {
  decide({ observation, history, allowedActions }) {
    if (history.length >= 20) return { stop: 'stuck', rationale: 'Gave up after 20 moves.' };
    const heardButton = observation.speech.some(line => /add to cart/i.test(line));
    if (heardButton && allowedActions.intents.includes('activate')) {
      return { action: { kind: 'intent', intent: 'activate' }, rationale: 'Heard the button, press it.' };
    }
    if (allowedActions.intents.includes('next')) return { action: { kind: 'intent', intent: 'next' } };
    return { stop: 'stuck', rationale: 'This screen reader has no way to move to the next item.' };
  },
};
```

Run it on the demo page from `rawstep init`, on the simulated VoiceOver:

```js
// run-my-policy.mjs
import { loadPolicy, runMockVoiceOverTask, extractHints } from 'rawstep';

const trace = await runMockVoiceOverTask(
  { url: 'rawstep/demo/page.html', goal: 'Add the Demo mug to the cart.', verify: { all: [{ textVisible: 'Added to cart' }] } },
  { policy: await loadPolicy('./my-policy.mjs'), outDir: '.rawstep/by-hand/run-1', warn: () => {} },
);
console.log(trace.outcome);
console.log(extractHints(trace).hints.map(hint => `${hint.kind}: ${hint.summary}`));
```

```sh
node run-my-policy.mjs
```

The trace is in `.rawstep/by-hand/run-1`. `outDir` must not already hold a trace, so pick a new folder for each run. Hints, a report and an analysis are not written by the low-level runner; call `writeHints`, `writeReport` and `analyzeSavedTrace` on the folder if you want them (see the [results reference](./results.md)).

### Example: a fixed list of decisions

```js
import { ScriptedPolicy, runMockVoiceOverTask } from 'rawstep';

const policy = new ScriptedPolicy([
  { action: { kind: 'intent', intent: 'next' } },
  { action: { kind: 'intent', intent: 'next' } },
  { action: { kind: 'intent', intent: 'activate' } },
]);
```

The repository's `examples/screen-reader/policy.mjs` is a policy module of the first shape, for `examples/screen-reader/task.json`. See [examples](../../examples/README.md).

### Run a plan from code

A plan file (see [planning](../planning.md)) can be followed without a config:

```js
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { OrchestratedSpeechPolicy, runMockVoiceOverTask } from 'rawstep';
import { FixedPlanner, planFileSchema } from 'rawstep/policy';

const text = await readFile('rawstep/demo/plan.json', 'utf8');
const planner = new FixedPlanner(planFileSchema.parse(JSON.parse(text)), { file: 'rawstep/demo/plan.json', sha256: createHash('sha256').update(text).digest('hex') });
const policy = new OrchestratedSpeechPolicy(planner);
```

Pass `policy` to `runMockVoiceOverTask` as above. `OrchestratedSpeechPolicy` accepts the run rules as options (`maxPlannerCalls`, `stepActionLimit`, `failureLimit`, `noChangeLimit`, `reviewEvery`, `plannerHistoryLimit`, `survey`, `repetitionGuard`, `maxUnchangedTransitions`; `confirmationGrace` is a runner option instead) and `oscillationLimit`, which has no run rule. `rawstep run` passes the profile's rules. Its `planDocument()` method returns the plan as it stands at the end of the run.

## Other pieces you may call

| Task | Call |
| --- | --- |
| Read a saved run | `readTrace(runDir)` (accepts the folder or the `trace.json` path; reads the journal if the run was cut off) |
| Hints for a saved run | `writeHints(runDir, { reference? })`, or `extractHints(trace, { reference?, thresholds? })` |
| Group hints across runs | `aggregateHints(reports)` |
| Rule-based analysis | `analyzeSavedTrace(runDir)` writes `analysis.json` |
| Model-based analysis | `analyzeSavedTrace(runDir, { analyzer: new LlmTraceAnalyzer({ baseURL, model, apiKey }) })` |
| Your own analyzer | An object `{ id, analyze(trace) }` returning `{ summary, findings }` where every finding cites existing event ids; or `loadAnalyzer(modulePath)` |
| Report | `writeReport(trace, analysis, outDir, { hints })` writes `report.html` and `report.json` |

An analysis never changes a run's recorded outcome: `validateAnalysisReport` rejects one that does.
