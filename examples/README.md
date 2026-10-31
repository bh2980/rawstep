# Examples

This folder holds small task files that run against the pages in [`fixtures/`](../fixtures), plus a few files for library use. It answers: what does each file show, and how do I run it. For writing your own task file, see the [task reference](../docs/reference/task.md).

Every task here uses a relative `url` such as `../../fixtures/simple-cta.html`. A task's relative URL is resolved against the task file's own folder, so run a file where it is, or copy the `fixtures/` folder with it and keep the same relative path. The `rawstep` package ships `examples/` and `fixtures/` side by side.

## Run an example

The tasks need a run profile that can plan. The demo profile "Written plan (no model)" follows a plan written for the demo page only, so it does not fit these pages. Use a profile with a planner (a model on a connection; see [Getting started](../docs/getting-started.md)), or write a plan file for the page.

In a project that has `rawstep` installed:

```sh
npx rawstep init                     # once: writes rawstep.config.json and the demo
npx rawstep doctor                   # shows which profiles can run
npx rawstep run node_modules/rawstep/examples/tasks/simple-cta.json --profile item-by-item
```

Task paths are read relative to the project folder. From a checkout of this repository (after `npm run build`), use a scratch project and an absolute task path:

```sh
mkdir -p "$HOME/rawstep-try"
npm run rawstep -- init --project "$HOME/rawstep-try"
npm run rawstep -- run "$PWD/examples/tasks/simple-cta.json" --profile item-by-item --project "$HOME/rawstep-try"
```

`item-by-item` is the profile `init` writes without a planner. Give it one in `npx rawstep ui` (설정 > 실행 프로필, Settings > Run profiles) before it can run. Results are written under the project's `.rawstep/runs/`.

## `tasks/`: five pages, five kinds of friction

| File | What it shows |
|---|---|
| [`simple-cta.json`](./tasks/simple-cta.json) | The smallest task: find the "Get started" button on a plain page, press it, and see the result message. Good first run. |
| [`bad-focus.json`](./tasks/bad-focus.json) | A page with noise before the target: two links and a focusable box that does nothing come before the "Buy now" button. Shows how detours before the goal are counted. |
| [`email-login.json`](./tasks/email-login.json) | Typing a named input: the email goes into a field, then "Send magic link" is pressed. The value is in the task's `input`, so the planner sees only the input's name. |
| [`login.json`](./tasks/login.json) | Two named inputs, email and password, then "Sign in". The password is a secret: it is never shown to the planner or written to the trace. |
| [`search.json`](./tasks/search.json) | A multi-step flow: type a query, press Search, then press the button inside the "Passport2" result. Results appear in a live region. |

## `profiles/`: one task under different page environments

| File | What it shows |
|---|---|
| [`task.json`](./profiles/task.json) | A task on `fixtures/environment-lab.html` ("Finish task"), for comparing page environments. |
| [`matrix.json`](./profiles/matrix.json) | A list of built-in page environment names (`default`, `reflow-text`, `forced-colors`, `contrast`, `reduced-motion`, `spacing`, `zoom-200`). It is a reference list only: no command reads it. `zoom-200` needs a native browser zoom controller; a profile that asks for it is reported as unsupported instead of being approximated. |
| [`decisions.json`](./profiles/decisions.json) | Four fixed actions (Tab, Tab, Tab, Enter) for `ScriptedPolicy`, in library tests. Not used by the CLI. |
| [`human-evidence.example.json`](./profiles/human-evidence.example.json) | An empty list. Nothing reads it. |

To compare environments, make one run profile per environment in `rawstep.config.json` that differ only in `page` (for example `reflow-text`, `forced-colors`) and share the same planner. Then run the same task once per profile:

```sh
npx rawstep run node_modules/rawstep/examples/profiles/task.json --profile default
npx rawstep run node_modules/rawstep/examples/profiles/task.json --profile reflow-text
npx rawstep run node_modules/rawstep/examples/profiles/task.json --profile forced-colors
```

`--profile` takes a run profile's id or name, so those three must exist in your config. A task run in a text-enlargement or narrow-viewport profile is not a native zoom result.

## `v2/`: the simulated and the native screen reader, and a custom policy

| File | What it shows |
|---|---|
| [`mock-task.json`](./v2/mock-task.json) | "Activate Save twice" on `fixtures/mock-voiceover-system.html`, a page whose title changes after the second press. Run it with a profile whose screen reader is `simulation`. |
| [`task.json`](./v2/task.json) | "Find and activate the Get started button" on `fixtures/simple-cta.html`. Meant for a profile whose screen reader is `voiceover` (macOS) or `nvda` (Windows) through an AT Driver server. See [Screen readers](../docs/screen-readers.md). |
| [`decisions.json`](./v2/decisions.json) | Tab, Tab, Enter, then "stop: success", for `ScriptedPolicy`. A library fixture. |
| [`policy.mjs`](./v2/policy.mjs) | A small hand-written decision policy (`decide(...)`): activates when speech mentions "get started", otherwise presses Tab, gives up after ten steps. Load it with `loadPolicy` from `rawstep`. A library fixture, not a production policy. |

`decisions.json` and `policy.mjs` are for calling the runner from code (`runTask` from `rawstep/runner`, or `runMockVoiceOverTask` from `rawstep/mock-voiceover` with a `policy` option). They press keys directly, which the run profile presets in the dashboard do not allow. They show the policy interface; they are not what a normal run does. See the [API reference](../docs/reference/api.md).
