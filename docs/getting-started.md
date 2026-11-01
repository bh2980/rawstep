# Getting started

This guide is for someone using Rawstep for the first time. It walks one path from an empty folder to results on your own page: install, run the demo, connect a model, write a task, run it and read what came back. Each step shows the command and what you will see. For why the results look the way they do, read [Concepts](./concepts.md).

## Install

You need Node.js 22.12 or newer.

Rawstep is not on npm yet. Once it is, the install will be `npm i -D rawstep`. Until then, use one of these two ways.

**A local tarball (recommended).** In a Rawstep checkout:

```sh
corepack pnpm install --frozen-lockfile
npm run pack:rawstep
```

This builds every workspace and writes `artifacts/rawstep-<version>.tgz` (for version 0.2.0, `artifacts/rawstep-0.2.0.tgz`). The last line it prints is the install command with the absolute path. In your own project:

```sh
npm install /absolute/path/to/rawstep/artifacts/rawstep-0.2.0.tgz
npx rawstep --help
```

**The checkout itself.** Run `npm run build` in the checkout, then call its CLI from your project folder: `node /absolute/path/to/rawstep/packages/cli/dist/cli/bin.js <command>`. Everywhere this guide says `npx rawstep`, use that instead. [CONTRIBUTING.md](../CONTRIBUTING.md) covers building from source.

Rawstep needs a Chromium to run pages in. It uses Playwright's Chromium if one is installed, otherwise an installed Google Chrome. Installing Rawstep downloads neither. If you have neither:

```sh
npx playwright install chromium
```

## 1. Run the demo

In an empty folder:

```sh
npx rawstep init
```

```text
Created <project>/rawstep.config.json and a demo task in rawstep/demo/.

Next:
  npx rawstep run demo               the demo task on a plan written beforehand (no model, no key)
  npx rawstep ui                     run tasks and read results in the dashboard

For a first-time screen reader user planned by a model, the "Item by item" profile needs one: in `npx rawstep ui`, Settings > AI connections.
Claude Code is installed on this computer: it plans on its own sign-in, with no API key.

Commit rawstep.config.json and rawstep/. Keep .env.local (API keys) and .rawstep/ (run output) out of git.
```

The line about Claude Code appears only when a coding-agent CLI is on your `PATH`. Rawstep names it but does not connect it for you.

`init` wrote four files:

| File | What it is |
|---|---|
| `rawstep.config.json` | The project: connections (none yet), two run profiles, one task |
| `rawstep/demo/page.html` | A small shop page with an "Add to cart" button that shows "Added to cart" |
| `rawstep/demo/task.json` | The task: the goal "Add the Demo mug to the cart." and a completion check (the text "Added to cart" is visible) |
| `rawstep/demo/plan.json` | A plan written by hand: walk item by item to the button, then press it |

The two run profiles are "Written plan (no model)", which follows `rawstep/demo/plan.json`, and "Item by item", which has no planner yet. Run the demo:

```sh
npx rawstep run demo
```

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
Details: npx rawstep hints <run-dir>, npx rawstep report <run-dir>
```

With no `--profile`, a run uses the project's first profile. The run folder is `.rawstep/runs/<time>-<id>/run-1/`. Check what can run:

```sh
npx rawstep doctor
```

```text
ok    Node: v24.19.0 (needs >= 22.12)
ok    Config: <project>/rawstep.config.json (0 connections, 1 tasks, 2 run profiles)
ok    Task demo: rawstep/demo/task.json is a valid task
ok    Profile Written plan (no model): follows the plan file rawstep/demo/plan.json (no model)
warn  Profile Item by item: no planner yet, so it cannot run. Pick a model in `npx rawstep ui` (Settings > Run profiles)
ok    Browser: launched
skip  Screen reader: only the simulation is configured; no native screen reader to check
```

The `warn` line is the next step: "Item by item" needs a planner.

## 2. Look at it in the dashboard

```sh
npx rawstep ui
```

It prints `Rawstep dashboard: http://127.0.0.1:4318` and keeps running until you press Ctrl+C. (`--port` picks another port. In a folder with no `rawstep.config.json`, `ui` first writes the same demo as `init`.) The dashboard reads and writes the same `rawstep.config.json` as the CLI.

The dashboard is in English and Korean. It opens in Korean when the browser prefers Korean and in English otherwise; the language switch in the top bar changes it, and the browser remembers the choice. This guide uses the English labels.

The menu has three entries: Tasks, Run history and Settings. The dashboard shows the runs started from it; a run made with `npx rawstep run` stays in its run folder and does not appear here. Open Tasks, then the demo task, and press Run… to run it from the dashboard. Its Overview tab then shows the run under Could a first-time user do it?. Open the run from Run history to see the Plan document and each step: what the screen reader said and where its cursor was.

## 3. Connect a model

A plan file only works for a page you already know. To see what a first-time user would do, a model has to plan from what it hears. That model is reached through a **connection**. There are two kinds:

