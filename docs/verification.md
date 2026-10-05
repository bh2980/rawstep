Version 0.2 note: the accounting below is historical. Legacy execution was removed; its tests moved to screenshot-backend.test.ts and screenshot-workflow.integration.test.ts. [Current SystemOne/native evidence gates](./systemone.md) are separate from these historical receipts.

# Completed refactor verification

> Historical snapshot. The current checkout is validated with `npm run check`; see the [README](../README.md).
Date: 2026-10-01 (UTC)

This document records the earlier refactor snapshot. For the later first-class screenshot mode and combined461-test verification, see [screenshot verification](./screenshot-verification.md).

Baseline: `d567466074b99d9e2580a6da8fed7ab3ededdf3f`

This report includes the completed structural refactor, cancellation/evidence/usability fixes, and the explicitly requested browser-backed Mock VoiceOver simulator. The old executable workspace and unresolved build graph are removed; legitimate redirects and real cloud Chromium verification are implemented and tested.

## Final architecture

The repository has one implementation under `src/`: contracts, policy, runner, AT Driver, browser, verification, trace, analysis, report, CLI, and a screenshot-keyboard adapter. The default runtime is model-neutral. The old Guidepup/virtual backends, registry, generated capability tables, generator scripts, LLMAgent/provider packages, prompt/config loader and workspace manifests are removed, not retained as a fallback.

Playwright is the only runtime dependency. The package publishes compiled JavaScript/types, explicit exports/bin/files, migration documentation and small policy examples. It includes no native AT server, browser binary, model weights, LLM SDK or Guidepup dependency.

The screenshot workflow runs through `rawstep screenshot-run` / `runScreenshotTask`, with real PNG observations and shared input gates, budgets, verifier and privacy. It never masquerades as screen-reader evidence.

## Clean dependency-graph validation

Validation used a newly copied source tree and a fresh `pnpm install --frozen-lockfile --ignore-scripts`, not the earlier workspace's node_modules.

- Node: 24.19.0 on cloud Linux
- Pinned Playwright: 1.59.1
- Pinned Vitest: 4.1.4
- Pinned TypeScript: 5.9.3
- Locked Vite: 8.3.1
- Real Chromium: 147.0.7727.0, a registry-distributed standalone headless build
- Launch: `headless: true`, `chromiumSandbox: true`, with no additional Chromium arguments

The full aggregate command passed:

```sh
npm run check
# build -> all source/test typechecks -> every test -> isolated npm package smoke
```

| Check | Result |
|---|---|
| Package build | Passed |
| Production and all test TypeScript | Passed; no remaining legacy TS errors |
| Complete test suite | 419/419 passed, 23 files, no skipped tests |
| Real Chromium integration | 97 cases passed |
| Core, DOM, protocol and trace coverage | 322 cases passed |
| Fresh/frozen dependency graph | Passed |
| Isolated npm tarball install | Passed outside the source tree |
| Public JS exports | All 13 entry points import |
| Installed executable and consumer types | Passed |
| Installed actual WebSocket roundtrip | Passed: 2 commands, 22 trace events, 2 observation windows |
| Installed actual Chromium CLI task | Passed: 2 keyboard actions, 3 real screenshot observations |
| Installed journal-failure cancellation | Passed: one key dispatched, next four prevented |
| Installed real SIGINT/SIGTERM CLI processes | Passed: finalized aborted traces, interruption points, exit codes 130/143 and recovery commands |
| Installed mock-run with actual Chromium | Passed: real activation, two simulated observations, source/provenance isolation, analyze/report |
| Genuine Laya + actual browser + simulator | Passed: two real model calls, two actual page activations, changed AX-derived speech, independent verifier and saved evidence |
| Installed forbidden-action diagnosis | Passed: cause, policy stage and evidence commands printed |
| Actual report render in Chromium | Passed: action summary, verifier grounds, collapsed raw events, no page errors |
| Independent analysis/report reruns | Passed; recorded trace/outcome unchanged |
| Release-file allowlist | Passed; no workspace/native/model payloads |

The installed-package smoke removes provider/API-key environment variables. Its AT Driver roundtrip uses a real localhost WebSocket mock and an explicitly injected fake browser/verifier. Its separate screenshot task runs the installed CLI against actual Chromium. Neither is described as a real VoiceOver/NVDA session.

## Browser and safety coverage

Real Chromium checks cover allowed relative/multi-hop redirects, final URL and history, cookies and relative resources, POST 301/302/303/307/308 semantics, explicitly approved cross-origin destinations, blocked intermediate escapes, redirect limits, external-protocol redirect targets and direct script attempts, first-request popup POSTs, file-directory boundaries, native assign/replace/href/meta-refresh, and SPA History updates/traversal. Forbidden destinations produce no target-server requests; cancellation preserves usable current-page controls.

AT Driver transport tests cover numeric command correlation, out-of-order/late responses, malformed messages, timeout/close behavior, duplicate/delayed output and command/window recording. An acknowledgement is never treated as speech completion or exact speech causality.

Privacy checks cover whole and encoded values, per-character key frames, delayed echoes, policy rationale, browser diagnostics, typed metadata and image suppression after input. Input taint remains active through cleanup. Evidence-write failures synchronously cancel the backend and prevent subsequent physical key dispatch; cleanup still runs if diagnostic writes fail. Actual WebSocket fault injection covers failure before the first text key and between later keys.

