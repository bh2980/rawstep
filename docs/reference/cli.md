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
| `run <task>` | Runs a task, writes the run folders, prints the result. | config, task, a planner |
| `hints <run-dir>` | Writes `hints.json` for a saved run and lists the hints. | a saved run |
| `report <run-dir>` | Writes `report.html` and `report.json` for a saved run. | a saved run |
| `analyze <run-dir>` | Writes `analysis.json` for a saved run. | a saved run; `--llm` also needs an analysis model |
| `doctor` | Checks that a run can start. | nothing |

A project is the folder that holds `rawstep.config.json`. Every command that reads the config takes `--project <dir>` (default: the current directory). The config fields are in the [config reference](./config.md); the files a run writes are in the [results reference](./results.md).

## Writing options

- `--option value` and `--option=value` both work. A value may not start with `--`.
- An option may be given once. The one exception is `--rule`, which may repeat.
- `--json` and `--llm` take no value.
- An unknown command, an unknown option, a single-dash option other than `-h` and `-v`, or a wrong number of positional arguments is a usage error (exit code 2).
- `--project`, `--out`, `--reference` and `--analysis` are resolved from the current directory.

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
  npx rawstep ui                     see the result and add your own tasks

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

If the project has no `rawstep.config.json`, `ui` first does what `init` does (same demo, same `Next:` hints), then starts. It prints `Rawstep dashboard: http://127.0.0.1:<port>` (the address the server reports). The dashboard text is in Korean; screens are named in the docs that use them.

## `rawstep run`

```text
rawstep run <task> [--profile <id|name>] [--rule <name>=<value>]...
                   [--repeat <n>] [--out <dir>] [--json] [--project <dir>]
```

`<task>` is a task id from the config, or the path of a task JSON file. A relative path is resolved from the project folder. See the [task reference](./task.md) for the file format.

| Option | Default | Meaning |
| --- | --- | --- |
| `--profile <id\|name>` | the first profile in the config | The run profile to use, by id or by name. |
| `--rule <name>=<value>` | none | Overrides one run rule for these runs. Repeatable; the last value for a rule wins. |
| `--repeat <n>` | `1` | Runs the task `n` times (1 to 100). The runs are compared with the fastest one that reached the goal. |
| `--out <dir>` | `<project>/.rawstep/runs/<timestamp>-<id>/` | Where to write. One `run-<n>` folder per repeat. |
| `--json` | off | Prints the result object as JSON instead of the text report. |
| `--project <dir>` | `.` | The project folder. |

`--rule` values are read as the rule's type (a number, `true` or `false`, or a word) and checked against the run rules schema. The rules are `repetitionGuard`, `maxUnchangedTransitions`, `confirmationGrace`, `maxPlannerCalls`, `reviewEvery`, `stepActionLimit`, `failureLimit`, `noChangeLimit`, `plannerHistoryLimit` and `survey`. Their meaning, ranges and defaults are in the run rules section of the [config reference](./config.md). A name that is not a rule, a missing value or a value out of range is a usage error that names what is allowed, for example `--rule survey=x is not valid: survey must be one of none, headings.`

Before it starts, `run` checks that the profile can run: it has a planner (a model or a plan file), the model key is set, the actions fit the screen reader, and a native screen reader has a loopback AT Driver address. Any of these failing is an error (exit code 1) and nothing is run. A missing analysis key is not: the runs get the rule-based analysis only, and the text report shows a `note:` line.

### What `run` prints

While it works, `run` prints `Running <task>...` (or `Running <task>, <n> times...`) on stderr. With `--json` that line is left out. The result goes to stdout.

The text report has these parts, in this order:

1. **Conditions.** The profile, the planner (a model name, or `plan file <path>`), the page environment and the screen reader. Warnings follow as `note:` lines.
2. **One block per run.** How the run ended and how many moves it took. Then, when they apply: the error (`Error (<stage>): ...`) for a run that broke; the reason the user gave up and the expectations that give-up rests on; the longest stretch of moves without hearing a goal word; the count of wrong guesses about where something is; how many new plans were written and why; any other run-level hint; and the run folder.
3. **Across the runs.** `Could a first-time user do it?` counts the endings. `Cost of reaching it:` gives the median moves of the runs that reached the goal (with the range when there are several).
4. **Stuck.** Elements that were pressed and did not respond as the user expected, with the runs they appear in.
5. **Page** and **Model** findings: the same hint on the same element across runs. `No findings.` when there are none.
6. Two closing lines: the reminder that stuck places are a judgement, and the commands for details.

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
  .rawstep/runs/2026-11-01T09-00-00-000Z-1a2b3c4d/run-1
Run 2 of 2: reached the goal · 84 moves
  longest without a goal word: 21 moves
  .rawstep/runs/2026-11-01T09-00-00-000Z-1a2b3c4d/run-2

Could a first-time user do it? reached the goal in 1 of 2 runs · gave up 1
Cost of reaching it: 84 moves

Stuck: pressed, and it did not respond as the user expected
  button "Add to cart" · 1 of 2 runs · 1 give-up rest on it
    expected: Pressing Add to cart announces that the item was added

Page
  button "Checkout" · focus-lost · 1 of 2 runs