- **A coding-agent CLI you are signed in to** (Claude Code, Codex, opencode, Grok Build, Antigravity). No API key: calls are paid by that CLI's own sign-in. Claude Code and Codex are reached through an adapter that `npx` downloads on first use, so the first check is slow. opencode and Grok Build use the installed CLI. Antigravity needs its ACP server on your `PATH`.
- **An API** (OpenAI, Anthropic, Google, OpenRouter), or any OpenAI-compatible server such as LM Studio or Ollama (the "custom" provider, with its address). Each preset provider reads its key from a fixed environment variable:

| Provider | Key variable | Also read when it is not set |
|---|---|---|
| OpenAI | `RAWSTEP_OPENAI_API_KEY` | `OPENAI_API_KEY` |
| Anthropic | `RAWSTEP_ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` |
| Google | `RAWSTEP_GOOGLE_API_KEY` | `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` |
| OpenRouter | `RAWSTEP_OPENROUTER_API_KEY` | `OPENROUTER_API_KEY` |
| Custom | a variable you name on the connection, or none | none |

If you already export the provider's standard variable for other tools, Rawstep uses it. `RAWSTEP_*` wins when both are set.

The planner hears what the simulated user hears. With a remote connection, that page text leaves your computer for the provider.

### In the dashboard

1. Settings › AI connections › Add connection.
2. Pick a way: API · LLM, or Coding-agent CLI. Pick the provider. For an API, type the key; it is saved only to `.env.local` in the project.
3. Check connection loads the model list once. It does not call a model.
4. Settings › Run profiles › "Item by item". Under Which AI thinks?, set How to get the plan to LLM planner, then pick the connection and a model. For a coding-agent CLI, model `default` leaves the choice to the CLI. Save.

### By hand

Add a connection to `connections` and point the profile's `planner` at it. For a signed-in Claude Code, set `connections` to:

```json
[{ "id": "claude", "name": "Claude Code", "provider": "claudeCode" }]
```

and add this field to the "Item by item" profile (`"id": "item-by-item"`):

```json
"planner": { "connectionId": "claude", "modelId": "default" }
```

For an API provider, use its provider id (`openai`, `anthropic`, `google`, `openrouter`), a model ID that provider offers, and put the key in `.env.local` in the project folder (or export it):

```sh
RAWSTEP_OPENAI_API_KEY=...
```

Every field is in the [config reference](./reference/config.md).

> **Model IDs.** Type the ID exactly as the provider's model list shows it. OpenRouter IDs are `vendor/model-name`, and the free ones end in `:free` (`vendor/model-name:free`). OpenAI and Anthropic IDs are plain names, and Google's are the names without the `models/` prefix. In the dashboard, Check connection loads the list so you can pick one. `doctor` says `does not list model ...` when an ID is not in the list.
>
> **Free models often hit rate limits.** A `:free` model on OpenRouter, or a free tier elsewhere, may answer with an error or slowly when you ask it for several plans in a row. If a run fails with a rate-limit error from the provider, wait and run again, or try a different model.
>
> **Sign in to a coding-agent CLI with the CLI itself,** then run `doctor` again. Rawstep never signs one in for you, except Antigravity.
>
> | CLI | How to sign in |
> |---|---|
> | Claude Code | run `claude` once and sign in there (`/login`) |
> | Codex | `codex login` |
> | opencode | `opencode auth login` |
> | Grok Build | run `grok` once and sign in there |
> | Antigravity | put `agy_acp_server.par` (not only the `agy` CLI) on your `PATH`, then use the sign-in button in the dashboard's connection check |

### Check and run

```sh
npx rawstep doctor
npx rawstep run demo --profile item-by-item
```

`doctor` now reports the profile as `ok ... plans with <connection> · <model>`. For an API key it asks the provider's model list (no model call, no cost) and prints for example `ok    Key OpenRouter: OPENROUTER_API_KEY works · model vendor/model-name listed (1.8 s)`, or says whether the key was refused, the model is not listed, or the provider did not answer. For a coding-agent CLI it checks that the CLI starts and is signed in. The run now has a planner model: it writes a plan from what it hears and Rawstep carries the plan out. The result can differ from the written plan's 7 moves, and from one run to the next. Add `--repeat 3` to see the spread.

> **A model can take tens of seconds to write one plan,** and a run asks for several, so a first run with a model is slow compared with the written plan. That is normal. A run can also end as "not measured" because the planner did not answer in time. Pick a faster model or raise the connection's `timeoutMs` (a time limit for one model call) if that keeps happening.

## 4. Make your own task

A task says what to do: a start address, a goal and a completion check. It holds nothing about how to do it; that is the run profile's job.

**In the dashboard:** Tasks › New task. Fill in Start address (an `https://` address, or an HTML file in the project), Goal and Completion check, then Create. The dashboard saves the file under `tasks/` and registers it in `rawstep.config.json`.

**By hand:** write a JSON file, for example `tasks/newsletter.json`:

