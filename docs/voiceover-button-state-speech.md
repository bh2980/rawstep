# Button state speech: Native findings and remaining gaps

This controlled study separates reading a button's current state from the receipts caused by activating it. Five pages share the same button, name, handler and markers. Only `aria-pressed` and `aria-expanded` differ: plain, false pressed, mixed pressed, false expanded, and false pressed plus false expanded. Each case performs Tab, Space, Tab, Shift+Tab, Space. The handler records actual activations and changes each present state attribute. The page test independently checks both activations and the caller's planned states in Chromium.

The inputs and Safari v13 / Chrome v7 JavaScript build were frozen before either Native run. All conditions are calibration pairs in one connected group; historical exact action-sequence overlaps are retained in the plan. This is not an independent generalization evaluation. Native collection used macOS 26.6.2, Safari 26.6.2 / Chrome 155.0.8059.80, English VoiceOver, `baseline-v2-dnd`, and a minimum two-second observation window after acknowledgement. Both attempts completed with five aligned starts per browser and no startup failures. All 50 planned actions remain in the [source fixture](https://github.com/bh2980/rawstep/blob/claude/voiceover-speech-pattern-collection-5ba5cc/tests/fixtures/voiceover-evidence/native-button-state-speech-2026-10-15.json).

## Findings

| Space on the same button | Safari receipts | Chrome receipts |
| --- | --- | --- |
| Plain button with no accessible state change | Silence | Silence |
| Pressed state changes | Silence | One object-change receipt; selecting puts `selected` before the name |
| Expanded state changes | Two identical current-state object receipts | Two identical current-state object receipts |
| Pressed and expanded change together | Two identical toggle-button object receipts | One pressed-change receipt followed by two identical toggle-button object receipts |

On entry and return, a pressed button is read as a toggle button. When pressed and expanded coexist, expanded wording is omitted in both profiles. This role precedence now applies in the shared formatter, independent of names, fixture IDs or HTML layouts. Safari v14 / Chrome v8 identify that change. The pure target formatter is an object-reading function. The separate [activation API and transfer evaluation](./voiceover-activation-evaluation.md) now address the measured silence, repeated receipt arrays and Chrome pressed-change order.

Native exposes the pressed state as AXCheckBox + AXToggle in Safari and AXCheckBox + AXToggleButton in Chrome, with values 0, 1 and 2. The old Native-state converter interpreted Safari mixed as false, and Chrome toggles as checkboxes. It now preserves false/true/mixed as pressed state and maps both subroles to button. Invalid or missing values remain unknown. Original AX files and historical derived reports are unchanged; rerunning the state analyzer uses the corrected mapping.

## Input audit and results

The original speech-input verifier did not independently validate pressed/expanded. Its limitation was declared in the frozen plan. After Native collection, an explicit input audit added those checks and captured the audit source hashes separately from the original verifier hashes. This is a post-observation measurement correction, not a preregistered accuracy gate. No observed speech enters the prediction input.

Safari omits AXExpanded on the combined pressed/expanded control. Four target inputs therefore remain unmeasured; the intervening marker verifies, but lacks verified preceding context. Neither missing property nor correct-looking speech becomes input equivalence. Of eight planned state transitions, six are verified and two unmeasured in Safari; all eight are verified in Chrome. These checks establish supplied speech states, not whole-engine State Accuracy or VO navigation position.

| Per-browser denominator / metric | Safari frozen | Chrome frozen | Safari v14 target regression | Chrome v8 target regression |
| --- | ---: | ---: | ---: | ---: |
| Planned / Native observed | 25/25 | 25/25 | 25/25 | 25/25 |
| Independently verified inputs | 21/25 | 25/25 | 21/25 | 25/25 |
| Eligible with prior context | 20/25 | 25/25 | 20/25 | 25/25 |
| Main Speech Exact, eligible | 12/20 (60%) | 15/25 (60%) | 12/20 (60%) | 17/25 (68%) |
| Main matches / all planned | 12/25 (48%) | 15/25 (60%) | 12/25 (48%) | 17/25 (68%) |
| Literal Full Speech, eligible | 12/20 | 13/25 | 12/20 | 15/25 |

The current formatter reproduces all 15 reading/return rows per browser, including the three combined-control rows, as a text diagnostic. Safari's five ineligible rows remain excluded from conditional accuracy and retained in the all-plan denominator. Reading success does not erase the activation failures. Repeated receipts stay in Main Speech; they are not collapsed to inflate its score. The original frozen predictions and first evaluation remain intact.

The immediate structural gap is the pure API's single object announcement plus optional hint: it cannot yet express an empty event or ordered repeated announcements from an activation. The adapter already has some event handling, but its toggle rules also need the browser distinction measured here. The [subsequent activation API](./voiceover-activation-evaluation.md) shares measured event formatting with the adapter using independently observed before/after states; it adds no navigation. VO activation, timing preference changes and new UI compositions require separate evidence; this physical-Space cohort does not establish their behavior. Native completion, Navigation Accuracy and Task Success remain unmeasured.

## Reproduce

```sh
npm run build
npx vitest run tests/mock-voiceover-button-state-speech.test.ts
node scripts/test-browser.mjs tests/mock-voiceover-button-state-speech.integration.test.ts
cd packages/vo-corpus
node --import tsx --test test/button-state-speech.test.ts test/button-state-native.test.ts test/speech-input.test.ts
npm run generate -- --set button-state-speech-v1 --out data/cases/button-state-speech-copy
```

The portable fixture includes HTML/scenarios, frozen caller inputs and predictions, original speech receipts, command/AX clocks, before/after state sources, AX file hashes and explicit input-quality decisions. Full snapshots remain in the immutable local runs: Safari `button-state-speech-v1-2026-10-15T08-56-16-845Z`, Chrome `button-state-speech-v1-2026-10-15T08-59-04-172Z`. Cases SHA-256 `d529c98c7df0fad4ea432aa0ec6e6b9978a6954372b7acf84759c3d9aa5d96ff`; caller inputs `3dda3c3f0ef3a5d9f41190464e716fbe6947d8e704679f4687ff234a35f02d65`; frozen model JavaScript `92934e131f842f998609b534b54b5caaf6c9dbc6141b9d649a4f767bbdae76ce`.
