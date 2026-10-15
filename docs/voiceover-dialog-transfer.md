# Dialog task transfer and parent-context correction

The speech engine is called by Rawstep after Rawstep has chosen a target and performed an action. This experiment records that actual call input and previous speech context, rather than reconstructing ideal inputs from an expected utterance. It adds no navigation implementation.

## First evaluation on new tasks

Two new synthetic tasks change/save delivery preferences and select/submit a printed receipt. They combine an outer main/region, nonmodal dialogs, a named inner group, forward/reverse returns, checkbox/toggle/disclosure changes, dynamically exposed text and final save/submit outcomes. Model/HTML, complete action sequences, outcome oracles and acquisition/scoring sources were fixed before either Native profile. Declared template/site/contrast and complete action groups had no collision against 859 prior cases; shared primitive roles/rules do not establish global structural independence.

The fixed Safari v19 / Chrome v13 JavaScript build was `c502cb2fd42238a1c69c96db0749a0294c83fe901f7801ee2b8b26e88d0e7e6b`. Cases SHA-256: `6d8f7a6e41f09baa68723ab80646e5f5c8c28db0178b496e0fd5a4534021beff`. All actual model input/output windows were sealed by `2026-10-15T14:41:35.254Z`, before Safari started at `14:43:29.299Z` and Chrome at `14:47:05.894Z`. No engine/input changes occurred between those captures.

| First evaluation, separately in each browser | Result |
| --- | ---: |
| Planned / Native observed / input-equivalent / eligible actions | 40 / 40 / 40 / 40 |
| Main Speech Exact | 34/40 (85%) |
| Literal Full Speech Exact, actual model windows | 31/40 (77.5%) |
| Independently observed reading-target agreement | 40/40 |
| Declared control-state field agreement | 82/82 |
| Both environments satisfy the frozen task outcomes | 2/2 |

These are two small synthetic task examples. Reading-target agreement uses a stable unique Native outline/AX candidate joined to the actual model target's independently resolved DOM ID, name and role; keyboard focus is not the VO cursor. This is narrower than general logical-cursor Navigation Accuracy. The 82 fields repeatedly observe four controls' checked/pressed/expanded states across the two tasks; there are four state-changing activations per profile, not 82 distinct transitions. Value/selection/focus accuracy is not established by those fields. Both Native and model independently satisfy each final outcome; equal failures would not count as success.

The [immutable first fixture](../tests/fixtures/voiceover-evidence/native-dialog-transfer-2026-10-15.json) retains actual inputs, previous contexts, outputs, clocks, AX hashes, observed Native scope/target evidence, state fields and all first scores. A separate [state-quality audit](../packages/vo-corpus/test/dialog-transfer-state-quality.json) checks all 80 Native/model post-state pairs for truncation/unresolved aliases before relying on their field comparisons. The common speech-summary `scope` in the original JSON describes its speech-only helper; supplemental target/state/task fields have the narrower meanings above. Neither original results nor source observations were overwritten. These inspected tasks are now regression material.

## One structural cause

All six Main failures per profile concern a named dialog inside another focus context. The engine always prefixed a newly entered dialog's name/count, omitted the dialog from nearest-context selection and consequently retained the outer main as the last focus context. This caused an extra prefix when entering its inner group, a wrong outer suffix when returning to the dialog, a missing main suffix on exit and another incorrect prefix on re-entry. They are related effects of one context-selection rule, not six independent wording rules.

The Native output for `Review delivery terms` is the object followed by `Delivery options web dialog` in Safari or `Delivery options dialog` in Chrome. A standalone dialog previously measured instead uses its summary before the object, including its child count. Silently applying one format everywhere is incorrect. Hints differ with the same structural condition: nested focus-context dialogs use the ordinary control hint, while the measured standalone dialog includes its dialog location/exit instruction.

## Controlled calibration and correction

