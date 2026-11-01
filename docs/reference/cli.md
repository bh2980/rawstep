# CLI reference

This page is for anyone running `rawstep` from a shell or a CI job. It lists every command, its options, what it prints and the exit codes. For a walk-through of the first run, see [getting started](../getting-started.md).

```sh
npx rawstep --help        # the usage text (also: -h, or any command with --help)
npx rawstep --version     # the package version (also: -v; only when it is the only argument)
```

`rawstep` with no arguments prints the usage text and exits 0.

## Commands at a glance

| Command | What it does | Needs |
| --- | --- | --- |
| `init` | Writes `rawstep.config.json` and a demo you can run at once. | nothing |
| `ui` | Starts the dashboard. | nothing (creates the demo in an empty folder) |
| `run <task>` | Runs a task, saves the runs as a batch, prints the result. | config, task, a planner |
| `suite [<task>...]` | Runs several tasks under one or more profiles as one batch, prints each task's result. | config, tasks, a planner |
| `hints <run-dir>` | Writes `hints.json` for a saved run and lists the hints. | a saved run |
| `report <run-dir>` | Writes `report.html` and `report.json` for a saved run. | a saved run |
| `analyze <run-dir>` | Writes `analysis.json` for a saved run. | a saved run; `--llm` also needs an analysis model |
| `doctor` | Checks that a run can start. | nothing |

A project is the folder that holds `rawstep.config.json`. Every command that reads the config takes `--project <dir>` (default: the current directory). The config fields are in the [config reference](./config.md); the files a run writes are in the [results reference](./results.md). Runs from `run` and `suite` are saved as a batch that `rawstep ui` lists, so the CLI and the dashboard show the same history.

## Writing options

- `--option value` and `--option=value` both work. A value may not start with `--`.
- An option may be given once. The exceptions are `--rule` and `--tag`, which may repeat, and `--profile` on `suite`, which may repeat too.
- `--json` and `--llm` take no value.
- An unknown command, an unknown option, a single-dash option other than `-h` and `-v`, or a wrong number of positional arguments is a usage error (exit code 2).
- `--project`, `--out` (of `report` and `analyze`), `--reference` and `--analysis` are resolved from the current directory.

## Using it in CI

Rawstep reports friction hints, not pass or fail, so the exit code of `run` and `suite` does not say whether the goal was reached. It says whether every run gave a measurement.

| Code | When |
| --- | --- |
| `0` | The command finished. For `run` and `suite`: every run gave a measurement. The user reached the goal, gave up, or said it was done but the goal was not reached. For `doctor`: no `FAIL` line. For `analyze`: the analysis completed. For `ui`: stopped by SIGINT or SIGTERM. |
| `1` | An error: no config, a bad config, an unknown task or profile, a missing key, a profile that cannot run, any `run` or `suite` run that ended on an error (the result is still printed, with the error), an unreadable run folder, a `doctor` `FAIL`, a failed `analyze`, or `init` over an existing config. The message is on stderr (`doctor` prints on stdout). |
| `2` | Bad usage: an unknown command or option, a missing value, a wrong number of arguments, `--port`, `--repeat` or `--parallel` out of range, an invalid `--rule`. The message is on stderr and nothing is run. |
| `3` | For `run` and `suite`: no run ended on an error, but at least one was not measured. It hit a limit (steps, time, planner calls), the repetition guard, a bot check or access block, a planner that did not answer in time, a page environment this computer could not apply, or the model was unsure. |
| `130` | `run` or `suite` was cancelled by SIGINT. |
| `143` | `run` or `suite` was cancelled by SIGTERM. |

