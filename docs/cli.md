# Command line

The `rawstep` executable reads [`rawstep.config.json`](./config.md) in the project directory. The dashboard, the CLI and the `runTask` library function share that file. Use `rawstep --help` for the usage text.

## Commands

| Command | Purpose |
|---|---|
| `rawstep init [--project <dir>]` | Write a default `rawstep.config.json` (one model combo, one action set, one page environment and one assistive technology; no connections or tasks). An existing file is never overwritten. |
| `rawstep ui [--port <port>] [--project <dir>]` | Serve the dashboard on `127.0.0.1` (default port 4318). Creates the config file if it is missing. |
| `rawstep run <task> [options]` | Run a task under experiment conditions (model combo, action set, page environment, assistive technology) and print the conditions, each run's outcome and the findings across runs. |
| `rawstep hints <run-dir> [--reference <run-dir>]` | List the places worth a look in a saved run and write `hints.json`. |
| `rawstep report <run-dir> [--analysis <analysis.json>] [--out <dir>]` | Write `report.html` and `report.json`. |
| `rawstep analyze <run-dir> [--llm] [--out <dir>] [--project <dir>]` | Without `--llm`, the local rule-based summary with no network access. With `--llm`, the saved events (PNG bytes are omitted) go to the project's analysis model (`project.analysis.model`). Also writes `hints.json`. |
| `rawstep doctor [--project <dir>]` | Check Node, that the config parses, that a browser can launch, that the key variable of each connection is set (the value is never printed) and, for each `voiceover` or `nvda` assistive technology in the config, that its AT Driver endpoint answers. Exits 1 if a check fails. |

`--project` selects the project directory; the default is the current directory.

## run

```sh
rawstep run <task> [--preset <id|name>] [--combo <id|name>] [--actions <id|name>] [--environment <id|name>]
                   [--at <id|name>] [--mode keyboard|screenreader] [--rule <name>=<value>]... [--diagnose-stop]
                   [--repeat <n>] [--out <dir>] [--json] [--project <dir>]
```

`<task>` is a task id from `rawstep.config.json` or a path to a task JSON file (see [task files](./task.md)). Relative paths resolve from the project directory. A file that is not registered in the config runs with the first shared item of each condition. The executor of the combo for the mode decides each step (with a planner too, in screen reader mode, when the combo is planned); a mode without an executor cannot run. To compare models or prompts, compare model combos; to compare what the user may do, compare action sets; to compare page conditions, compare page environments; to compare a simulated and a native screen reader, compare assistive technologies. Each option takes an id or a name. See [experiment conditions](./config.md#experiment-conditions).

| Option | Default |
|---|---|
| `--preset` | The task's preset. A preset fills the conditions it names before the options below apply. |
| `--combo` | The task's model combo, otherwise the preset's, otherwise the first shared combo. Keyboard mode needs an executor with image input and `maxImages` of at least 2; screen reader mode needs one with text input. |
| `--actions` | The task's action set, otherwise the preset's, otherwise the first shared one. |
| `--environment` | The page environment, resolved the same way. |
| `--at` | The assistive technology, resolved the same way. Only screen reader runs use it. |
| `--mode` | `keyboard` |
| `--rule` | None. `--rule <name>=<value>` overrides one [run rule](./config.md#runrules) for these runs, such as `--rule maxReplans=2 --rule survey=headings`. Repeat it for more rules; if a rule is given twice, the last wins. Numbers, `true` or `false`, and the rule's choices are checked as in the config. |
| `--diagnose-stop` | Off. Keyboard mode only: after a run that stopped early, a separate bounded call asks the executor why. Its scores are uncertain hypotheses and never change the outcome. |
| `--repeat` | `1` (at most 100). Each repeat is compared with the fastest repeat that reached the goal. |
| `--out` | `<project>/.rawstep/runs/<timestamp>-<id>/`, with one `run-<n>/` directory per repeat. |

`--rule` overrides the run rules for these runs only (project defaults, then the preset's, then the task's, then these). Rules you do not override are set in the config or the dashboard.

### Output

The conditions come first (`Conditions: <combo> (solo · executor … | planned · planner … → executor …)` and the action set, page environment and assistive technology), followed by notes such as a planner that keyboard mode does not use. Then each run prints one line, such as `Run 1 of 2: goal reached · 7 steps`. The other forms are `goal not reached (reason)`, `inconclusive` and `no outcome recorded`. Run-level hints and the run directory follow. After all runs, findings are grouped under `Page`, `Run` and `Model`. Each line reads `<role "name"> · <kind> · <n> of <N> runs`.

`--json` prints `{ conditions, warnings, runs: [{ runId, outDir, outcome, hints }], findings }` instead. Hints are friction signals: they point at steps worth a human look and are not a verdict. See [reports](./report.md).

### Run directory

Each `run-<n>/` directory contains `trace.json` (with `trace.jsonl` and `blobs/`), `hints.json`, `analysis.json`, `report.html` and `report.json`. `analysis.json` holds the rule-based analysis, which always runs after a run; when the combo or the project has an analysis model, an LLM analysis is added (without its key the runs get the rule-based analysis only and a note says so). A run of a planned combo also writes `plan.json` and `plan.md`, the final plan document (see [planner and executor](./config.md#planner-and-executor-orchestration)). Screen reader runs also save a reference screenshot per step as `diagnostics/step-<n>.png` for people to look at; the model never sees them.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | The runs completed, whether or not the goal was reached. |
| 1 | An error: no config, a model combo without an executor for the mode, an unsupported action or condition, a missing key, an old config version or a failed run. |
| 2 | Invalid usage. |
| 130, 143 | Cancelled by SIGINT or SIGTERM. Traces written so far are kept. |

A forced kill cannot clean up or finalize a trace. Use a fresh `--out` directory to keep earlier evidence.

## Credentials

Each connection's provider keeps its key in an environment variable (`RAWSTEP_OPENAI_API_KEY`, `RAWSTEP_TYPESAFE_API_KEY`, ...; see [config](./config.md)); a `custom` connection names its own with `apiKeyEnv`. The value is read from the process environment or from `.env.local` in the project directory; the dashboard writes `.env.local` with mode 0600. Keys never appear in the config, traces or reports. Do not commit `.env.local`. See `.env.example`.

## Privacy

Screenshots can expose private page content. The model receives pixels, the goal, named input keys and the action history. It never receives the DOM or verifier results. Saved traces redact input values. A remote model receives these screenshots, so choose the provider with that in mind.

## Library

```ts
import { runTask } from 'rawstep';
```

`runTask(task, options?)` takes the same inputs and uses the same defaults as `rawstep run`. Options are `projectDir` (default: the current directory), the conditions `preset`, `combo`, `actionSet`, `pageEnvironment` and `atEnvironment`, `runRules` (overrides for these runs), `diagnoseStop`, `mode`, `repeat`, `outDir`, `signal` and `onEvent`. It resolves with `{ conditions, warnings, runs, findings }` once the runs complete, whatever the outcome. `hints.goalReached` and `hints.steps` describe each run. It rejects with `ProjectError` (exported, with a `.code`) on setup problems and on cancellation. The [README](../README.md#quick-start) has a test example. The native runner is available as `import { runTask } from 'rawstep/runner'`.
