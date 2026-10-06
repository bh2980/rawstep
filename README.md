# Rawstep

English | [한국어](./README.ko.md)

A local-first tool that runs a keyboard or screen-reader task on a web page with a model choosing the actions, then reports friction hints: where the run got slow or took detours. Reaching the goal is one signal among them, not a verdict. It has independent verification, experiment conditions (model combos, action sets, page and assistive-technology environments) for comparisons and source-linked reports.

Install one package, `rawstep`, and use it three ways: the dashboard (`npx rawstep ui`), the command line (`npx rawstep run`) and a library call in your tests (`import { runTask } from 'rawstep'`). The repository is a pnpm monorepo.

## Quick start

```sh
npm i -D rawstep
npx rawstep ui          # set up connections, experiment conditions and tasks in the dashboard
# or: npx rawstep init  # write rawstep.config.json, then edit it by hand
npx rawstep run checkout --repeat 2
```

Everything lives in `rawstep.config.json` in your project. The dashboard, the CLI and the library read the same file. Commit it. API keys never go in it: each provider reads its key from a fixed environment variable (`RAWSTEP_OPENAI_API_KEY`, `RAWSTEP_TYPESAFE_API_KEY`, ...; a custom connection names its own), and the value goes in `.env.local` or the process environment. Git-ignore `.rawstep/` and `.env.local`. See the [configuration reference](./docs/config.md) and [task files](./docs/task.md).

Example output:

```text
Run 1 of 2: goal reached · 7 steps
Run 2 of 2: goal reached · 12 steps
  slow run: 12 steps against 7 in the fastest run
  .rawstep/runs/2026-10-06T09-12-44-3f2a/run-2

Page
  link "Skip to content" · focus not visible · 2 of 2 runs
Model
  button "Pay now" · backtracking · 1 of 2 runs
```

Use the same call in a test. It resolves when the runs complete, whatever the outcome. The threshold is your own.

```ts
import { runTask } from 'rawstep';

const { runs, findings } = await runTask('checkout', { repeat: 3 });
expect(findings.filter(f => f.source === 'page')).toEqual([]);
```

See the [command reference](./docs/cli.md) for `init`, `ui`, `run`, `hints`, `report`, `analyze` and `doctor`.

**Experimental, not an accessibility certification tool.** Task completion, visual-model confidence, simulated wording and imported reviewer claims are different evidence. None establishes whole-site accessibility or native assistive-technology parity.

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

## Modes

- **Keyboard**: actual viewport pixels → multimodal model choice → keyboard input → new pixels. No DOM/AX, locator, verifier result or hidden focus context is sent to the model.
- **Screenreader**: speech → model choice → screen reader action. The assistive technology (`atEnvironments[].backend`) selects `simulation` (a Chromium-backed simulated screen reader, always labelled simulation) or a native `voiceover` / `nvda` AT Driver server on the supported host. Orca stays an advanced library backend; see [native Orca limits](./docs/native-orca.md).

Hints are friction signals, not a verdict. They point at steps worth a human look. See [reports and hints](./docs/report.md).

The runner owns action restrictions, named-input gates, navigation boundaries, time/step budgets, cancellation and fail-closed trace persistence. No scripted fallback replaces a poor model decision. Model-selected success is independently verified; stuck, uncertain, repeat-guard stop and runtime failure remain distinct. See [SystemOne configuration and verification](./docs/systemone.md).

### Local dashboard

`npx rawstep ui` serves the UI and API together on `127.0.0.1`. From a checkout, run `npm run rawstep -- ui`, or `npm run dashboard:dev` for development. The menu has three groups: 홈, 작업 and 실행 기록; 실험 조건 and 연결; and 설정. 작업 holds the task list and a task page where you run it. 실험 조건 manages the shared conditions in five tabs (모델 조합, 행동 조합, 환경, 실행 규칙, 실행 프리셋); 연결 manages connections by type and provider (with model discovery) and shows which roles use each; 설정 covers the project (analysis and check-suggestion models) and this computer (AT Driver addresses, browser, human check). A run box on the task page picks a preset or each condition (load a shared one, edit it as a task-only copy, or create one on the spot), shows the models the run will use and the run rules, and runs the task. The experiment queue runs tasks, modes, conditions and repeats in one batch, and a run's page shows the plan document, its versions, the current task and each model call. Configuration and results use project files, with no database. Components use shadcn/ui. See the [dashboard guide](./docs/dashboard-plan.ko.md).

### Connections and models

