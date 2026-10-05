# Rawstep

English | [한국어](./README.ko.md)

A local-first monorepo for recording keyboard and screen-reader task attempts, with pluggable decision policies, independent verification, environment comparisons and source-linked reports.

**Experimental, not an accessibility certification tool.** Task completion, visual-model confidence, simulated wording and imported reviewer claims are different evidence. None establishes whole-site accessibility or native assistive-technology parity.

## Run the source locally

Requires Node.js22+ and the pinned pnpm version in `package.json`. Nothing needs to be published to npm.

```sh
corepack pnpm install --frozen-lockfile
npm run build
corepack pnpm --filter @rawstep/browser exec playwright install chromium
npm run rawstep -- --help
npm run rawstep -- profiles
```

Build before using the checkout CLI. A trusted existing Chromium can be selected with `--browser-executable`. Tests can use `RAWSTEP_TEST_BROWSER_PATH`; no sandbox-disabling arguments are required. See [local setup, packages and troubleshooting](./docs/local-development.md).

## Execution modes

- `screenshot-run`: actual viewport pixels → multimodal model choice → keyboard input → new pixels. No DOM/AX, locator, verifier result or hidden focus context is sent to the built-in screenshot policy
- `run --backend voiceover|nvda`: connect to an independently installed native AT Driver server on the supported host
- `run --backend orca`: native Linux Orca speech-pipeline adapter with an explicitly paired visible browser/window. The development cloud could not provide the required native IPC; live speech is not claimed
- `mock-run`: Chromium-backed simulated VoiceOver. Generated wording is always labelled simulation
- `matrix`: repeat one task across verified environment profiles with independent traces and comparison reports
- `analyze` / `report`: local saved-evidence analysis and escaped JSON/HTML reports; `analyze --llm` explicitly opts into post-run model analysis

Version 0.2 adds provider-independent SystemOne speech/image decisions through `--decision systemone`. Decision and analysis are configured separately; libraries never auto-load env. `legacy-run` and `rawstep/legacy` are removed; migrate to `screenshot-run --script` or `--policy`. Saved 2.0/2.1 keyboard traces remain readable. See [SystemOne configuration and verification](./docs/systemone.md).

`npm test` runs browser-free tests. `test:integration` runs browser suites serially with one worker; `test:all` and `check` retain aggregate coverage.

The runner owns action restrictions, named-input gates, navigation boundaries, time/step budgets, cancellation and fail-closed trace persistence. No scripted fallback replaces a poor model decision. Model-selected success is independently verified; stuck, uncertain, repeat-guard stop and runtime failure remain distinct.

### Local dashboard

After building, run `npm run rawstep -- ui`; Node serves the UI and API together. Use `npm run dashboard:dev` for development. Manage connections/model discovery, task-owned prompts and permissions, individual or matrix runs, and persisted comparison in the separate dashboard workspace. Configuration and results use project files, with no database. Components use shadcn and the official json-render shadcn catalog/registry. See the [dashboard guide](./docs/dashboard-plan.ko.md).

### Screenshot model example

Start the separately installed [OneJev companion](./examples/screenshot/README.md), then:

```sh
npm run rawstep -- screenshot-run examples/screenshot/task.json \
  --model-endpoint http://127.0.0.1:8766/choose --out runs/screenshot-01
npm run rawstep -- analyze runs/screenshot-01
npm run rawstep -- report runs/screenshot-01 --analysis runs/screenshot-01/analysis.json
```

An endpoint implements `rawstep-screenshot-choice-v1`, not the OpenAI chat-completions protocol. `--policy ./policy.mjs` supports another trusted model adapter. Optional `--diagnose-stop` performs a separate bounded reason-choice call after a suitable stop; its scores are uncertain model hypotheses, and cannot change the original outcome or dispatch actions.

Model weights, Python environments, native AT servers and browser binaries are not npm dependencies and are never automatically downloaded on import/install. Actual local OneJev0.8B/4B experiments and their failures are documented separately; the publisher's GPU latency is not our CPU performance.

Experimental [visual focus gating, frozen-frame studies and exact-pixel replay](./docs/visual-improvement-study.md) are available as opt-in tools.

### Environment comparisons

