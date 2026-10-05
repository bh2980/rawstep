# Rawstep

English | [한국어](./README.ko.md)

A local-first tool that runs a keyboard or screen-reader task on a web page with a model choosing the actions, then reports friction hints: where the run got slow or took detours. Reaching the goal is one signal among them, not a verdict. It has independent verification, run profiles for environment comparisons and source-linked reports.

Install one package, `rawstep`, and use it three ways: the dashboard (`npx rawstep ui`), the command line (`npx rawstep run`) and a library call in your tests (`import { runTask } from 'rawstep'`). The repository is a pnpm monorepo.

## Quick start

```sh
npm i -D rawstep
npx rawstep ui          # set up connections, models and tasks in the dashboard
# or: npx rawstep init  # write rawstep.config.json, then edit it by hand
npx rawstep run checkout --repeat 2
```

Everything lives in `rawstep.config.json` in your project. The dashboard, the CLI and the library read the same file. Commit it. API keys never go in it: a connection names an environment variable (`apiKeyEnv`), and the value goes in `.env.local` or the process environment. Git-ignore `.rawstep/` and `.env.local`. See the [configuration reference](./docs/config.md) and [task files](./docs/task.md).

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
- **Screenreader**: speech → model choice → screen reader action. `machine.backend` selects `simulation` (a Chromium-backed simulated screen reader, always labelled simulation) or a native `voiceover` / `nvda` AT Driver server on the supported host. Orca stays an advanced library backend; see [native Orca limits](./docs/native-orca.md).

Hints are friction signals, not a verdict. They point at steps worth a human look. See [reports and hints](./docs/report.md).

The runner owns action restrictions, named-input gates, navigation boundaries, time/step budgets, cancellation and fail-closed trace persistence. No scripted fallback replaces a poor model decision. Model-selected success is independently verified; stuck, uncertain, repeat-guard stop and runtime failure remain distinct. See [SystemOne configuration and verification](./docs/systemone.md).

### Local dashboard

`npx rawstep ui` serves the UI and API together on `127.0.0.1`. From a checkout, run `npm run rawstep -- ui`, or `npm run dashboard:dev` for development. Manage connections and model discovery, task prompts and permissions, experiments across tasks, models, prompts and profiles, and persisted comparison. Configuration and results use project files, with no database. Components use shadcn and the official json-render shadcn catalog/registry. See the [dashboard guide](./docs/dashboard-plan.ko.md).

### Screenshot model example

Start the separately installed [OneJev companion](./examples/screenshot/README.md). Add its `/choose` server as a `screenshot` connection with a `choose` model, in the dashboard or in `rawstep.config.json`. Register `examples/screenshot/task.json` as a task, then:

```sh
npx rawstep run <task>
```

A server implements `rawstep-screenshot-choice-v1`, not the OpenAI chat-completions protocol. The dashboard's experiment dialog has a diagnose-stop option: a separate bounded reason-choice call after a suitable stop. Its scores are uncertain model hypotheses, and cannot change the original outcome or dispatch actions. The CLI does not offer it.

Model weights, Python environments, native AT servers and browser binaries are not npm dependencies and are never automatically downloaded on import/install. Actual local OneJev0.8B/4B experiments and their failures are documented separately; the publisher's GPU latency is not our CPU performance.

Experimental [visual focus gating, frozen-frame studies and exact-pixel replay](./docs/visual-improvement-study.md) are available as opt-in tools.

### Environment comparisons

A run profile in `rawstep.config.json` (`profiles[].environment`) sets the page environment: a built-in name such as `default`, `reflow-text` or `forced-colors`, or an object. Compare environments by running the same task with each profile:

```sh
npx rawstep run checkout --profile default
npx rawstep run checkout --profile reflow-text
npx rawstep run checkout --profile forced-colors
```

Profiles cover viewport, page text enlargement/spacing, color scheme, forced-colors/contrast media, reduced motion, AT expectations and independently checked support. Browser media emulation and user styles are explicitly different from native OS settings. Genuine browser zoom needs a verified paired Chromium tab-zoom controller; an unsupported request stops instead of substituting CSS zoom or pinch. Native magnifier/high-contrast control is not implemented by the browser adapter.

Focus order, possible occlusion, clipping, overlaps and error-state changes are separate browser diagnostics, never policy hints. See [profiles and evidence limits](./docs/environment-profiles.md).

## Library and package layout

| Workspace | Responsibility |
|---|---|
| `@rawstep/core` | Contracts, task/profile schema, trace data and persistence |
| `@rawstep/policies` | Policy interface implementations, screenshot choice adapters, stop hypotheses |
| `@rawstep/browser` | Browser, runner, verifier, keyboard adapters and environment diagnostics |
| `@rawstep/screenreaders` | AT Driver, Orca, simulations and versioned corpus evidence |
| `@rawstep/reports` | Saved-trace analysis, hints and reports |
| `@rawstep/project` | Project model shared by UI, CLI and API: `rawstep.config.json`, task files, credentials and run assembly |
| `@rawstep/dashboard` | shadcn/json-render UI, local API and experiment queue |
| `@rawstep/cli` | The `init`, `ui`, `run`, `hints`, `report`, `analyze` and `doctor` commands |
| `rawstep` | Facade and executable |

Code lives in `packages/<name>/src`; each package owns its compiled output and declared dependencies. `import { runTask } from 'rawstep'` is the main entry point. Subpaths such as `rawstep/runner`, `rawstep/screenshot`, `rawstep/trace` and `rawstep/orca` stay available for advanced use. The facade is not a second implementation.

### Local tarballs without publishing

```sh
npm run pack:all
# In another project, install the full local dependency closure:
npm install /absolute/path/to/rawstep/artifacts/*.tgz
npx rawstep --help
```

`artifacts/INSTALL.md`, `packages.json` and `SHA256SUMS` describe the generated package set. Unpublished sibling packages cannot be fetched from npm by installing only a dependent tarball. Selective consumers can install a package's documented local dependency closure. Core, policies and reports do not require Playwright merely for their own imports.

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
