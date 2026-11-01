# Rawstep

English | [한국어](./README.ko.md)

Rawstep answers one question about a web page: **can a first-time screen reader user complete this task here, and at what cost?**

It tries the task the way such a user would. The simulated user hears only what the screen reader says and moves item by item, or jumps by headings, form controls or links. Rawstep records the run and points at the places where it got slow, took detours or got stuck. Reaching the goal is one signal among these, not a pass or fail verdict.

This README is for anyone deciding whether to try Rawstep. It covers what it measures, a five-minute start and where the other docs are.

## Install

Rawstep is not on npm yet. The intended install is:

```sh
npm i -D rawstep
```

Until it is published, build a local tarball from a checkout (`npm run pack:rawstep` writes `artifacts/rawstep-<version>.tgz`) and install that file. [Getting started](./docs/getting-started.md#install) and [CONTRIBUTING.md](./CONTRIBUTING.md) have the exact steps. You need Node.js 22.12 or newer and a Chromium: Playwright's (`npx playwright install chromium`) or an installed Google Chrome.

## Five-minute start

In an empty folder:

```sh
npx rawstep init      # writes rawstep.config.json and a demo in rawstep/demo/
npx rawstep run demo  # runs the demo task; no model, no API key
npx rawstep ui        # opens the dashboard at http://127.0.0.1:4318
```

The demo is a small shop page, a task ("Add the Demo mug to the cart.") and a plan written by hand. The first run profile, "Written plan (no model)", follows that plan, so the run needs no model. To let a model plan as a first-time user would, connect one under Settings › AI connections in the dashboard. [Getting started](./docs/getting-started.md) walks through it.

## What a run prints

This is the real output of `npx rawstep run demo`:

```text
Running demo...
Conditions: Written plan (no model) (planner plan file rawstep/demo/plan.json)
  page default · screen reader simulation

Run 1 of 1: reached the goal · 7 moves
  longest without a goal word: 2 moves
  <run folder>

Could a first-time user do it? reached the goal in 1 of 1 runs
Cost of reaching it: 7 moves

No findings.

Stuck places are the user model's judgement: whether the page or the expectation is wrong is for you to decide.
Details: npx rawstep hints <run-dir>, npx rawstep report <run-dir>, or the batch in npx rawstep ui
```

A run ends in one of four ways: reached the goal, gave up, said it was done but the goal was not reached, or not measured. Its cost is counted in moves. On a real page the output also lists where pressing something did not respond as the user expected, and what the page did along the way (focus lost, a change nobody announced). [Concepts](./docs/concepts.md) explains each of these.

The run folder holds the trace, the plan the run followed, the hints and an HTML report. Every `run` is saved as a batch in `.rawstep/experiments/`, the same place the dashboard uses, so `npx rawstep ui` shows CLI runs and dashboard runs side by side, per task and per run.

To run many tasks at once, `npx rawstep suite --tag checkout --repeat 3 --parallel 2` runs the tasks with that tag as one batch and prints each task's result. To compare a pull request with a baseline saved from your main branch, and fail the job on a change beyond noise, see [Using Rawstep in CI](./docs/ci.md).

## What Rawstep is not

Rawstep is not an accessibility certification or a conformance test. A run that reaches the goal does not make a page accessible, and a run that gives up does not prove the task is impossible: both are the judgement of a simulated user, and you decide whether the page or the user's expectation was wrong. The default screen reader is a simulation of VoiceOver running on Chromium. It is always labelled `simulation`, and what it says is not evidence of what a real VoiceOver or NVDA says. Runs on a real screen reader go through an AT Driver server; see [Screen readers](./docs/screen-readers.md).

## Documentation

| Doc | What it answers |
|---|---|
| [Getting started](./docs/getting-started.md) | Install, run the demo, connect a model, write your own task and read the results |
| [Concepts](./docs/concepts.md) | Task and run profile, ways of finding things, what the simulated user may know, endings, cost and hints |
| [Using Rawstep in CI](./docs/ci.md) | Save a baseline from your main branch, compare each pull request with it, what counts as noise, a GitHub Actions workflow |
| [Planning](./docs/planning.md) | The plan document, how Rawstep carries it out, when it asks for a new plan, plan files, planner prompts |
| [Screen readers](./docs/screen-readers.md) | Simulated VoiceOver against real VoiceOver and NVDA, AT Driver setup, supported actions, known limits |
| [Config reference](./docs/reference/config.md) | Every field of `rawstep.config.json`, including page environments |
| [Task reference](./docs/reference/task.md) | The task file: goal, completion checks, inputs, navigation scope |
| [CLI reference](./docs/reference/cli.md) | Commands, options, output and exit codes |
| [API reference](./docs/reference/api.md) | `runTask`, `runSuite`, the public import paths and writing your own policy |
| [Results reference](./docs/reference/results.md) | Where batches are saved, the files in a run folder and every hint kind |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Building and testing from source, where code lives, repository rules |
| [Examples](./examples/README.md) | What each example file shows |
| [Simulator internals](./packages/screenreaders/src/mock-voiceover/README.md) | How the simulated VoiceOver speaks, its evidence and its assumptions |
| [AT Driver internals](./packages/screenreaders/src/at-driver/README.md) | Key mapping and rotor routines for real screen readers |
| [Dashboard](./packages/dashboard/README.md) | Dashboard server and API structure ([development rules](./packages/dashboard/AGENTS.md)) |

Licenses for bundled screen reader evidence are in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md). Rawstep itself is under the [MIT license](./LICENSE).