Stuck places are the user model's judgement: whether the page or the expectation is wrong is for you to decide.
Details: npx rawstep hints <run-dir>, npx rawstep report <run-dir>
```

The ending words in a run line:

| Printed | Meaning |
| --- | --- |
| `reached the goal` | The goal check passed. |
| `gave up` | The user decided nothing they heard left another way to try. |
| `said it was done, but the goal was not reached` | The user said the goal was reached and it was not. |
| `not measured (<why>)` | A limit or a guard ended the run first. `<why>` is one of `planner-call limit`, `max steps`, `time limit`, `repetition guard`, `the model was unsure`, `stopped early`. |
| `ended on an error (says nothing about the page)` | The run broke (browser, model, trace writing). |
| `aborted` | The run was cancelled. |
| `no outcome recorded` | The trace has no outcome. |

### `--json`

`--json` prints the same data the library returns from `runTask`: `conditions`, `warnings`, `runs` (each with `runId`, `outDir`, `outcome` and `hints`) and `findings`. See [api.md](./api.md#runtask) for the fields.

### Cancelling

Ctrl+C (SIGINT) or SIGTERM stops the run, closes the browser and the screen reader, and keeps what was written. `run` prints `Received SIGINT; stopping, keeping the traces written so far.` on stderr. The run that was in progress is saved with an `aborted` outcome. Hints, analysis and report are not written for a cancelled `run`; you can still run `hints`, `report` or `analyze` on the saved folders afterwards.

## `rawstep hints`

```text
rawstep hints <run-dir> [--reference <run-dir>]
```

Reads the saved trace in `<run-dir>`, works out the friction hints and writes `hints.json` next to the trace. `<run-dir>` may also be the path of `trace.json`.

| Option | Meaning |
| --- | --- |
| `--reference <run-dir>` | Compare with another run. A run of at least 1.5 times the reference's steps, and at least 3 more steps, gets a `slow-run` hint. |

It prints a summary line, one line per hint, and the file it wrote:

```text
Hints: <count> · goal reached: yes|no · steps <n>[ · reference <m> steps]
step <steps> · <kind> · <certainty> · <summary>
Wrote <path>/hints.json
```

Hint kinds and sources are in the [results reference](./results.md#hint-kinds). Exit code 0.

## `rawstep report`

```text
rawstep report <run-dir> [--analysis <analysis.json>] [--out <dir>]
```

Writes `report.html` and `report.json` for a saved run. The HTML report has no scripts and loads no remote files.

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

Checks whether a run can start, one line per check. It makes no model calls.

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
| `Profile <name>` | One line per run profile. `ok` with the planner (`plans with <connection> · <model>`, or `follows the plan file <path> (no model)`); `warn` when it has no planner yet; `FAIL` when its plan file is missing. A plan file path with `{task}` in it is not checked here. |
| `Browser` | A headless Chromium launches, or the CDP address in `machine.browserEndpoint` answers. The detail says how to fix a failure. |
| `Key <label>` | One line per API-key connection: the environment variable is set or missing (`ok` also when a connection needs no key). |
| `<label>` (a coding-agent CLI, for example `Claude Code`) | One line per coding-agent CLI connection: it starts and lists its models (its own sign-in pays for calls), or it is not found on this computer, or it needs a sign-in. |
| `Screen reader` | `skip` if every profile uses the simulation. Otherwise, for each native screen reader (`voiceover`, `nvda`) used by a profile, the AT Driver endpoint answers. This checks the protocol connection only; verify real speech on the target host. |

## Exit codes

| Code | When |
| --- | --- |
| `0` | The command finished. For `run`: the runs completed, whether or not the goal was reached, and including runs that ended on an error (the error is in the output). For `doctor`: no `FAIL` line. For `analyze`: the analysis completed. For `ui`: stopped by SIGINT or SIGTERM. |
| `1` | An error: no config, a bad config, an unknown task or profile, a missing key, a profile that cannot run, an unreadable run folder, a `doctor` `FAIL`, a failed `analyze`, or `init` over an existing config. The message is on stderr (`doctor` prints on stdout). |
| `2` | Bad usage: an unknown command or option, a missing value, a wrong number of arguments, `--port` or `--repeat` out of range, an invalid `--rule`. The message is on stderr. |
| `130` | `run` was cancelled by SIGINT. |
| `143` | `run` was cancelled by SIGTERM. |

Rawstep reports friction hints, not pass or fail, so the exit code of `run` never says whether the goal was reached. In a script, read the printed result, `--json`, or call [`runTask`](./api.md#runtask) from your test runner and apply your own threshold.

## Environment variables and files

| Name | Used by | Meaning |
| --- | --- | --- |
| `RAWSTEP_OPENAI_API_KEY`, `RAWSTEP_ANTHROPIC_API_KEY`, `RAWSTEP_GOOGLE_API_KEY`, `RAWSTEP_OPENROUTER_API_KEY` | `run`, `analyze --llm`, `doctor` | The key of that provider's connection. A custom connection names its own variable in the config (`apiKeyEnv`). Coding-agent CLI connections need none. |
| `RAWSTEP_AT_DRIVER_COMMAND` | `run`, dashboard runs | The command that starts the AT Driver server when none answers. Only for a native screen reader. See [screen readers](../screen-readers.md). |
| `PATH` | `init`, `ui` | Searched for `claude`, `codex`, `opencode` and `grok` to name a coding-agent CLI in the `Next:` hints. |

Each value is read from `<project>/.env.local` first, then from the process environment. `.env.local` is never part of `rawstep.config.json`; keep it out of git, as well as `.rawstep/` (run output).

## Where `run` writes

By default `<project>/.rawstep/runs/<timestamp>-<id>/run-<n>/`, where `<timestamp>` is the start time (for example `2026-11-01T09-00-00-000Z`) and `<id>` is eight random characters. With `--out <dir>`, `<dir>/run-<n>/`. A run folder is never silently replaced: `run` refuses to write into a folder that already holds a trace. See the [results reference](./results.md) for the files.
