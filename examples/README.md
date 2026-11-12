# Examples

This folder holds small task files that run against the pages in [`fixtures/`](../fixtures), plus a few files for library use. It answers: what does each file show, and how do I run it. For writing your own task file, see the [task reference](../docs/reference/task.md). To run tasks like these in CI and compare each pull request with a saved baseline, see [Using Rawstep in CI](../docs/ci.md).

Every task here uses a relative `url` such as `../../fixtures/simple-cta.html`. A task's relative URL is resolved against the task file's own folder, so run a file where it is, or copy the `fixtures/` folder with it and keep the same relative path. The `rawstep` package ships `examples/` and `fixtures/` side by side.

## Run an example

The tasks need a run profile that can plan. The demo profile "Written plan (no model)" follows a plan written for the demo page only, so it does not fit these pages. Use a profile with a planner (a model on a connection; see [Getting started](../docs/getting-started.md)), or the plan files that come with the examples ([below](#run-an-example-without-a-model)).

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

`item-by-item` is the profile `init` writes without a planner. Give it one in `npx rawstep ui` (Run profiles) before it can run. Results are saved as a batch under the project's `.rawstep/experiments/`, and `npx rawstep ui` lists it.

## Run an example without a model

Each task in `tasks/` and `api/` has a plan written beforehand in [`plans/`](./plans), under the same file name. A run profile whose planner is that plan file needs no model and ends the same way every time. Add one to the `profiles` in your `rawstep.config.json`:

```json
{
  "id": "example-plans",
  "name": "Example plans (no model)",
  "planner": { "planFile": "node_modules/rawstep/examples/plans/{task}.json" },
  "actions": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": true, "replaceText": true }
}
```

```sh
npx rawstep run node_modules/rawstep/examples/tasks/settings-dialog.json --profile example-plans
```

`{task}` is the task file's name without `.json`. A written plan is a first-time user's first guess and never changes during the run, so where it fails it gives up; a model revises its plan and may get further. The table below gives both.

## `tasks/`: what each page shows

The first five pages are a button or a form that works. The next six each show one situation, and between them use every kind of completion rule the [task reference](../docs/reference/task.md#6-independent-verification-rules-verifyall) lists.

| File | What it shows | Completion rules | How it ends |
|---|---|---|---|
| [`simple-cta.json`](./tasks/simple-cta.json) | The smallest task: find the "Get started" button on a plain page, press it, and see the result message. Good first run. | `textVisible`, `titleIncludes` | Reached. |
| [`bad-focus.json`](./tasks/bad-focus.json) | A page with noise before the target: two links and a focusable box that does nothing come before the "Buy now" button. Shows how detours before the goal are counted. | `textVisibleExact`, `titleIncludes` | Reached. |
| [`email-login.json`](./tasks/email-login.json) | Typing a named input: the email goes into a field, then "Send magic link" is pressed. The value is in the task's `input`, so the planner sees only the input's name. | `textVisible`, `textVisibleExact`, `titleIncludes` | Reached. |
| [`login.json`](./tasks/login.json) | Two named inputs, email and password, then "Sign in". The password is a secret: it is never shown to the planner or written to the trace. | `textVisible`, `titleIncludes` | Reached. |
| [`search.json`](./tasks/search.json) | A multi-step flow: type a query, press Search, then press the button inside the "Passport2" result. Results appear in a live region. | `textVisibleExact`, `titleIncludes` | Reached. |
| [`checkout-steps.json`](./tasks/checkout-steps.json) | Three pages, each a real page load: cart, shipping, order placed. The check also asks that the shipping page was passed through and that express delivery was not picked. | `urlIncludes`, `event` (navigation), `not`, `textVisible` | Reached. |
| [`settings-dialog.json`](./tasks/settings-dialog.json) | A modal that behaves: opening it moves focus in, saving closes it and gives focus back to the button that opened it. The check asks for that focus, for the checkbox having been ticked, and for the dialog being gone. | `focused`, `event` (state), `not`, `textVisible` | Reached, with no focus finding. |
| [`quiet-cart.json`](./tasks/quiet-cart.json) | "Add to cart" changes the cart count at the top of the page and says nothing. The check passes on what the page shows, so the goal is reached, but the user never heard it. | `textVisible` | Reached, not confirmed: the press said nothing the plan expected. |
| [`missing-invoice.json`](./tasks/missing-invoice.json) | The task asks for something the page does not offer: an invoice for an order. Either of two outcomes would count as done; neither can happen. | `any` | Gave up. |
| [`newsletter.json`](./tasks/newsletter.json) | The form needs a box ticked that comes after its Subscribe button, and its error is only shown, not announced. | `domEventSeen`, `not`, `textVisible` | Written plan: gave up after pressing Subscribe. A model: reached after a detour, with Subscribe listed as a stuck place. |
| [`remove-item.json`](./tasks/remove-item.json) | A page that says it did something it did not: "Remove Demo mug" announces "Demo mug removed" and leaves the mug in the cart. | `script` | A model: said it was done, but the goal was not reached (`mistaken`). Written plan: gave up. |

The fourth ending, not measured, needs no page of its own: copy a task with a low `maxSteps` (3, for `checkout-steps.json`) and the run stops at the limit before the user could finish.

The model results above are from one run each with one model; another model, or another run, can end differently.

## `api/`: a completion check that reads network traffic

A page loaded from a file sends no requests, so this example brings a small server. [`server.mjs`](./api/server.mjs) serves a product page and answers `POST /api/cart` with `201`.

| File | What it shows | Completion rules | How it ends |
|---|---|---|---|
| [`api-cart.json`](./api/api-cart.json) | "Add to cart" must send the request, get `201` back, and say so: the check reads the request, the response and what the screen reader announced after the press. | `requestSeen`, `responseSeen`, `activatedAnnouncementIncludes` | Reached. |

```sh
node node_modules/rawstep/examples/api/server.mjs          # leave it running
npx rawstep run node_modules/rawstep/examples/api/api-cart.json --profile example-plans
```

## `profiles/`: one task under different page environments

| File | What it shows |
|---|---|
| [`task.json`](./profiles/task.json) | A task on `fixtures/environment-lab.html` ("Finish task"), for comparing page environments. |

To compare environments, make one run profile per environment in `rawstep.config.json` that differ only in `page` (built-in names such as `reflow-text`, `forced-colors`, `contrast`, `reduced-motion`, `spacing`; the full list is in the [config reference](../docs/reference/config.md#page-environments)) and share the same planner. Then run the same task once per profile:

```sh
npx rawstep run node_modules/rawstep/examples/profiles/task.json --profile default
npx rawstep run node_modules/rawstep/examples/profiles/task.json --profile reflow-text
npx rawstep run node_modules/rawstep/examples/profiles/task.json --profile forced-colors
```

`--profile` takes a run profile's id or name, so those three must exist in your config. A task run in a text-enlargement or narrow-viewport profile is not a native zoom result.

## `screen-reader/`: the simulated and the native screen reader, and a custom policy

| File | What it shows |
|---|---|
| [`mock-task.json`](./screen-reader/mock-task.json) | "Activate Save twice" on `fixtures/mock-voiceover-system.html`, a page whose title changes after the second press. Run it with a profile whose screen reader is `simulation`. |
| [`task.json`](./screen-reader/task.json) | "Find and activate the Get started button" on `fixtures/simple-cta.html`. Meant for a profile whose screen reader is `voiceover` (macOS) or `nvda` (Windows) through an AT Driver server ([Screen readers](../docs/screen-readers.md)); it runs on the simulation too. |
| [`policy.mjs`](./screen-reader/policy.mjs) | A small hand-written decision policy (`decide(...)`) for `task.json`. It acts only through screen reader intents, as a screen reader user would: `next` until the speech names "Get started", then `activate`, then it stops and leaves the verdict to the completion check. It stops as stuck after 20 steps, or when the profile allows no `next`. No model or API key. A library example, not a production policy. |

`policy.mjs` is for calling the runner from code, not for `rawstep run`, which always follows a plan. It needs only `next` and `activate`, so it runs under the default actions on every screen reader. Load it with `loadPolicy` and pass it to `runMockVoiceOverTask` (from `rawstep`) or `runWithPolicy` (from `rawstep/runner`). The task file's relative `url` must be resolved against its own folder, for example with `resolveTask` from `rawstep`:

```js
// in a project that has rawstep installed
import { readFile } from 'node:fs/promises';
import { loadPolicy, resolveTask, runMockVoiceOverTask } from 'rawstep';

const dir = 'node_modules/rawstep/examples/screen-reader';
const task = resolveTask(JSON.parse(await readFile(`${dir}/task.json`, 'utf8')), dir);
const trace = await runMockVoiceOverTask(task, { policy: await loadPolicy(`${dir}/policy.mjs`), outDir: '.rawstep/policy-example/run-1', warn: () => {} });
console.log(trace.outcome);
```

`outDir` must not already hold a trace. See the [API reference](../docs/reference/api.md#writing-your-own-policy).
