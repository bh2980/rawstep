# SystemOne refactor implementation status

This is an implementation handoff, not a native/model validation receipt. No npm publication or model installation was performed. Versions are prepared as 0.2.0 locally.

| Task | Implemented / verification |
| --- | --- |
| T01 | Browser-free default tests; serial browser suite; pending launch ownership, cleanup failure latch, and exact owned-process exit smoke. |
| T02 | Matrix execution evidence survives analysis/report failures; postprocessing statuses are separate; backend setup ownership cleanup tested. |
| T03 | Generic text/image SystemOne client, explicit capabilities, probabilities, cancellation and configurable fake. Both fake execution/trace paths pass. |
| T04 | CLI-only env loading and provider/URL separation; injected library configuration; namespace isolation and secret-safe errors. Local env files are never overwritten. |
| T05 | Native Gateway Evaluation adapter, catalog preflight, no generative fallback, mocked HTTP protocol/timeout/cancellation tests. Actual configured inference remains unverified. |
| T06 | Inline PNG SystemOne HTTP adapter, ordered current/previous image references and explicit capabilities; mocked HTTP tests. Actual multimodal inference remains unverified. |
| T07 | Speech-only constrained policy; independent runner/verifier; fake backend trace, invalid candidate and input privacy tests. |
| T08 | Existing screenshot policy bridged to SystemOne; focus/repetition/replay remain. Fake image policy and full CLI/runner/trace tests pass. Real-model gate is pending. |
| T09 | Explicit SystemOne CLI selection, mutually exclusive selectors, script support and pre-browser capability checks including mock speech. |
| T10 | Explicit analyze --llm only; full finalized redacted event payload, PNG omission, validated evidence IDs, bounded input/response and failure isolation. |
| T11 | Opt-in scripted-then-SystemOne VoiceOver harness and native fixture implemented. **No native pass**: this checkout has no env credentials or listening native/model services. Actual cancellation/disconnection and model-stop native evidence also remain pending. NVDA remains experimental. |
| T12 | Screenshot input/privacy/verification/cancellation regressions ported and passed before duplicate legacy code, command and exports were removed. Historical 2.0/2.1 traces/images retained. Guidepup was already absent and was not restored. |
| T13 | Seven-package exports and independent consumer/tarball checks extended for SystemOne, LLM types and removed legacy exports. See verification results below. |

## Verification

Verified on this macOS checkout using Node 24.19.0 and the explicitly selected installed Chrome, without installing a browser:

- Build and all source/test TypeScript checks: passed.
- npm test: 540 passed, 1 skipped; no real browser launched.
- Sequential test:integration: 163 passed, 1 skipped, 14 files. Exact owned Chrome PIDs exited after close.
- macOS OS-native collapsed select popup is the explicit browser skip; renderer-owned listbox arrows pass. Do not interpret this as a page accessibility defect.
- Isolated package verification: passed for all seven packages (75 independent export imports/type declarations in their dependency closures, plus facade consumer checks). Core/policies/reports install without Playwright. Tarballs enforce the release allowlist without env files, weights or browser binaries. Installed CLI screenshot/mock, HTTP fixture, WebSocket transport, legacy export rejection, historical trace analysis and fake SystemOne image flow passed.
- Installed CLI SIGINT/SIGTERM: finalized aborted traces and exit codes 130/143 passed. Playwright's competing process-exiting signal handler is disabled so Rawstep can finish cleanup and persistence.

Actual VoiceOver + SystemOne, actual multimodal service and Windows NVDA evidence are required separately. Fake/HTTP fixture success is not model performance or native AT success. Therefore the plan's final native/model completion conditions are **not yet achieved**.

Configuration, package ownership, privacy boundaries and runnable opt-in harnesses: [SystemOne documentation](./systemone.md).
