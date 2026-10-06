# Command line

The `rawstep` executable reads [`rawstep.config.json`](./config.md) in the project directory. The dashboard, the CLI and the `runTask` library function share that file. Use `rawstep --help` for the usage text.

## Commands

| Command | Purpose |
|---|---|
| `rawstep init [--project <dir>]` | Write a default `rawstep.config.json` (one agent and one environment, both named Default; no connections or tasks). An existing file is never overwritten. |
| `rawstep ui [--port <port>] [--project <dir>]` | Serve the dashboard on `127.0.0.1` (default port 4318). Creates the config file if it is missing. |
| `rawstep run <task> [options]` | Run a task with an agent's executor model and print each run's outcome and the findings across runs. |
| `rawstep hints <run-dir> [--reference <run-dir>]` | List the places worth a look in a saved run and write `hints.json`. |
| `rawstep report <run-dir> [--analysis <analysis.json>] [--out <dir>]` | Write `report.html` and `report.json`. |
| `rawstep analyze <run-dir> [--llm] [--out <dir>] [--project <dir>]` | Without `--llm`, the local rule-based summary with no network access. With `--llm`, the saved events (PNG bytes are omitted) go to the project's analysis model (`analysis.model`). Also writes `hints.json`. |
| `rawstep doctor [--project <dir>]` | Check Node, that the config parses, that a browser can launch, that the key variable of each connection is set (the value is never printed) and, for `voiceover` or `nvda`, that the AT Driver endpoint answers. Exits 1 if a check fails. |

`--project` selects the project directory; the default is the current directory.

## run

```sh
rawstep run <task> [--agent <id|name>] [--environment <id|name>]
                   [--mode keyboard|screenreader] [--repeat <n>] [--out <dir>] [--json] [--project <dir>]
```

`<task>` is a task id from `rawstep.config.json` or a path to a task JSON file (see [task files](./task.md)). Relative paths resolve from the project directory. A file that is not registered in the config uses the first agent and the first environment. The agent's executor for the mode decides each step; a mode without an executor cannot run. To compare models or prompts, compare agents; to compare page conditions, compare environments.

| Option | Default |
|---|---|
| `--agent` | The task's agent, otherwise the first agent. Its executor for the mode is used. Keyboard mode needs an executor with image input and `maxImages` of at least 2. |
| `--environment` | The task's environment, otherwise the first environment. |
| `--mode` | `keyboard` |
| `--repeat` | `1` (at most 100). Each repeat is compared with the fastest repeat that reached the goal. |
| `--out` | `<project>/.rawstep/runs/<timestamp>-<id>/`, with one `run-<n>/` directory per repeat. |

### Output

Each run prints one line, such as `Run 1 of 2: goal reached · 7 steps`. The other forms are `goal not reached (reason)`, `inconclusive` and `no outcome recorded`. Run-level hints and the run directory follow. After all runs, findings are grouped under `Page` and `Model`. Each line reads `<role "name"> · <kind> · <n> of <N> runs`.

`--json` prints `{ runs: [{ runId, outDir, outcome, hints }], findings }` instead. Hints are friction signals: they point at steps worth a human look and are not a verdict. See [reports](./report.md).

### Run directory

Each `run-<n>/` directory contains `trace.json` (with `trace.jsonl` and `blobs/`), `hints.json`, `analysis.json`, `report.html` and `report.json`. `analysis.json` holds the rule-based analysis, which always runs after a run; when the project has an analysis model, an LLM analysis is added. Screen reader runs also save a reference screenshot per step as `diagnostics/step-<n>.png` for people to look at; the model never sees them.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | The runs completed, whether or not the goal was reached. |
| 1 | An error: no config, an agent without an executor for the mode, missing key or a failed run. |
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

`runTask(task, options?)` takes the same inputs and uses the same defaults as `rawstep run`. Options are `projectDir` (default: the current directory), `agent` (its executor is used), `environment`, `mode`, `repeat`, `outDir`, `signal` and `onEvent`. It resolves with `{ runs, findings }` once the runs complete, whatever the outcome. `hints.goalReached` and `hints.steps` describe each run. It rejects with `ProjectError` (exported, with a `.code`) on setup problems and on cancellation. The [README](../README.md#quick-start) has a test example. The native runner is available as `import { runTask } from 'rawstep/runner'`.