The default verifier persists per-rule observed witnesses with stable evidence references. Actual title/URL/text, submit/button input values, request/response and DOM records, and activation speech windows remain independent of policy observations. After input, free content is suppressed but rule identity, outcomes, references and safe typed metadata remain. Native regression checks that input button values, rather than empty textContent or copied expectations, become the recorded witness.

Rejected policy decisions are persisted with step/action/reason before the run exits. The analyzer recognizes those and browser-diagnostic navigation blocks. Keyboard summaries count screenshot evidence and privacy omissions rather than reporting irrelevant zero speech counts. The HTML report summarizes actions, terminal failure/interruption and verifier grounds, with escaped raw event data collapsed. Intermediate unmet verification checks do not label a successful run as failed.

SIGINT/SIGTERM are propagated to the runner and native command dispatch boundary. Installed CLI subprocess tests wait for a real Chromium task to reach its policy stage, send each OS signal, and verify finalized aborted outcomes, saved stage/step, prompt exit and recovery instructions. SIGKILL remains uncatchable; existing journal recovery continues to apply. Commands already transmitted cannot be retracted. No analyzer lifetime budget or hard plugin isolation was added in this follow-up.

## Browser-backed simulator and actual model integration

The opt-in `mock-run` command and `rawstep/mock-voiceover` API use a stateful English DOM-navigation profile over the actual Chromium accessibility tree. This is separate from native AT Driver. It has a persistent AX cursor, tracks actual DOM focus changes, traverses exposed names/roles/states, and supports guarded activation, basic keyboard actions and focused text input. Buttons/links, checkbox/radio state, required/editable fields, dynamic node insertion/removal and basic dialog focus are covered by actual browser tests. Open shadow focus is supported; iframe traversal is excluded.

Simulation emits its own trace source and policy-observation provenance since schema `2.1` (current traces are `2.2`); earlier schemas are no longer read. Reports inventory simulated and native evidence separately. A simulated pass is not a native VoiceOver or accessibility-conformance result. The [supported behavior matrix](./mock-voiceover.md) describes the limits, including approximate DOM-click activation and unsupported rotor/group/earcon/live-region timing behavior.

A separate genuine Laya model experiment uses the installed package, actual Chromium and this simulator. The trained 421M encoder/decision head ran twice, choosing `activate` each time from a declared three-action vocabulary. The actual page changed its accessible output from `Save, button` to `Save again, button` to `Save once more, button`; the independent title verifier passed after the second action. Both calls used one native ONNX forward pass, no generated text, no scripted decisions, and no input/option truncation. Measured call times were approximately 343 and 632 ms in this run. The experiment confirms the model→action→page→simulated-output→model→trace connection; it is not an accuracy or confidence-calibration benchmark. Model dependencies/weights remain outside the core npm package.

## Historical test accounting

The baseline had 329 cases. The per-case migration map (since removed) classified 167 as ported/reworked and 162 as retired with their removed Guidepup/provider/planning/image-diff subjects. New tests split and extend retained responsibilities; the resulting count is not intended to match the original count one-for-one.

The earlier 77 browser-dependent failures are not left excluded or skipped. Their retained fixture, verification, action/input and navigation responsibilities now run against real Chromium. Supplementary jsdom tests are clearly separate from native browser integration. Every current test is included in default test execution and test typechecking.

An intermediate email-fixture failure occurred while work was changing; the corrected stable sequence passed the subsequent full clean aggregate run. No retry or skip was added to conceal it.

## Remaining platform validation

Actual VoiceOver on macOS and NVDA on Windows were not run. This is the only native-platform validation limitation reported here. The user's Mac was not used.

The adapters remain experimental and preserve explicit limitations: US/default key-layout assumptions, conservative text character support, and unknown settings/version fields where the upstream server does not expose them. Unsupported operations reject instead of synthesizing speech or using hidden DOM/clipboard fallbacks. These are documented capabilities, not failed aggregate checks.

Navigation guards are task-scoping controls, not a general-purpose browser/OS security sandbox. Passing a task or these tests is not an accessibility-conformance certification.

## Reproduce

```sh
pnpm install --frozen-lockfile
npx playwright install chromium
npm run check
```

For an explicitly selected trusted compatible Chromium executable:

```sh
RAWSTEP_TEST_BROWSER_PATH=/path/to/chromium npm run check
```

`npm run test:integration` runs the mandatory real-browser suites separately. Missing browser prerequisites cause failure, not a silent skip. `npm run test:package` additionally runs a real installed-package browser task when `RAWSTEP_TEST_BROWSER_PATH` is supplied.

No push, pull request, merge, deployment or npm publication was performed. The supplied patch targets the baseline above; use a fresh checkout or source archive, and install the frozen dependency graph before verification.

## Physical workspace verification

The current development graph has seven separately compiled/package-owned implementations and a compatibility facade. Run `npm run check` for the complete current gate. `npm run test:source` extracts a clean source archive without builds or dependency links, performs a frozen install, and reruns the full gate plus Python bridge unit tests. `npm run pack:all` creates seven local tarballs and checksum/install receipts. Each package is smoke-tested outside the checkout with its declared local dependency closure; the historical counts above describe their recorded earlier snapshots, not a replacement for the current gate. No npm publication, push or OS-native accessibility certification is implied by package/build success.
