# Dialog speech calibration

Safari v19 / Chrome v13 extend the existing supplied-target speech formatter with measured nonmodal dialog wording. No navigation state machine was added. The formatter uses the Native dialog name, its number of directly exposed AX children, and—when the name is empty—a named first exposed child for the summary. Chrome says `dialog`; Safari says `web dialog`. A named singleton omits the item-count phrase.

## Native evidence and measurement gap

Five shared pages compare a named direct dialog, the same buttons inside an anonymous wrapper, an unnamed dialog, native `<dialog open>` markup and a named singleton. All 29 actions per browser were captured, with five aligned starts each. Inputs and the unchanged Safari v18 / Chrome v12 model were fixed at `2026-10-15T13:35:37.902Z`, before either capture. Cases SHA-256 is `4535684458f75667a1af32bb8d28321bc27ea06e2f61e3936d4accaf554c87d3`; baseline model JavaScript SHA-256 is `a8530fcb08f6bffb448bc2beccbd8a4a4d2cd93e23b53d7c50746d70169cad27`.

The [original first-evaluation fixture](../tests/fixtures/voiceover-evidence/native-dialog-speech-2026-10-15.json) keeps the authored expectations, frozen predictions, raw receipts, before/after paths, timing, Native dialog attributes/child census and all failures. The old verifier withheld dialog contexts, so **eligible comparisons were 0/29 per profile** and conditional Main/Full accuracy was unmeasured. Observing 29 actions did not establish 29 comparable inputs. Outside-target attribute checks numbered 9 in Safari and 10 in Chrome, but could not establish the preceding dialog context. Diagnostic string agreement was not promoted to verified accuracy.

The controlled traces show:

- Dialog names/counts are announced on entry and re-entry, not each move between controls. Earlier live-site behavior after forced focus synchronization does not establish a different general rule.
- Four direct exposed children become three when two buttons are represented by one exposed wrapper. Native AX child identity/count, rather than flattened descendant reading-unit count, supplies `items`.
- Both direct and one-wrapper controls retain dialog hints in this cohort. The earlier hypothesis that the immediate AX parent alone determines hint location was not adopted.
- Safari exposes an unnamed dialog's heading as its Native description. Chrome leaves the Native name empty and reads the first child's name plus the remaining count, such as `Dispatch panel and 3 more items dialog`.
- Chrome uses `inside of a dialog` for named-dialog hints. Its unnamed dialog in this cohort retains web-content hints. Safari's observed heading-named counterpart uses web-dialog hints.

## Observed-target regression

The new Native constructor/validator preserves recognized web dialogs, verifies direct-child counts using complete snapshot-local AX identities and independently checks a supplied first-child name. Missing counts, incomplete attributes, unidentified children and uncalibrated nested/alert/frame contexts remain unmeasured. Other unused container counts retain explicit unmeasured-field paths. The field is not a phrase copied from an utterance.

The [separate observed-input fixture](../tests/fixtures/voiceover-evidence/native-dialog-observed-inputs-2026-10-15.json) constructs current reading targets from stable independent Native outline/AX observations. It does not use speech or AX keyboard focus to select those targets. Actual post-action target/state/context are the supplied inputs to this speech API; predicting those values or a navigation route is outside this measurement. Original authored inputs and first scores remain unchanged. This is inspected calibration, not independent generalization.

| Same observed inputs, 29 planned / observed / verified / eligible per profile | Safari v18 → v19 | Chrome v12 → v13 |
| --- | ---: | ---: |
| Main Speech Exact | 26 → 29 | 18 → 29 |
| Literal Full Speech Exact | 24 → 27 | 10 → 29 |
| Normalized hint candidate equality | 29 → 29 | 10 → 29 |

All rates use the full 29-action denominator; there were no environment failures in these two captures. The [correction report](../packages/vo-corpus/test/dialog-speech-correction.json) links the baseline input fixture to the corrected source/build hashes. Safari's two remaining literal Full failures are the double space in heading hints versus the candidate's single space. Their raw text is retained; this correction did not add whitespace exceptions to raise the score. Bounded receipt windows and candidate equality do not prove a Native speech queue/completion/interrupt model.

## Safari target differences are separate from wording

In Safari, `<dialog open>` adds a Tab stop at the dialog: AX keyboard focus is the dialog group while the independently observed VO reading target is its first heading. Subsequent targets are shifted relative to Chromium's ordinary button focus sequence. Five of six authored targets differ in that case. The supplied-target formatter reproduces all 29 Native Main outputs when given the observed targets, including the two heading observations. That does not repair or simulate the differing Safari movement behavior.

The real Chromium adapter checks all 29 commands per profile, retaining these five known differences explicitly. Its Native Main comparisons are **24/29 for Safari and 29/29 for Chrome**; all 24 Safari rows with equivalent supplied targets match. It separately checks actual Chromium DOM focus against the authored keyboard sequence. DOM focus is not substituted for the Native VO cursor, and this is not Navigation Accuracy. Modal opening/closing, alert dialogs, nested dialogs, forced-focus/interaction-mode effects and iframe contexts require additional evidence. Prior live-site failures and results are unchanged.

## Caller inputs and re-execution

`VoiceOverContainer.items` for a dialog is its direct exposed AX child count. `firstChildName` supplies the first exposed child's accessible name when the Native dialog name is empty. Preserve empty Native names rather than inventing the spoken summary. The Chromium adapter retains anonymous dialog scopes, counts unignored AX children without flattening exposed generic groups, and projects Safari's directly exposed heading name where observed. Callers keep returned speech context separate per browser/document/session.

From the repository root:

```sh
npm run build
npm test -- tests/mock-voiceover-dialog-speech.test.ts
npm run test:integration -- tests/mock-voiceover-dialog-browser.integration.test.ts
node --import tsx --test packages/vo-corpus/test/dialog-speech.test.ts packages/vo-corpus/test/speech-input.test.ts
npm --prefix packages/vo-corpus run generate -- --set dialog-speech-v1 --out data/cases/dialog-speech-update-check
```

Collect that new directory separately with `--browser safari` and `--browser chrome`, preserving the original captures and using the [existing VM/environment instructions](../packages/vo-corpus/README.md). These inspected pages are regression/update material. A later independent evaluation must freeze new inputs/model and use new template/contrast/site/action groups; this table is not a claim of 90% accuracy on arbitrary websites or overall State/Task performance.
