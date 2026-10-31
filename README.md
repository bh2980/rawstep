# Rawstep

English | [한국어](./README.ko.md)

A local-first tool that tries a screen-reader task on a web page the way a first-time user would (a planner model plans from what it hears, and Rawstep carries out the plan), then reports friction hints: where the run got slow or took detours. Reaching the goal is one signal among them, not a verdict. It has independent verification, run profiles (planner, allowed actions, page environment, screen reader, run rules) for comparisons and source-linked reports.

Install one package, `rawstep`, and use it three ways: the dashboard (`npx rawstep ui`), the command line (`npx rawstep run`) and a library call in your tests (`import { runTask } from 'rawstep'`). The repository is a pnpm monorepo.

## Quick start

```sh
npm i -D rawstep
npx rawstep ui          # set up connections, run profiles and tasks in the dashboard
# or: npx rawstep init  # write rawstep.config.json, then edit it by hand
npx rawstep run checkout --repeat 2
```

Everything lives in `rawstep.config.json` in your project. The dashboard, the CLI and the library read the same file. Commit it. API keys never go in it: each provider reads its key from a fixed environment variable (`RAWSTEP_OPENAI_API_KEY`, `RAWSTEP_ANTHROPIC_API_KEY`, ...; a custom connection names its own), and the value goes in `.env.local` or the process environment. Git-ignore `.rawstep/` and `.env.local`. See the [configuration reference](./docs/config.md) and [task files](./docs/task.md).

Example output:

```text
Run 1 of 2: gave up · 34 moves
  Why: "Add to cart never says the item was added, and nothing else heard can add it."
  Rests on A3 "Pressing Add to cart announces that the item was added" · broke at step 17 after pressing StaticText "Add to cart"
  longest without a goal word: 9 moves · wrong guesses about where something is: 1
  <run 1 folder>
Run 2 of 2: reached the goal · 84 moves
  longest without a goal word: 21 moves · wrong guesses about where something is: 0
  <run 2 folder>

Could a first-time user do it? reached the goal in 1 of 2 runs · gave up 1
Cost of reaching it: 84 moves

Stuck: pressed, and it did not respond as the user expected
  StaticText "Add to cart" · 1 of 2 runs · 1 give-up rest on it
    expected: Pressing Add to cart announces that the item was added

Page
  button "Checkout" · focus-lost · 1 of 2 runs
```

Use the same call in a test. It resolves when the runs complete, whatever the outcome. The threshold is your own.

```ts
import { runTask } from 'rawstep';

const { runs, findings } = await runTask('checkout', { repeat: 3 });
expect(findings.filter(f => f.source === 'page')).toEqual([]);
```

See the [command reference](./docs/cli.md) for `init`, `ui`, `run`, `hints`, `report`, `analyze` and `doctor`.

**Experimental, not an accessibility certification tool.** Task completion, simulated wording and imported reviewer claims are different evidence. None establishes whole-site accessibility or native assistive-technology parity.

## Run the source locally

For contributors. Requires Node.js22+ and the pinned pnpm version in `package.json`. Nothing needs to be published to npm.

```sh
corepack pnpm install --frozen-lockfile
npm run build
corepack pnpm --filter @rawstep/browser exec playwright install chromium
npm run rawstep -- --help
```

Build before using the checkout CLI. A trusted existing Chromium can be selected with `machine.browserExecutablePath` in `rawstep.config.json`. Tests can use `RAWSTEP_TEST_BROWSER_PATH`; no sandbox-disabling arguments are required. See [local setup, packages and troubleshooting](./docs/local-development.md).

`npm test` runs browser-free tests. `test:integration` runs browser suites serially with one worker; `test:all` and `check` retain aggregate coverage.

## Screen reader

A run is speech → plan → screen reader action. The profile's `screenReader` selects `simulation` (a Chromium-backed simulated screen reader, always labelled simulation) or a native `voiceover` / `nvda` AT Driver server on the supported host. Orca stays an advanced library backend; see [native Orca limits](./docs/native-orca.md).

Hints are friction signals, not a verdict. They point at steps worth a human look. See [reports and hints](./docs/report.md).

The runner owns action restrictions, named-input gates, navigation boundaries, time/step budgets, cancellation and fail-closed trace persistence. No scripted fallback replaces a poor plan. A planner's claim of success is independently verified; giving up, not measured, repeat-guard stop and runtime failure remain distinct. See [Planner and plan](./docs/config.md#planner-and-plan).

### Local dashboard

`npx rawstep ui` serves the UI and API together on `127.0.0.1`. From a checkout, run `npm run rawstep -- ui`, or `npm run dashboard:dev` for development. The menu has three entries: 작업, 실행 기록 and 설정. 작업 holds the task list and a task page where you run it. 설정 groups 실행 프로필 (the run profiles); 연결 (connections by provider, with model discovery, and the roles that use each) and 해설·제안 모델; and this computer (AT Driver addresses, browser, human check). The task page picks a run profile, shows the planner the run will use and the run rules, and runs the task. The experiment queue runs tasks, profiles and repeats in one batch, and a run's page shows the plan document, its versions, the current task and each planner call. Configuration and results use project files, with no database. Components use shadcn/ui.

### Connections and models

A connection is where language models are reached (a provider, plus an address for a custom server); a run profile picks the model on a connection, with the model and effort chosen where they are used. Providers: OpenAI, Anthropic, Google, OpenRouter, any OpenAI-compatible server (LM Studio, Ollama), or a logged-in coding-agent CLI over ACP (Claude Code, Codex, opencode, Grok Build, Antigravity; no API key, slower per call). A model serves as a profile's planner, the project's analysis model and completion-check suggestions. `npx rawstep ui` walks through connections and profiles, or write the `connections[]` and `profiles[]` entries yourself ([configuration reference](./docs/config.md)).

