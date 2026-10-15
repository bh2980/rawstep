# Activation speech API and composition transfer evaluation

`formatVoiceOverActivation(input, previousContext)` accepts independently observed before/after targets and an action already performed by Rawstep. It returns either `status: 'modeled'` with ordered `utterances`, or `status: 'unsupported'` with a reason and no guessed utterances. An empty array is a modeled silent event. It performs no navigation, action, browser access or speech scheduling. The existing `formatVoiceOverSpeech` remains the explicit object-reading API. Both are exported through `rawstep`, `rawstep/mock-voiceover`, `@rawstep/screenreaders` and its mock subpath.

The initial event rules derive from the [controlled button state study](./voiceover-button-state-speech.md): a Chrome pressed-value receipt and the two expansion receipts compose in order; Safari omits the pressed receipt. The event formatter preserves structural reading history for button activations. Isolated boolean checkbox changes reuse the existing browser-specific formatter for physical Space and VO activation. The browser adapter delegates modeled Space events to this same implementation; other adapter paths retain their documented legacy approximations. Unknown before state, changed identity/name/non-state semantics, disabled/protected activation, new/disappearing button state attributes, button VO activation, other roles and transitions to mixed pressed state are explicitly unsupported by the activation API.

On the inspected button cohort, the new event/read pipeline reproduces all original receipt arrays: Safari 20/20 eligible out of 25 planned, Chrome 25/25. Safari's five ineligible rows remain in the all-plan denominator; diagnostic matching on those rows does not make them verified. Both profiles also reproduce the 40/40 original checkbox receipt arrays. These are calibration results, not independent evaluation.

## Frozen composition experiment

Two new nested main/region and fieldset layouts combine plain, toggle and expanded buttons, a stable selected toggle, an inline-described toggle, repeated activations and reverse focus. The twelve-command sequence differs from the earlier calibration. Template/site/contrast and complete-action groups were checked against 810 prior cases with no declared collisions. The two new cases remain one connected test group. This is a small synthetic composition transfer study, not random live-page validation or proof of global structural independence.

Before Native collection, the input bytes, verification files, JavaScript build and predictions were frozen. Both Native browser runs completed before engine/input changes. The initial model used Safari v15 / Chrome v9. All 24 actions per browser were observed and input-verified; all twelve activation before-targets were independently verified against their archived before-AX snapshots. Eleven actions per browser had measurable pressed/expanded state: ten changes and one deliberately unchanged selection. One plain activation has no state property. State observations qualify the speech inputs; they do not constitute whole-engine State Accuracy or identify a logical VO cursor.

| Metric per profile | Safari first evaluation | Chrome first evaluation | Safari corrected regression | Chrome corrected regression |
| --- | ---: | ---: | ---: | ---: |
| Planned / Native observed / eligible | 24 / 24 / 24 | 24 / 24 / 24 | 24 / 24 / 24 | 24 / 24 / 24 |
| Main Speech Exact | 22/24 (91.7%) | 19/24 (79.2%) | 24/24 | 24/24 |
| Literal Full Speech, preserving repeats and order | 22/24 | 19/24 | 24/24 | 24/24 |
| Hint candidate exact | 24/24 | 24/24 | 24/24 | 24/24 |

Conditional and all-plan rates are equal here because every planned input was eligible. Two attempts completed with no startup failures. All four starts aligned. Two Safari failures and five Chrome failures share one cause: a toggle's inline description belongs immediately after its name, before mixed/selected state and role. The formatter had restricted that placement to plain buttons and checkboxes. The correction extends the inline-description rule to button states; Chrome's value-change prefix composes with the same description ordering. No target name, fixture ID, exact layout or Native speech enters the rule input. Safari v16 / Chrome v10 identify the correction. The original predictions and first scores remain unchanged; the inspected cohort is now regression.

The [portable fixture](https://github.com/bh2980/rawstep/blob/claude/voiceover-speech-pattern-collection-5ba5cc/tests/fixtures/voiceover-evidence/native-activation-transfer-2026-10-15.json) preserves all HTML, commands, authored before/after inputs, original predictions, raw receipts, environment, command/AX clocks, source hashes and quality decisions. Native receipt windows have a 2.2-second minimum after acknowledgement, 1.2-second quiet interval and 7.5-second maximum. They do not prove synthesis completion, causal ordering of all internal events, or identical behavior with different delay preferences. Navigation Accuracy and Task Success are unmeasured.

## Reproduce and limits

```sh
npm run build
npx vitest run tests/mock-voiceover-activation.test.ts tests/mock-voiceover-activation-transfer.test.ts
node scripts/test-browser.mjs tests/mock-voiceover-button-state-speech.integration.test.ts tests/mock-voiceover-activation-transfer.integration.test.ts
node --test examples/v2/voiceover-speech.test.mjs
cd packages/vo-corpus
node --import tsx --test test/activation-transfer.test.ts test/speech-evaluation.test.ts
npm run generate -- --set activation-transfer-v1 --out data/cases/activation-transfer-copy
```

The installed package contains the browser-free example and typed API. The API emits receipt candidates, not TTS or a queue model. Live-region changes, interruption, activation-caused navigation, focus movement, arbitrary widget roles, button VO activation and transition-to-mixed events need additional Native evidence. New random-domain validation remains separate from this synthetic result. The older live eight-page sample repeatedly reused the same candidates and had alignment/content failures; it cannot establish current formatter generalization.

Local Native runs: Safari `activation-transfer-v1-2026-10-15T09-18-55-021Z`; Chrome `activation-transfer-v1-2026-10-15T09-20-57-454Z`. Environment: macOS 26.6.2, Safari 26.6.2 / Chrome 155.0.8059.80, English VoiceOver, `baseline-v2-dnd`. Cases SHA-256 `3b76824f8fee0e2998f1ced8231a1283100a614db7874a91194962a348c1bc66`; caller inputs `745d78d5e5172d3ab739fc80a9379431b1c48c16a04d6a8cc01e89a59b7dd895`; initial model JavaScript `01d14f6476f2e6644109b8033df7896b0e63689afbf92412399fd7175e7e7e65`.
