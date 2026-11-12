# CLI Reference

Complete command-line reference for the `rawstep` binary (`@rawstep/cli`).

---

## 1. Synopsis

```text
rawstep init [--project <dir>]
rawstep ui [--port <port>] [--project <dir>]
rawstep run <task> [--profile <id|name>] [--rule <name>=<value>]...
                   [--repeat <n>] [--parallel <n>] [--note <text>] [--json] [--project <dir>]
                   [--baseline <summary>] [--fail-on <gates>] [--save-summary <file>] [--junit <file>]
rawstep suite [<task>...] [--tag <tag>]... [--profile <id|name>]... [--rule <name>=<value>]...
                   [--repeat <n>] [--parallel <n>] [--note <text>] [--json] [--project <dir>]
                   [--baseline <summary>] [--fail-on <gates>] [--save-summary <file>] [--junit <file>]
rawstep compare <baseline> <batch> [--fail-on <gates>] [--junit <file>] [--json]
rawstep hints <run-dir> [--reference <run-dir>]
rawstep report <run-dir> [--analysis <analysis.json>] [--out <dir>]
rawstep analyze <run-dir> [--llm] [--out <dir>] [--project <dir>]
rawstep doctor [--project <dir>]
rawstep --help | -h
rawstep --version | -v
```

---

## 2. Exit Codes

| Exit Code | Commands | Meaning |
| :---: | :--- | :--- |
| **`0`** | All | Success. For `run` and `suite`, `0` means every run produced a valid measurement (`reached`, `gave-up`, or `mistaken`) and no `--fail-on` gate triggered. |
| **`1`** | All | Runtime error, invalid config/task, failed `doctor` check, or a run terminated with an infrastructure/execution error. |
| **`2`** | All | CLI usage syntax error (`CliUsageError`: unknown command, unknown flag, duplicate non-repeatable flag, invalid value range). |
| **`3`** | `run`, `suite` | No run crashed, but at least one run ended as **`unmeasured`** (stopped by the planner-call limit, `maxSteps`, `timeoutMs`, the repetition guard, a profile that allows no action the plan needs, a model that was unsure, a planner that did not answer in time, a blocked site such as a bot check, or a page environment this computer could not apply). |
| **`4`** | `run`, `suite`, `compare` | One or more `--fail-on` regression gates caught a regression against `--baseline`. |
| **`130`** | `run`, `suite` | Cancelled by `SIGINT` (`Ctrl+C`). Traces written so far are flushed and finalized cleanly. |
| **`143`** | `run`, `suite` | Cancelled by `SIGTERM`. Traces written so far are flushed and finalized cleanly. |

- **Precedence** for `run` and `suite`: a run that ended on an error gives `1`, otherwise a caught `--fail-on` gate gives `4`, otherwise any unmeasured run gives `3`. So `4` never appears when a run errored.
- `--fail-on` without `--baseline` on `run` or `suite` is a usage error (`2`).
- `ui` stops with `0` on `SIGINT` or `SIGTERM`.
- `analyze` exits `1` unless its analysis finished (`completed`).
- `--help` / `-h` anywhere in the arguments prints the usage and exits `0`. `--version` / `-v` works only as the sole argument.

---

## 3. Commands

### `rawstep init`
Writes a starter `rawstep.config.json` (`version: 7`) along with a ready-to-run `demo` task: `rawstep/demo/page.html`, `rawstep/demo/task.json`, and a pre-written plan `rawstep/demo/plan.json`. The config gets two profiles, `written-plan` (follows that plan, no model) and `item-by-item` (no planner yet). Refuses to overwrite an existing `rawstep.config.json`; demo files that already exist are kept.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `--project <dir>` | `string` | `.` | Project directory where `rawstep.config.json` is created. |

---

### `rawstep ui`
Starts the local web dashboard on `127.0.0.1` (`http://127.0.0.1:4318` by default).

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `--port <port>` | `1–65535` | `4318` | Loopback TCP port to listen on. |
| `--project <dir>` | `string` | `.` | Project directory to open. |

---

### `rawstep run <task>`
Runs a single task (by its `id` in `rawstep.config.json` or by a path to a task `.json` file) under one run profile. Saves the batch in `.rawstep/experiments/<batch-id>/` with `summary.json`, and writes `trace.json`, `plan.json`, `plan.md`, `hints.json`, `analysis.json`, and `report.html` in each run's folder.