```sh
npm run rawstep -- matrix examples/profiles/task.json \
  --profiles default,reflow-text,forced-colors \
  --model-endpoint http://127.0.0.1:8767/choose --out runs/matrix-01
```

Profiles cover viewport, page text enlargement/spacing, color scheme, forced-colors/contrast media, reduced motion, AT expectations and independently checked support. Browser media emulation and user styles are explicitly different from native OS settings. Genuine browser zoom needs a verified paired Chromium tab-zoom controller; an unsupported request stops instead of substituting CSS zoom or pinch. Native magnifier/high-contrast control is not implemented by the browser adapter.

Focus order, possible occlusion, clipping, overlaps and error-state changes are separate browser diagnostics, never policy hints. Comparisons separate task completion, suspected issues, model failure, runtime error, unsupported environment/pattern and source-linked human findings. `--human-evidence` imports consenting reviewer records for the same task; the examples invent no user research. See [profiles and evidence limits](./docs/environment-profiles.md).

## Library and package layout

| Workspace | Responsibility |
|---|---|
| `@rawstep/core` | Contracts, task/profile schema, trace data and persistence |
| `@rawstep/policies` | Policy interface implementations, screenshot choice adapters, stop hypotheses |
| `@rawstep/browser` | Browser, runner, verifier, keyboard adapters and environment diagnostics |
| `@rawstep/screenreaders` | AT Driver, Orca, simulations and versioned corpus evidence |
| `@rawstep/reports` | Saved-trace analysis and reports |
| `@rawstep/dashboard` | shadcn/json-render UI, local configuration API and experiment queue |
| `@rawstep/cli` | Commands and matrix orchestration |
| `rawstep` | Compatibility facade and executable |

Code lives in `packages/<name>/src`; each package owns its compiled output and declared dependencies. Existing imports such as `rawstep/screenshot`, `rawstep/runner`, `rawstep/trace`, `rawstep/orca` and `rawstep/matrix` remain supported. The facade is not a second implementation.

```js
import { runScreenshotTask, ScreenshotDecisionPolicy, HttpScreenshotModel } from 'rawstep/screenshot';
const policy = new ScreenshotDecisionPolicy({
  model: new HttpScreenshotModel({ endpoint: 'http://127.0.0.1:8766/choose' }),
});
await runScreenshotTask(task, { policy, outDir: 'runs/example' });
```

### Local tarballs without publishing

```sh
npm run pack:all
# In another project, install the full local dependency closure:
npm install /absolute/path/to/rawstep/artifacts/*.tgz
npx rawstep --help
```

`artifacts/INSTALL.md`, `packages.json` and `SHA256SUMS` describe the generated package set. Unpublished sibling packages cannot be fetched from npm by installing only a dependent tarball. Selective consumers can install a package's documented local dependency closure. Core, policies and reports do not require Playwright merely for their own imports.

## Privacy and safety

Fresh output directories preserve earlier runs. Named inputs are redacted by default; after text entry, screenshots and free diagnostic/model payloads are omitted because echoes cannot be reliably attributed. Live model screenshots are not anonymized by trace redaction. Remote HTTPS model transmission requires an explicit opt-in. Local policies/analyzers are trusted executable modules, not a sandbox for hostile code.

Read-only public tests can block mutating methods and excluded account/edit/payment/application URLs. Access, human-verification and TLS barriers are not bypassed. `--proxy-server` explicitly selects an existing credential-free proxy; it does not change certificate trust or disable TLS verification.

## Verification

```sh
npm run check
npm run test:orca-native
```

The aggregate builds all workspaces, typechecks source/tests, runs all default tests and installs each package with its local dependency closure outside the checkout. The facade smoke covers actual Chromium, protocol roundtrips, cancellation, evidence-write failure and reports. Native Python tests are separate from live Orca validation.

Historical [screenshot measurements](./docs/screenshot-verification.md) are a historical snapshot, not a substitute for a current checkout check. The opt-in visual-policy study is described in [the visual study guide](./docs/visual-improvement-study.md). See [native Orca limits](./docs/native-orca.md), [corpus coverage](./docs/screenreader-evidence.md), [CLI guide](./docs/cli.md) and [source map](./docs/editing-map.md).