A connection is where models are reached (type and provider, plus an address for a custom server); a model combo picks the models on connections. `npx rawstep ui` walks through both, or write the `connections[]` and `combos[]` entries yourself ([configuration reference](./docs/config.md)). A combo is `solo` (the executor of the mode decides every action) or `planned`: a planner LLM writes a plan document (success criteria, assumptions, phases and numbered tasks, with versions and a history) and the executor carries out one task at a time, asking for help or for a new plan when it is stuck (screen reader mode; see [Planner and executor](./docs/config.md#planner-and-executor-orchestration)). A mode without an executor cannot run with that combo. To compare models or prompts, compare combos that differ only in that part. A config on `version` 1 or 2 is converted with `node scripts/migrate-config.mjs <project-dir>`.

- **LLM** (`kind: llm`): a language model that reads the situation and picks a candidate. Providers: OpenAI, Anthropic, Google, OpenRouter, or any OpenAI-compatible server (LM Studio, Ollama). It can also be a combo's planner, an analysis model, and run completion-check suggestions.
- **Decision** (`kind: decision`): a model that answers with a probability for every candidate: fast and cheap, for runs only. Providers: TypeSafe Jev, Vercel AI Gateway (text only), OpenRouter, or any `/systemone` server. See [SystemOne decisions](./docs/systemone.md).

Keyboard mode sends screenshots, so the combo's keyboard executor must be an LLM with image input or a decision model on TypeSafe, OpenRouter or a custom server. Register `examples/screenshot/task.json` as a task, then:

```sh
npx rawstep run <task> --combo COMBO --mode keyboard
```

Rawstep's rule-based analysis always runs after a run. If the combo or the project has an analysis model (`project.analysis.model`), an LLM analysis is added; without one everything still works.

`--diagnose-stop` (also an option of the dashboard's experiment dialog) adds a separate bounded reason-choice call after a suitable stop in keyboard mode. Its scores are uncertain model hypotheses, and cannot change the original outcome or dispatch actions.

Native AT servers and browser binaries are not npm dependencies and are never automatically downloaded on import/install.

Experimental [visual focus gating, frozen-frame studies and exact-pixel replay](./docs/visual-improvement-study.md) are available as opt-in tools.

### Condition comparisons

Each condition is a shared list in `rawstep.config.json`: model combos, action sets (what the simulated user may do), page environments, assistive technologies and run rules, plus presets that bundle them. Change one condition at a time and run the same task:

```sh
npx rawstep run checkout --environment default
npx rawstep run checkout --environment reflow-text
npx rawstep run checkout --environment forced-colors
npx rawstep run checkout --mode screenreader --combo plan-and-jev --at voiceover
```

A page environment (`pageEnvironments[].profile`) is a built-in name such as `default`, `reflow-text` or `forced-colors`, or an object. Every run records the full content of the conditions it used. Profiles cover viewport, page text enlargement/spacing, color scheme, forced-colors/contrast media, reduced motion, AT expectations and independently checked support. Browser media emulation and user styles are explicitly different from native OS settings. Genuine browser zoom needs a verified paired Chromium tab-zoom controller; an unsupported request stops instead of substituting CSS zoom or pinch. Native magnifier/high-contrast control is not implemented by the browser adapter.

Focus order, possible occlusion, clipping, overlaps and error-state changes are separate browser diagnostics, never policy hints. See [profiles and evidence limits](./docs/environment-profiles.md).

## Library and package layout

You install one package, `rawstep`. Its dist contains the CLI, the dashboard UI and server, and the API, with the internal workspaces inlined. The workspaces below are the development structure (they enforce the dependency direction) and are `private`: they are never published.

| Workspace | Responsibility |
|---|---|
| `@rawstep/core` | Contracts, task/environment profile schema, trace data and persistence |
| `@rawstep/policies` | Policy interface implementations, screenshot choice adapters, stop hypotheses |
| `@rawstep/browser` | Browser, runner, verifier, keyboard adapters and environment diagnostics |
| `@rawstep/screenreaders` | AT Driver, Orca, simulations and versioned corpus evidence |
| `@rawstep/reports` | Saved-trace analysis, hints and reports |
| `@rawstep/project` | Project model shared by UI, CLI and API: `rawstep.config.json`, task files, credentials and run assembly |
| `@rawstep/dashboard` | shadcn/ui dashboard, local API and experiment queue |
| `@rawstep/cli` | The `init`, `ui`, `run`, `hints`, `report`, `analyze` and `doctor` commands |
| `rawstep` | The published package: bundles all of the above, plus the executable and the public entry points |

Code lives in `packages/<name>/src`. `import { runTask } from 'rawstep'` is the main entry point. Subpaths such as `rawstep/runner`, `rawstep/screenshot`, `rawstep/trace`, `rawstep/hints`, `rawstep/project` and `rawstep/orca` stay available for advanced use. Third-party runtime dependencies (`playwright`, `ai`, `@ai-sdk/openai-compatible`, `zod`) are ordinary dependencies of `rawstep`; nothing under `@rawstep/*` is installed in a project.

### Local tarball without publishing

```sh
npm run pack:rawstep
# In another project:
npm install /absolute/path/to/rawstep/artifacts/rawstep-<version>.tgz
npx rawstep --help
```

`npm run test:package` does this in a temporary project and checks the CLI, `rawstep ui`, imports and TypeScript types. Browser executables, Python/model runtimes and native screen readers are separate prerequisites; installing does not start or download them.

## Privacy and safety

Fresh output directories preserve earlier runs. Named inputs are redacted by default; after text entry, screenshots and free diagnostic/model payloads are omitted because echoes cannot be reliably attributed. Live model screenshots are not anonymized by trace redaction. Screenshots go to the model server named by the connection you configure, so a remote connection transmits them off the machine. Local policies/analyzers are trusted executable modules, not a sandbox for hostile code.

Read-only public tests can block mutating methods and excluded account/edit/payment/application URLs. Access, human-verification and TLS barriers are not bypassed.

## Verification

```sh
npm run check
npm run test:orca-native
```

The aggregate builds all workspaces, typechecks source/tests, runs all default tests and installs each package with its local dependency closure outside the checkout. The facade smoke covers actual Chromium, protocol roundtrips, cancellation, evidence-write failure and reports. Native Python tests are separate from live Orca validation.

Historical [screenshot measurements](./docs/screenshot-verification.md) are a historical snapshot, not a substitute for a current checkout check. The opt-in visual-policy study is described in [the visual study guide](./docs/visual-improvement-study.md). See [native Orca limits](./docs/native-orca.md), [corpus coverage](./docs/screenreader-evidence.md), [CLI guide](./docs/cli.md) and [source map](./docs/editing-map.md).