```json
{
  "url": "https://staging.example.test/newsletter",
  "goal": "Sign up for the newsletter with the email input.",
  "context": "A shop's newsletter page.",
  "input": { "email": "someone@example.com" },
  "maxSteps": 40,
  "verify": { "all": [{ "textVisible": "Thanks for signing up" }] }
}
```

and register it in the config's `tasks`:

```json
"tasks": [{ "id": "newsletter", "name": "Newsletter sign-up", "file": "tasks/newsletter.json" }]
```

`npx rawstep run` also takes a task file path that is not registered; it then runs with the project's first profile unless you pass `--profile`.

Three rules keep the measurement honest:

- **The goal goes to the planner word for word.** Write what a first-time user would be trying to do, not where things are on the page ("press the third button in the footer" gives the answer away).
- **`context` is only what a newcomer knows** before arriving: what kind of site and page this is. At most 1000 characters.
- **The completion check is never shown to the planner.** Rawstep uses it to decide whether the goal was reached. Write it from the page's state (visible text, title, URL, a request that was sent).

The simulated user can type only the inputs listed in `input`, by name, and only if the profile allows typing. The profiles `init` writes allow it (`actions.typeText` is `true`). In the dashboard it is Allow typing the task’s inputs under the profile's Who is it?. The planner sees an input's name, never its value, unless `inputOptions` marks it `"sensitive": false` (a search term, say). Sensitive values are also redacted in the saved run. The [task reference](./reference/task.md) lists every completion check, input option and the navigation scope.

## 5. Run it

```sh
npx rawstep run newsletter --profile item-by-item --repeat 3
```

In the dashboard, open the task and press Run…. The dialog picks the tasks, the profiles and how many times each runs; you can pick several profiles at once. Add a note under What changed this time if you changed the page: the runs are counted as one batch, which you can compare with an earlier batch later. As with `--repeat`, once the last repeat of a task under a profile has finished, each repeat is compared with the fastest one that reached the goal.

Each run calls the planner a few times: for the first plan, and again when a task keeps failing, changes nothing or runs long. `maxPlannerCalls` (default 40) caps it. A run that reaches the cap ends as not measured, not as the user failing.

Exit code 0 means every run gave a measurement: the user reached the goal, gave up, or said it was done when it was not. Rawstep does not fail a run for missing the goal. Exit code 1 means an error, including any run that ended on an error: such a run says nothing about the page. Exit code 2 means no run broke, but at least one was not measured (for example it hit a limit). See the [CLI reference](./reference/cli.md) for options and exit codes.

## 6. Read the results

### In the CLI

`run` prints one block per run, then a summary across runs:

- **`Run 1 of 3: <ending> · <n> moves`.** How the run ended (reached the goal, gave up, said it was done but the goal was not reached, not measured) and how many moves it took. A run that ended on an error is said so and is not counted.
- **`Why:` and `Rests on`.** Only for a run that gave up: the user's reason and the expectations it was based on, with the step where each one broke.
- **`longest without a goal word`.** The longest stretch of moves in which the user heard no word from the goal.
- **`wrong guesses about where something is`** and **`new plans`.** How often the user expected something to be somewhere and it was not, and how often it had to rethink, by reason.
- **`Could a first-time user do it?`** and **`Cost of reaching it`.** Counts across runs, and the median moves of the runs that reached the goal.
- **`Stuck`.** Elements that, when pressed, did not respond as the user expected, with that expectation.
- **`Page`** and **`Model`.** Other findings, grouped by element, with how many runs they came up in.

For one run's hints, or an HTML report:

```sh
npx rawstep hints <run folder>
npx rawstep report <run folder>
```

On the demo run, `hints` prints:

```text
Hints: 1 · goal reached: yes · steps 7
step 1,2 · goal-word-stretch · observed · 2 moves in a row (steps 1–2) without hearing a word of the goal.
Wrote <run folder>/hints.json
```

Add `--json` to `run` for the whole result as JSON. The files in a run folder are listed in the [results reference](./reference/results.md).

### In the dashboard

The task's Overview tab answers Could a first-time user do it? per run profile:

| Column | Meaning |
|---|---|
| Did it? | Runs that reached the goal, out of runs counted |
| Cost (runs that reached it) | Moves of the runs that reached the goal |
| Longest without a goal word | The longest stretch with no word of the goal heard |
| Stuck places | Elements that did not respond as expected when pressed, marked on a screenshot of the start page |

Below it, Why it gave up lists each give-up and what it rested on. A run's page shows the plan document and its versions, every step with what was heard, and each planner call.

None of these is a verdict. A stuck place says the simulated user expected something that did not happen; whether the page or the expectation is wrong is for you to decide. [Concepts](./concepts.md) explains endings, cost and hints.

## Next

- Compare ways of finding things: copy the profile and pick By headings, By form controls or By links under Way of finding things. See [Concepts](./concepts.md#ways-of-finding-things).
- Write or tune plans: [Planning](./planning.md).
- Run on a real VoiceOver or NVDA: [Screen readers](./screen-readers.md).
- Call it from tests: [API reference](./reference/api.md).