After inspecting those failures, four contrasts keep the inner dialog HTML and six keys identical while changing only its parent: an anonymous wrapper, an unnamed main, a named region or a named group. Both Native profiles completed all 24 actions before the rule changed. The [parent calibration fixture](../tests/fixtures/voiceover-evidence/native-dialog-parent-context-2026-10-15.json) preserves the original 18/24 Main and 12/24 Full results per profile. Anonymous wrappers retain standalone summaries; the three exposed parent contexts use a nearest-dialog suffix and ordinary hints.

Safari v20 / Chrome v14 add that rule for Tab/Shift+Tab. A named dialog inside an exposed focus context participates in nearest-context selection, so entering its inner group announces that group, returning to the dialog announces the dialog and leaving it announces its outer context. The dialog uses ordinary focus-context hints in that mode. Standalone and unnamed-dialog summary behavior is retained. Inputs use roles, names and ancestor relationships; no fixture ID, HTML layout or expected utterance selects the rule.

| Inspected regression/calibration, each browser | Before | After |
| --- | ---: | ---: |
| Task Main Speech | 34/40 | 40/40 |
| Task literal Full Speech, actual Chromium adapter replay | 31/40 | 40/40 |
| Parent-contrast Main Speech | 18/24 | 24/24 |
| Parent-contrast literal Full candidate | 12/24 | 24/24 |

The [separate correction report](../packages/vo-corpus/test/dialog-transfer-correction.json) joins the original fixture hashes to current build/source hashes and scores the pure candidate replay. Browser integration independently executes all 40 commands per profile, observes actual formatter calls, joins their scopes/targets to the retained Native evidence, compares all full output windows and rechecks the 82 state fields and final task outcomes. Current history is carried through the corrected API; old history and first predictions remain in the original fixture.

## Boundaries and reproduction

This correction does not turn 85% into a new independent 100% result. A fresh independent cohort after the correction remains required, including actual-site validation. Parent calibration directly covers main, region and named group; other exposed parent combinations, modal opening/closing, nested dialogs, cross-frame input projection and mixed object/focus-command histories need additional Native evidence. Existing real-site failures remain unchanged.

The model used 900 ms windows while Native used the existing bounded receipt protocol. Full equality on these windows does not establish matching latency, completion, asynchronous attribution, interruption or a Native speech queue. Keep browser profiles and prior contexts separate. Unmeasured events must remain unmeasured.

From the repository root:

```sh
npm run build
npm test -- tests/mock-voiceover-dialog-transfer.test.ts tests/mock-voiceover-dialog-parents.test.ts
npm run test:integration -- tests/mock-voiceover-speech-inputs.integration.test.ts tests/mock-voiceover-dialog-transfer.integration.test.ts
node --import tsx --test packages/vo-corpus/test/dialog-transfer.test.ts packages/vo-corpus/test/dialog-parents.test.ts
npm --prefix packages/vo-corpus run generate -- --set dialog-transfer-v1 --out data/cases/dialog-transfer-update-check
npm --prefix packages/vo-corpus run generate -- --set dialog-parent-context-v1 --out data/cases/dialog-parent-update-check
```

Collect each regenerated directory separately with the existing [VM/relay commands](../packages/vo-corpus/README.md), preserving original run directories. The inspected tasks/contrasts are update/regression checks, never new holdouts. The new `getSpeechInputObservation()` [evaluator diagnostic](./mock-voiceover.md#evidence-boundaries-for-test-callers) exposes copied actual inputs per completed observation window outside policy observations; it does not observe Native VoiceOver.

The subsequent [article/form composition study](./voiceover-dialog-compositions.md) evaluates the corrected nearest-context rule on new tasks. It preserves the first actual inputs and a separate stricter help-input audit: 36/39 Safari and 39/39 Chrome original inputs are comparable. Reading targets, five declared state changes and two save outcomes are separately measured. Later ARIA/title projection correction is inspected regression.