A run that ended on an error says nothing about the page, and a run that was not measured says nothing about the user, so a script must not read either as a result. When both happen in one command, the exit code is 1. To treat "not measured" as acceptable, accept 0 and 3. In a script, read the printed result, `--json`, or call [`runSuite`](./api.md#runsuite) from your test runner and apply your own threshold.

The pattern for CI is one `suite` over the tasks you care about:

```sh
npx rawstep suite --tag checkout --repeat 3 --parallel 2 --note "build $GITHUB_SHA"
```

This runs every task tagged `checkout` three times under each task's usual profiles (the first profile if it lists none), two runs at a time, and saves them as one batch in `.rawstep/experiments/`. Keep that folder as a CI artifact if you want to open the runs afterwards in `npx rawstep ui`. Start with a `--parallel` of 2 to 4: see [Runs at the same time](#runs-at-the-same-time).

## `rawstep init`

```text
rawstep init [--project <dir>]
```

Writes `rawstep.config.json` (version 7) and a demo in `rawstep/demo/`: `page.html`, `task.json` and `plan.json`. The config has one task, `demo`, and two run profiles: "Written plan (no model)", which follows `plan.json`, and "Item by item", which has no planner yet. No model is connected.

| Option | Default | Meaning |
| --- | --- | --- |
| `--project <dir>` | `.` | The folder to write into. It is created if missing. |

An existing `rawstep.config.json` is never overwritten: `init` stops with `rawstep.config.json already exists in <dir>; it was not overwritten.` and exit code 1. Demo files that already exist are kept.

It prints:

```text
Created <path>/rawstep.config.json and a demo task in rawstep/demo/.

Next:
  npx rawstep run demo               the demo task on a plan written beforehand (no model, no key)
  npx rawstep ui                     run tasks and read results in the dashboard

For a first-time screen reader user planned by a model, the "Item by item" profile needs one: in `npx rawstep ui`, Settings > AI connections.
A coding-agent CLI you are signed in to (Claude Code, Codex, opencode, Grok) needs no API key.

Commit rawstep.config.json and rawstep/. Keep .env.local (API keys) and .rawstep/ (run output) out of git.
```

If `claude`, `codex`, `opencode` or `grok` is on `PATH`, the line about coding-agent CLIs is replaced by `<name> is installed on this computer: it plans on its own sign-in, with no API key.` Being on `PATH` does not mean it is signed in. `init` never connects a model for you.

## `rawstep ui`

```text
rawstep ui [--port <port>] [--project <dir>]
```

Starts the dashboard on `127.0.0.1` and waits until it receives SIGINT or SIGTERM (Ctrl+C), then closes it and exits 0.

| Option | Default | Meaning |
| --- | --- | --- |
| `--port <port>` | `4318` | An integer from 1 to 65535. |
| `--project <dir>` | `.` | The project the dashboard edits and runs. |

If the project has no `rawstep.config.json`, `ui` first does what `init` does (same demo, same `Next:` hints), then starts. It prints `Rawstep dashboard: http://127.0.0.1:<port>` (the address the server reports). The dashboard is in English and Korean: it follows the browser's language (Korean for any `ko` preference, English otherwise), and the language switch in its top bar changes it.

## `rawstep run`

```text
rawstep run <task> [--profile <id|name>] [--rule <name>=<value>]...
                   [--repeat <n>] [--parallel <n>] [--note <text>] [--json] [--project <dir>]
```

`<task>` is a task id from the config, or the path of a task JSON file. A relative path is resolved from the project folder. See the [task reference](./task.md) for the file format.

| Option | Default | Meaning |
| --- | --- | --- |
| `--profile <id\|name>` | the task's first usual profile, else the first profile in the config | The run profile to use, by id or by name. A task file has no profile of its own; a registered task can list the profiles it usually runs with (`profiles` in [config](./config.md#tasks)). |
| `--rule <name>=<value>` | none | Overrides one run rule for these runs. Repeatable; the last value for a rule wins. |
| `--repeat <n>` | `1` | Runs the task `n` times (1 to 100). The runs are compared with the fastest one that reached the goal. |
| `--parallel <n>` | `machine.parallelRuns` (1) | How many runs go at once (1 to 8). See [Runs at the same time](#runs-at-the-same-time). |
| `--note <text>` | none | What this batch is for, up to 200 characters, for example `made Add to cart a button`. The dashboard shows it with the batch. |
| `--json` | off | Prints the result object as JSON instead of the text report. |
| `--project <dir>` | `.` | The project folder. |

`--rule` values are read as the rule's type (a number, `true` or `false`, or a word) and checked against the run rules schema. The rules are `repetitionGuard`, `maxUnchangedTransitions`, `confirmationGrace`, `maxPlannerCalls`, `reviewEvery`, `stepActionLimit`, `failureLimit`, `noChangeLimit`, `plannerHistoryLimit` and `survey`. Their meaning, ranges and defaults are in the run rules section of the [config reference](./config.md). A name that is not a rule, a missing value or a value out of range is a usage error that names what is allowed, for example `--rule survey=x is not valid: survey must be one of none, headings.`

Before it starts, `run` checks that the profile can run: it has a planner (a model or a plan file), the model key is set (a `RAWSTEP_*` variable, or the provider's standard one such as `OPENAI_API_KEY`), the actions fit the screen reader, and a native screen reader has a loopback AT Driver address. Any of these failing is an error (exit code 1) and nothing is run. A missing analysis key is not: the runs get the rule-based analysis only, and the text report shows a `note:` line.

### What `run` prints

While it works, `run` prints `Running <task>...` (or `Running <task>, <n> times...`) on stderr. With `--json` that line is left out. The result goes to stdout.

The text report has these parts, in this order:

1. **Conditions.** The profile, the planner (a model name, or `plan file <path>`), the page environment and the screen reader. Warnings follow as `note:` lines.
2. **One block per run.** How the run ended and how many moves it took. Then, when they apply: the error (`Error (<stage>): ...`) for a run that broke; the reason the user gave up and the expectations that give-up rests on; the longest stretch of moves without hearing a goal word; the count of wrong guesses about where something is; how many new plans were written and why; any other run-level hint; and the run folder (a folder inside the batch).
3. **Across the runs.** `Could a first-time user do it?` counts the endings. `Cost of reaching it:` gives the median moves of the runs that reached the goal (with the range when there are several).
4. **Stuck.** Elements that were pressed and did not respond as the user expected, with the runs they appear in.
5. **Page** and **Model** findings: the same hint on the same element across runs. `No findings.` when there are none.
6. Two closing lines: the reminder that stuck places are a judgement, and the commands for details (or the batch in `npx rawstep ui`).

The four endings, and "ended on an error", are explained in [concepts](../concepts.md). Runs that ended on an error are not counted in the `Could a first-time user do it?` line.

This is what the formatter prints for two sample runs (one gave up, one reached the goal):

```text
Conditions: Item by item (planner Example model)
  page default · screen reader simulation

Run 1 of 2: gave up · 34 moves
  Why: "Add to cart never says the item was added"
  Rests on A3 "Pressing Add to cart announces that the item was added" · broke at step 17 after pressing button "Add to cart"
  longest without a goal word: 9 moves · wrong guesses about where something is: 0
  new plans: 1 (actions kept failing 1)
  /path/to/project/.rawstep/experiments/3f6c0a52-8d1e-4b7a-9c20-5e1d7a4b9f10/0b8e51c4-6a3f-4d92-b7e1-2c9d84a6f305
Run 2 of 2: reached the goal · 84 moves
  longest without a goal word: 21 moves
  /path/to/project/.rawstep/experiments/3f6c0a52-8d1e-4b7a-9c20-5e1d7a4b9f10/e47a9b13-52cd-4f08-a6b9-71d0c3e8a264

Could a first-time user do it? reached the goal in 1 of 2 runs · gave up 1
Cost of reaching it: 84 moves

Stuck: pressed, and it did not respond as the user expected
  button "Add to cart" · 1 of 2 runs · 1 give-up rest on it
    expected: Pressing Add to cart announces that the item was added

Page
  button "Checkout" · focus-lost · 1 of 2 runs

Stuck places are the user model's judgement: whether the page or the expectation is wrong is for you to decide.
Details: npx rawstep hints <run-dir>, npx rawstep report <run-dir>, or the batch in npx rawstep ui
```

The ending words in a run line:

| Printed | Meaning |
| --- | --- |
| `reached the goal` | The goal check passed. |
| `gave up` | The user decided nothing they heard left another way to try, or a plan file ran out of tasks. |
| `said it was done, but the goal was not reached` | The user said the goal was reached and it was not. |
| `not measured (<why>)` | A limit or a guard ended the run first. `<why>` is one of `planner-call limit`, `the profile allows no action the plan's task needs`, `max steps`, `time limit`, `repetition guard`, `the model was unsure`, `stopped early`. |
| `ended on an error (says nothing about the page)` | The run broke (browser, model, trace writing). |
| `aborted` | The run was cancelled. |
| `no outcome recorded` | The trace has no outcome. |

### `--json`

`--json` prints the same data the library returns from `runTask`: `batch` (`id` and `dir`), `conditions`, `warnings`, `runs` (each with `runId`, `taskId`, `taskName`, `profileId`, `profileName`, `outDir`, `outcome` and `hints`) and `findings`. See [api.md](./api.md#runtask) for the fields.

### Cancelling

Ctrl+C (SIGINT) or SIGTERM stops the runs, closes the browser and the screen reader, and keeps what was written. `run` and `suite` print `Received SIGINT; stopping, keeping the traces written so far.` on stderr. The run that was in progress is saved with an `aborted` outcome. Each trace kept gets `hints.json`, the rule-based `analysis.json` and the report, but no model analysis; run `rawstep analyze --llm` on a folder afterwards if you want one. Then the command prints the cancellation on stderr and exits 130 (SIGINT) or 143 (SIGTERM).

## `rawstep suite`

```text
rawstep suite [<task>...] [--tag <tag>]... [--profile <id|name>]... [--rule <name>=<value>]...
                    [--repeat <n>] [--parallel <n>] [--note <text>] [--json] [--project <dir>]
```

Runs several tasks as one batch. Which tasks:

- the ones you name, each a task id or the path of a task JSON file;
- the ones that have a `--tag` (a task with any of the tags is added to the ones you named);
- every task registered in the config, when you give neither.

Each task runs under every `--profile`. With no `--profile`, each task runs with its own usual profiles (`profiles` on the task in the [config](./config.md#tasks)), or the project's first profile if it lists none. A tag that no task has is an error that lists the tags in the project.

| Option | Default | Meaning |
| --- | --- | --- |
| `--tag <tag>` | none | Adds the tasks that have this tag. Repeatable. Tags are set on [tasks in the config](./config.md#tasks). |
| `--profile <id\|name>` | each task's usual profiles, else the first profile in the config | A run profile, by id or by name. Repeatable, to compare profiles in one batch. When given, every task runs with these profiles. |
| `--rule <name>=<value>` | none | As for [`run`](#rawstep-run). Applies to every run of the batch. |
| `--repeat <n>` | `1` | Runs each task under each profile `n` times (1 to 100). The repeats of one task under one profile are compared with the fastest one that reached the goal. |
| `--parallel <n>` | `machine.parallelRuns` (1) | How many runs go at once (1 to 8). See [Runs at the same time](#runs-at-the-same-time). |
| `--note <text>` | none | What this batch is for, up to 200 characters. The dashboard shows it. |
| `--json` | off | Prints the result object as JSON instead of the text report. |
| `--project <dir>` | `.` | The project folder. |

Before anything runs, `suite` checks every task under every profile as `run` does. If one cannot run (no planner, no key, an action the screen reader lacks), `suite` stops with that error and starts nothing.

### What `suite` prints

While it works, `suite` prints `Running <tasks>...` on stderr (`the tasks tagged <tags>` or `every task` when you named none). With `--json` that line is left out.

The text report has one block per task, and per profile when the batch used more than one:

```text
<task name> · <profile name>: reached the goal in 2 of 3 runs · gave up 1
  cost of reaching it: 41 moves (38–44)
  stuck: button "Add to cart" · 1 of 3 runs
  page findings: 2 (focus-lost 1, missing-name 1)
  error: <first line of the error> (<run folder>)
```

| Line | Meaning |
| --- | --- |
| first line | How the runs ended: the same counts as `Could a first-time user do it?` in `run`. Runs that ended on an error are not counted; they are named after the counts. |
| `cost of reaching it` | The median moves of the runs that reached the goal, with the range when there are several. Left out when none did. |
| `stuck` | One line per element that was pressed and did not respond as the user expected, with the runs it appears in. |
| `page findings` | How many hints are about the page, by kind. |
| `error` | One line per run that ended on an error, with its run folder. |

After the blocks come the totals, `All <n> runs: ...` with the same counts over every run, and `Batch: <folder>`, the batch folder in `.rawstep/experiments/`. For one run in detail, use `rawstep hints <run-dir>` on a folder inside it, or open the batch in `npx rawstep ui`.

### `--json`

`--json` prints what the library returns from [`runSuite`](./api.md#runsuite): `batch`, `warnings`, `runs` and `groups` (one per task under a profile, each with its `runs` and `findings`).

### Exit codes and cancelling

The exit codes are those of `run`, taken over all runs of the batch. Cancelling works as for `run`: what was written is kept.

## Runs at the same time

`--parallel <n>` (or `machine.parallelRuns` in the config) sets how many runs go at once, from 1 to 8. The default is 1. Each run is its own browser.

- Start with 2 to 4. A planner model or a coding-agent CLI can slow down or refuse many calls at once. In one usability test, about ten agent CLI runs at once stalled for minutes.
- Runs of tasks with `browser.personCheck` in a launched browser (see the [task reference](./task.md#browser)) share the kept browser profile (`.rawstep/browser-profile`). Those go one at a time whatever `--parallel` says; the other runs of the batch still go in parallel. A second Rawstep process that needs the profile while another one holds it stops with `browser-profile-busy`. The lock is the file `.rawstep/browser-profile.lock`; a lock left by a process that is gone is taken over.

## Batches and the dashboard

Every `run` and `suite` saves its runs as one batch in `<project>/.rawstep/experiments/<id>/`, in the format the dashboard uses. `rawstep ui` lists these batches, also while it is open: a batch a CLI command is running appears and updates there. See the [results reference](./results.md#where-runs-are-written).

A batch records which process runs it (its process id, the computer, and whether it came from the CLI, the dashboard or the API). While that process is alive, no other process stops it or marks it interrupted: the dashboard shows it and says where it is running, and you stop it where it runs (Ctrl+C in that terminal). A batch whose process is gone is marked interrupted the next time it is listed.

## `rawstep hints`

```text
rawstep hints <run-dir> [--reference <run-dir>]
```

Reads the saved trace in `<run-dir>`, works out the friction hints and writes `hints.json` next to the trace. `<run-dir>` may also be the path of `trace.json`.

| Option | Meaning |
| --- | --- |
| `--reference <run-dir>` | Compare with another run. A run of at least 1.5 times the reference's steps, and at least 3 more steps, gets a `slow-run` hint. |

It prints a summary line, one line per hint, a one-line legend for `observed` and `suspected`, and the file it wrote. A hint that repeated on the same element shows `×<n>` after its kind:

```text
Hints: <count> · goal reached: yes|no · steps <n>[ · reference <m> steps]
step <steps> · <kind>[ ×<n>] · <certainty> · <summary>
observed: recorded directly · suspected: inferred from indirect signals, may be wrong
Wrote <path>/hints.json
```

With `--reference`, the hint lines are sorted into what the other run differs in: `Against the reference run: <a> new, <b> gone, <c> in both`, then `New in this run:`, `Only in the reference run:` (steps are the reference run's) and `In both:` (with how many times each run had it). Hints are matched by kind and element. This says what differs, not which run is better.

Hint kinds and sources are in the [results reference](./results.md#hint-kinds). Exit code 0.

## `rawstep report`

```text
rawstep report <run-dir> [--analysis <analysis.json>] [--out <dir>]
```

Writes `report.html` and `report.json` for a saved run. The HTML report loads no remote files, and its only script is a fixed one that switches between English and Korean.

| Option | Default | Meaning |
| --- | --- | --- |
| `--analysis <analysis.json>` | none | Include an analysis in the report. It must belong to this trace. `report` does not pick up `analysis.json` by itself. |
| `--out <dir>` | the run folder | Where to write the report. |

If the run folder has a valid `hints.json`, the report includes a "Friction hints" section. It prints:

```text
Report: <dir>/report.html
Data: <dir>/report.json
```

## `rawstep analyze`

```text
rawstep analyze <run-dir> [--llm] [--out <dir>] [--project <dir>]
```

Analyses a saved run and writes `analysis.json`. It also rewrites `hints.json` (without a reference run).

| Option | Default | Meaning |
| --- | --- | --- |
| `--llm` | off | Send the saved events to the project's analysis model (`project.analysis.model` in the config). Without it, the analysis is a local, rule-based summary. |
| `--out <dir>` | the run folder | Where to write `analysis.json`. |
| `--project <dir>` | `.` | The project whose analysis model and key `--llm` uses. |

`--llm` fails with an error if the project has no analysis model or its key is not set. The analysis never changes the recorded outcome of the run. It prints:

```text
Analysis: completed|failed
Saved: <dir>/analysis.json
Hints saved: <run-dir>/hints.json
```

Exit code 0 when the analysis is `completed`, 1 when it is `failed`. What the two analyses contain is in the [results reference](./results.md#analysis).

## `rawstep doctor`

```text
rawstep doctor [--project <dir>]
```

Checks whether a run can start, one line per check. It makes no model calls, but it does ask each API provider for its model list (free) to check the key and the model ID, so it needs the network for that.

```text
<status>  <label>: <detail>
```

| Status | Meaning |
| --- | --- |
| `ok` | The check passed. |
| `warn` | Nothing is broken, but something is missing before a run can go. Does not change the exit code. |
| `skip` | Not checked (only the simulation is configured). |
| `FAIL` | The check failed. Makes the exit code 1. |

The checks, in order:

| Label | What is checked |
| --- | --- |
| `Node` | The Node version is 22.12 or newer. |
| `Config` | `rawstep.config.json` parses. The detail counts connections, tasks and run profiles. |
| `Tasks` | `warn` when the config has no tasks. |
| `Task <id>` | One line per registered task: `ok` when its file exists and is a valid task, `FAIL` with the reason when the file is missing, unreadable or not a valid task. One broken task does not stop the other checks, and does not stop you running the other tasks. |
| `Profile <name>` | One line per run profile. `ok` with the planner (`plans with <connection> · <model>`, or `follows the plan file <path> (no model)`); `warn` when it has no planner yet; `FAIL` when it cannot run: its plan file is missing, or its connection's key is not set. A plan file path with `{task}` in it is not checked here. |
| `Browser` | A headless Chromium launches, or the CDP address in `machine.browserEndpoint` answers. The detail says how to fix a failure. |
| `Browser for tasks` | Only when a registered task has `browser.mode` `connect`. `ok` and the task names when `machine.browserEndpoint` is set; `FAIL` when it is empty, because those tasks cannot run. |
| `Key <label>` | One line per API-key connection and model it is used for. A missing variable is `FAIL` (`ok` when a connection needs no key). A key that is set is tried: `ok  Key OpenRouter: OPENROUTER_API_KEY works · model vendor/model listed (1.8 s)` names the variable used and the time taken. `FAIL` says what failed: the key was refused (HTTP 401 or 403), the model is not in the provider's list, the provider did not answer in time or cannot be reached. A network failure is a `FAIL` line, not a crash. |
| `<label>` (a coding-agent CLI, for example `Claude Code`) | One line per coding-agent CLI connection: it starts and lists its models (its own sign-in pays for calls); or its program is not found on `PATH`; or it started but did not answer in time; or it needs a sign-in, which you do with that agent's own CLI (for example run `claude` once and sign in). Antigravity needs its ACP server binary `agy_acp_server.par` on `PATH`; the `agy` CLI alone is not enough, and it signs in from the dashboard's connection check. |
| `Screen reader` | `skip` if every profile uses the simulation. Otherwise, for each native screen reader (`voiceover`, `nvda`) used by a profile, the AT Driver endpoint answers. This checks the protocol connection only; verify real speech on the target host. |

## Environment variables and files

| Name | Used by | Meaning |
| --- | --- | --- |
| `RAWSTEP_OPENAI_API_KEY`, `RAWSTEP_ANTHROPIC_API_KEY`, `RAWSTEP_GOOGLE_API_KEY`, `RAWSTEP_OPENROUTER_API_KEY` | `run`, `suite`, `analyze --llm`, `doctor` | The key of that provider's connection. When the `RAWSTEP_` variable is not set, the provider's standard one is read: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`. A custom connection names its own variable in the config (`apiKeyEnv`). Coding-agent CLI connections need none. |
| `RAWSTEP_AT_DRIVER_COMMAND` | `run`, `suite`, dashboard runs | The command that starts the AT Driver server when none answers. Only for a native screen reader. See [screen readers](../screen-readers.md). |
| `PATH` | `init`, `ui` | Searched for `claude`, `codex`, `opencode` and `grok` to name a coding-agent CLI in the `Next:` hints. |

Each value is read from `<project>/.env.local` first, then from the process environment. `.env.local` is never part of `rawstep.config.json`; keep it out of git, as well as `.rawstep/` (run output).

## Where `run` and `suite` write

`<project>/.rawstep/experiments/<id>/`, where `<id>` is the batch's id (a UUID). It holds `experiment.json`, the record of the batch, and one folder per run, named by the run's id. The `outDir` of each run in the printed result and in `--json` is that folder. A task file that is not registered is kept in the batch under its file name. See the [results reference](./results.md) for the files.