| Option | Repeatable | Default | Description |
| :--- | :---: | :--- | :--- |
| `<task>` *(positional)* | No | *(Required)* | Task ID in `rawstep.config.json` or path to a task JSON file. |
| `--profile <id\|name>` | No | Task's first profile, or project's first profile | Run profile to execute with. |
| `--rule <name>=<value>` | **Yes** | *(Profile's `runRules`)* | Overrides a `runRules` field for this run only (e.g., `--rule maxPlannerCalls=20 --rule survey=none`). Last entry for a rule wins. See [Configuration Reference](./config.md#35-run-rules-runrules). |
| `--repeat <n>` | No | `1` | Number of repeat runs (`1–100`). Repeats are compared against the fastest run that reached the goal. |
| `--parallel <n>` | No | `machine.parallelRuns` (`1`) | Maximum concurrent browser runs (`1–8`). Tasks using `personCheck` in a launched browser always run one at a time, and so do runs on a native screen reader (one desktop has one screen reader). |
| `--note <text>` | No | *(None)* | Label describing this batch (up to `200` chars), displayed in the dashboard and `summary.json`. |
| `--baseline <summary>` | No | *(None)* | Path to a baseline `summary.json` file or batch folder to compare against. |
| `--fail-on <gates>` | No | `reach` *(when `--baseline` is set)* | Comma-separated regression gates (`reach`, `moves`, `stuck`, `missing`). Requires `--baseline`. Exits with code `4` if a gate triggers. |
| `--save-summary <file>` | No | *(None)* | Also writes this batch's `summary.json` to `<file>` (e.g., to commit as a new baseline). |
| `--junit <file>` | No | *(None)* | Writes JUnit XML test results to `<file>`. |
| `--json` | No | `false` | Prints structured JSON output to `stdout` instead of human-readable text. |
| `--project <dir>` | No | `.` | Project directory containing `rawstep.config.json`. |

---

### `rawstep suite [<task>...]`
Runs multiple tasks as a single batch across one or more profiles.
- If `<task>...` positionals are given, runs those tasks.
- Otherwise, if `--tag <tag>` is given, runs all tasks in `rawstep.config.json` matching any given tag.
- Otherwise, runs every task registered in `rawstep.config.json`.

Accepts all options of `rawstep run`, plus:

| Option | Repeatable | Default | Description |
| :--- | :---: | :--- | :--- |
| `<task>...` *(positionals)* | **Yes** (`0+`) | All tasks (or tagged tasks) | Task IDs or task JSON file paths to run. |
| `--tag <tag>` | **Yes** | *(All tasks)* | Runs tasks carrying any of the specified tags. |
| `--profile <id\|name>` | **Yes** | Each task's `profiles`, or project's first profile | Runs every selected task under each specified profile. |

---

### `rawstep compare <baseline> <batch>`
Compares two saved batches offline (each argument can be a `summary.json` file path or a batch directory path) and prints what changed beyond run-to-run noise.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `<baseline>` *(positional 1)* | `string` | *(Required)* | Baseline `summary.json` file or batch directory. |
| `<batch>` *(positional 2)* | `string` | *(Required)* | Candidate `summary.json` file or batch directory. |
| `--fail-on <gates>` | `string` | `reach` | Comma-separated gates (`reach`, `moves`, `stuck`, `missing`). Exits with code `4` if any specified gate triggers. |
| `--junit <file>` | `string` | *(None)* | Writes JUnit XML comparison results to `<file>`. |
| `--json` | Boolean | `false` | Prints the comparison object as JSON to `stdout`. |

---

### `rawstep hints <run-dir>`
Extracts friction hints from a saved run directory (or `trace.json` path), writes `hints.json` next to the trace, and prints each hint to `stdout`.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `<run-dir>` *(positional)* | `string` | *(Required)* | Path to a saved run directory or its `trace.json`. |
| `--reference <run-dir>` | `string` | *(None)* | Optional reference run directory used to evaluate `slow-run` hints. It also prints which hints are new in this run, gone since the reference, or present in both. |

---

### `rawstep report <run-dir>`
Generates `report.html` and `report.json` from a saved run directory.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `<run-dir>` *(positional)* | `string` | *(Required)* | Path to a saved run directory or its `trace.json`. |
| `--analysis <analysis.json>` | `string` | *(None)* | Path to an `analysis.json` file to include. It is read only when given; `hints.json` next to the trace is read automatically. |
| `--out <dir>` | `string` | `<run-dir>` | Output directory for `report.html` and `report.json`. |

---

### `rawstep analyze <run-dir>`
Runs post-run analysis on a saved run directory and writes `analysis.json` and `hints.json`.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `<run-dir>` *(positional)* | `string` | *(Required)* | Path to a saved run directory. |
| `--llm` | Boolean | `false` | Sends the saved trace events to the project's configured `project.analysis.model` (`LlmTraceAnalyzer`). Without `--llm`, runs the local rule-based analyzer (`deterministicAnalyzer`). |
| `--out <dir>` | `string` | `<run-dir>` | Output directory for `analysis.json`. |
| `--project <dir>` | `string` | `.` | Project directory (used when `--llm` is passed). |

---

### `rawstep doctor`
Checks the local environment and project setup:
1. **Node:** Checks `process.versions.node >= 22.12.0`.
2. **Config:** Parses `rawstep.config.json` (v7).
3. **Tasks:** Validates every task file registered in `rawstep.config.json`.
4. **Profiles:** Checks each profile's planner. A profile with no planner is a warning; a missing connection, a missing API key, or a missing `planFile` fails. A project with no tasks also warns. Then each task is checked under the profiles it runs with (`tasks[].profiles`, or the project's first), with the same check `run` and the dashboard make before a batch starts: an action the screen reader does not support, a plan file that is missing or not a plan, an input name the task lacks. Only what no other line already says is listed.
5. **Browser:** For tasks with `browser.mode` set to `connect`, checks that `machine.browserEndpoint` is set. Then launches and closes the browser Rawstep starts for every other task (`machine.browserExecutablePath` and `machine.proxyServer` applied). When `machine.browserEndpoint` is set, it also connects to that Chrome (`Your Chrome`), so both ways a run can open a browser are checked.
6. **Connections & Keys:** Verifies API keys / agent CLI logins and checks that each configured model ID is reachable at its provider.
7. **Screen Readers:** For profiles using `voiceover` or `nvda`, makes the check a run's start makes (the dashboard's check button makes the same one): the reader fits this operating system and its address is on this computer, an AT Driver server answers at `machine.atEndpoints` (or the reader's default address) and opens a session, and for VoiceOver its cursor can be read. When nothing answers and a start command is saved, the server is started with it and stopped again, as a run does. A reader of another operating system is reported as unable to run here. Skipped when profiles only use the simulation.
