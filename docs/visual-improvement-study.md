# Visual policy study and regression replay

These are experimental, opt-in tools. The default screenshot policy remains the V5 one-call policy. A primitive multiple-choice model returns option scores, not a generated explanation. None of these tools establishes WCAG conformance, native focus truth or native screen-reader parity.

## Focus comparison before an action

`ScreenshotDecisionPolicy({ model, focusGate: {}, historyLimit: 1 })` first asks the same screenshot-only adapter to compare five visible focus states: appropriate editable target, appropriate activation target, another control, no visible indicator, or uncertain. A second model call selects an action from a restricted menu. The focus call receives only goal, current/previous pixels and allowlisted recorded action attempts. Named input values, DOM, AX, independent diagnostics and verifier results are excluded.

At the default experimental thresholds (winning score ≥ 0.75; margin ≥ 0.25), a visual editable-target prediction permits named text entry and Enter. A visual activation-target prediction permits Enter/Space. Missing scores, low confidence, another control, invisible focus or uncertainty remove text, activation and deletion choices. Navigation and stops remain model-selected; no hardcoded recovery key is substituted. Scores are uncalibrated, so a confidently wrong focus guess can still be wrong. The extra inference stage increases latency; both comparisons use the same captured frame, which can become stale on a dynamic page. The runner's independent editable-field gate and goal verifier remain necessary. In particular, a model may choose success on an unfinished screen, which the verifier must reject.

Enable it with `focusGate: {}` in `ScreenshotDecisionPolicy` from library code (`runScreenshotTask`), or through a run profile's focus gate in the dashboard. It needs a decision model that returns probabilities (a `decision` model with the `typesafe`, `openrouter` or `custom` provider). An external adapter must implement the declared focus question rather than interpreting it as a request to dispatch an action. Each stage and all blocked/permitted choice IDs are saved as policy evidence. The usual after-text-entry redaction applies.

## Small, frozen study

Only the model-independent scripts remain in the repository (fixture capture, case freezing, replay export and replay). The local-model runner of the original study was removed together with the `/choose` protocol it used.

The source-checkout script `node scripts/visual-study/capture-fixtures.mjs FRESH_OUTPUT_DIR` captures six local frames and writes model requests separately from independent oracles. Search-form screens are the development family; settings screens are a separate evaluation family. Normal and deliberately broken controls exercise missing focus indicators, repeated trapped focus and overlaid controls. CSS overlay is not genuine browser zoom. Diagnostic hits on designed synthetic cases are not real-world sensitivity or specificity.

The separately saved study also includes a fixed pair of earlier public-site screenshots per task. Those public failures motivated the study; they are not a previously unseen site benchmark. The public screens have no single gold progress action, so they are scored only for unsupported activation/text attempts and abstention. Goal completion remains unmeasured by this frozen-frame study, which dispatches no actions. A rubric-compatible navigation choice can still fail to advance a task, particularly on a trap. Compatibility is reported separately from action selection, abstention and false success.

Four paired conditions preserve the same model weights and requests: baseline, doubled image budget alone, one-action history alone, and that short history with the focus gate. Baseline and short-history requests can be byte-identical when fewer than two actions exist. Those rows are identified rather than claimed as a history improvement. Cache-enabled pilot evidence is retained separately; final paired inference disables prompt caching after a cache-reuse timing confound was discovered. Latency is observed on a shared CPU, not an isolated benchmark. Raw restricted option log-scores, backend readouts, request/prompt hashes and image budgets are retained.

The primary frozen requests for search-invisible and settings-trap have neutral repetition counters (visits=1, unchanged=0) despite identical prior pixels. This metadata limitation is preserved and disclosed. A separately frozen 2-frame × 4-variant sensitivity corrects only those derived counts to visits=2, unchanged=1, validated from captured history hashes. It never replaces or merges into the original comparison.

A killed runtime interrupted the first pass. Successful original responses and every failure are retained; only missing conditions are retried with identical settings in fresh per-case runtimes. Reports distinguish attempts, actual decisions and recovered decisions.

No evaluation samples are used for training. Thresholds and prompts are not selected for the best evaluation outcome. Every frozen variant, including failures, remains in the results.

## Successful path to deterministic CI replay

`exportScreenshotReplay(trace, task)` exports a successful, model-selected keyboard path only when every independent goal rule has linked verifier witnesses. Failed, scripted, missing-witness, input-tainted or redacted traces are refused. Named text inputs are deliberately unsupported because their saved visual evidence is redacted.

`runScreenshotReplay(task, replay, options)` requires explicit `navigation.readOnly: true` for HTTP(S) tasks and checks the exact task contract and then passes a `ScreenshotReplayPolicy` through the existing runner. Each step requires the same viewport and exact PNG hash before the saved key is dispatched. Changed pixels, failed/prior divergent actions or disallowed keys stop the replay; path exhaustion never asserts success. The runner independently verifies the goal again.

```sh
node scripts/visual-study/export-replay.mjs runs/success task.json scenario.json
node scripts/visual-study/replay.mjs task.json scenario.json runs/replay-new
```

The scripts above are source-checkout tools; installed packages expose the same export/replay APIs. Use fresh output paths. Manifests and source traces are trusted, unsigned artifacts: structural checks cannot authenticate a fully fabricated trace. The replay helper rejects verifier and profile overrides; set the reviewed profile in the task contract. Custom browser factories remain trusted executable test adapters. These scenarios are strict and environment-bound: moving a file URL, changing a goal, verifier, navigation policy or profile requires reviewing and exporting a new scenario. Small rendering changes can invalidate an otherwise valid path. An invisible behavioral change may survive pixel checks until the independent goal verifier catches it. Remote request guards block mutating methods, but cannot prevent client-only changes or misdesigned GET side effects; replay only trusted, reviewed read-only tasks. Local file fixtures are separately scoped to deterministic CI. A replay success is a deterministic regression result, not a new model success or accessibility certificate.