A screen reader run always plans: the planner (an LLM, or a plan file) writes a plan document (success criteria, assumptions, phases and numbered tasks, with versions and a history), and Rawstep carries out each task exactly as written: a moving task repeats its move until its cue is heard, a pressing task presses the item the cursor is on, a typing task types a named input into the field the cursor is on. Rawstep asks for a new plan when actions keep failing or change nothing, when a task runs long without hearing anything new, and every so many moves (see [Planner and plan](./docs/config.md#planner-and-plan)). No model picks individual actions, so a run costs only planner calls. A profile without a planner cannot run. To compare models or prompts, compare profiles that differ only in that part. A config older than `version` 7 does not load; start a new project with `rawstep init` and copy the tasks over.

Rawstep's rule-based analysis always runs after a run. If the project has an analysis model (`project.analysis.model`), an LLM analysis is added; without one everything still works.

Native AT servers and browser binaries are not npm dependencies and are never automatically downloaded on import/install.

### Condition comparisons

A run profile in `rawstep.config.json` holds everything that changes a run: the planner, the actions the simulated user may take, the page environment, the screen reader and the run rules. Make profiles that differ in one part and run the same task with each. In the dashboard, a screen reader profile's actions start from a way of finding things: item by item, or by headings, form controls or links ([details](./docs/config.md#profiles)).

```sh
npx rawstep run checkout --profile default-page
npx rawstep run checkout --profile reflow-text
npx rawstep run checkout --profile forced-colors
npx rawstep run checkout --profile headings-voiceover
```

A profile's page environment (`profiles[].page`) is a built-in name such as `default`, `reflow-text` or `forced-colors`, or an object. Every run records the full content of the profile it used. Profiles cover viewport, page text enlargement/spacing, color scheme, forced-colors/contrast media, reduced motion, AT expectations and independently checked support. Browser media emulation and user styles are explicitly different from native OS settings. Genuine browser zoom needs a verified paired Chromium tab-zoom controller; an unsupported request stops instead of substituting CSS zoom or pinch. Native magnifier/high-contrast control is not implemented by the browser adapter.

Focus order, possible occlusion, clipping, overlaps and error-state changes are separate browser diagnostics, never policy hints. See [profiles and evidence limits](./docs/environment-profiles.md).

## Library and package layout

You install one package, `rawstep`. Its dist contains the CLI, the dashboard UI and server, and the API, with the internal workspaces inlined. The workspaces below are the development structure (they enforce the dependency direction) and are `private`: they are never published.

| Workspace | Responsibility |
|---|---|
| `@rawstep/core` | Contracts, task/environment profile schema, trace data and persistence |
| `@rawstep/policies` | Policy interface implementations, the planner and the plan Rawstep follows |
| `@rawstep/browser` | Browser, runner, verifier and environment diagnostics |
| `@rawstep/screenreaders` | AT Driver, Orca, simulations and versioned corpus evidence |
| `@rawstep/reports` | Saved-trace analysis, hints and reports |
| `@rawstep/project` | Project model shared by UI, CLI and API: `rawstep.config.json`, task files, credentials and run assembly |
| `@rawstep/dashboard` | shadcn/ui dashboard, local API and experiment queue |
| `@rawstep/cli` | The `init`, `ui`, `run`, `hints`, `report`, `analyze` and `doctor` commands |
| `rawstep` | The published package: bundles all of the above, plus the executable and the public entry points |

Code lives in `packages/<name>/src`. `import { runTask } from 'rawstep'` is the main entry point. Subpaths such as `rawstep/runner`, `rawstep/trace`, `rawstep/hints`, `rawstep/project` and `rawstep/orca` stay available for advanced use. Third-party runtime dependencies (`playwright`, `ai`, `@ai-sdk/openai-compatible`, `zod`) are ordinary dependencies of `rawstep`; nothing under `@rawstep/*` is installed in a project.

### Local tarball without publishing

```sh
npm run pack:rawstep
# In another project:
npm install /absolute/path/to/rawstep/artifacts/rawstep-<version>.tgz
npx rawstep --help
```

`npm run test:package` does this in a temporary project and checks the CLI, `rawstep ui`, imports and TypeScript types. Browser executables, Python/model runtimes and native screen readers are separate prerequisites; installing does not start or download them.

## Privacy and safety

Fresh output directories preserve earlier runs. Named inputs are redacted by default; after text entry, free diagnostic/model payloads are omitted because echoes cannot be reliably attributed. The page text a model reads goes to the model server named by the connection you configure, so a remote connection transmits it off the machine. Local policies/analyzers are trusted executable modules, not a sandbox for hostile code.

Read-only public tests can block mutating methods and excluded account/edit/payment/application URLs. Access, human-verification and TLS barriers are not bypassed.

## Verification

```sh
npm run check
npm run test:orca-native
```

The aggregate builds all workspaces, typechecks source/tests, runs all default tests and installs each package with its local dependency closure outside the checkout. The facade smoke covers actual Chromium, protocol roundtrips, cancellation, evidence-write failure and reports. Native Python tests are separate from live Orca validation.

See [native Orca limits](./docs/native-orca.md), [corpus coverage](./docs/screenreader-evidence.md), [CLI guide](./docs/cli.md) and [source map](./docs/editing-map.md).