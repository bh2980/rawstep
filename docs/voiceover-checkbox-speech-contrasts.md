# Checkbox speech contrasts

The speech function needs to reproduce the result of an action supplied by Rawstep. A checked-state change is not always a new reading of the target. This controlled experiment isolates native/ARIA implementation, description presence and activation command under the Safari and Chrome reference profiles.

## Design and Native evidence

Eight conditions crossed native HTML checkbox versus ARIA checkbox, no description versus `aria-describedby`, and Space versus VO+Space. Gesture pairs used identical HTML. Description pairs changed only `aria-describedby`; the same hidden description node existed in both. The ARIA control implements Space on key-up, prevents scrolling, and toggles on click. A real Chromium fixture check independently verifies both keyboard and click state changes.

Each case issued Tab, activation, Tab, Shift+Tab, activation. Both checked and unchecked transitions were observed. These are **calibration pairs**, not independent evaluation: all eight cases share one input group. The plan preserves twelve exact-sequence overlap entries involving three historical case IDs; those historical observations must not be reused as fresh holdouts in a future combined split. Old scores and labels remain unchanged, and the split planner must review connected-group assignments before combining datasets.

The caller inputs, JavaScript build and verification code were frozen before collection. Safari completed eight cases in 3.6 minutes and Chrome in 3.8 minutes, before speech-engine changes. All 40 planned actions per browser were observed, all inputs verified, all eight starts aligned, and all sixteen checkbox transitions per browser verified against before/after AX values. There were two attempts and no startup failures.

| Action on changed checkbox | Safari Native main | Chrome Native main |
| --- | --- | --- |
| Physical Space | State, name, inline description if present, checkbox | Same |
| VO+Space | State, name, inline description if present, checkbox | State only: `checked` / `unchecked` |

Both native and ARIA implementations behaved this way, with and without the inline description. Reading/returning to the checkbox used its object announcement and hint. Neither activation command emitted a new hint in the measured windows (minimum 1.8 seconds, quiet interval 1.2 seconds, maximum 7 seconds). Bounded host receipts do not prove native synthesis completion, and absence in these windows is not a universal future-silence guarantee.

## Frozen predictions and correction

| Metric per profile | Safari before | Chrome before | Safari regression after | Chrome regression after |
| --- | ---: | ---: | ---: | ---: |
| Main exact | 40/40 | 32/40 | 40/40 | 40/40 |
| Literal full receipt arrays | 32/40 | 32/40 | 40/40 | 40/40 |
| Hint candidate exact | 32/40 | 32/40 | 40/40 | 40/40 |

The same main counts held when preserving punctuation/case and folding only whitespace. All planned rows were eligible, so conditional and all-plan rates are equal here. The original model predictions and pre-calibration results remain embedded in the [source fixture](https://github.com/bh2980/rawstep/blob/claude/voiceover-speech-pattern-collection-5ba5cc/tests/fixtures/voiceover-evidence/native-checkbox-speech-2026-10-15.json). After correction these inputs are regression evidence; 40/40 is not an independent generalization score.

The Chrome value-only rule existed in the browser adapter but was missing from the externally callable speech function. It now lives in `formatVoiceOverSpeech`. The adapter delegates checkbox speech to that function; its existing radio behavior remains separate. A Chrome checkbox VO-activation value event returns the value wording and preserves prior structural speech history, because it does not announce a new reading of a group/table. The function also omits a hint candidate for a verified checkbox state change with either measured activation command. It continues to offer a hint when reading the control.

No fixture ID, target name, description text or exact HTML arrangement participates in these rules. Browser profile, semantic role, actual state change and action determine the output. No navigation behavior was added.

## Reproduction and remaining scope

From a source checkout:

```sh
npm run build
npx vitest run tests/mock-voiceover-checkbox-contrast.test.ts
node scripts/test-browser.mjs tests/mock-voiceover-checkbox-contrast.integration.test.ts
cd packages/vo-corpus
npm run generate -- --set checkbox-speech-v1 --out data/cases/checkbox-speech-copy
```

The shared fixture preserves HTML, original inputs and predictions, raw speech receipts, environment, wire/AX timing, AX source hashes, input-quality decisions and before/after transition observations. Full AX snapshots remain in the immutable local source archives. A generator regression test prevents the shared HTML, commands and caller inputs from drifting from the captured experiment.

This study uses Tab entry and return. Historical VO-entry captures sometimes contained a hint alongside the first state change, and did not all have equivalent receipt/AX timing. Those raw observations remain intact; they do not justify an unconditional claim about hint causality. VO-first entry, altered hint delays, rapid repeated input, required/readonly/mixed controls, form error changes and unfamiliar nested layouts still need controlled observations. Native Navigation Accuracy, full State Accuracy and Task Success are unmeasured; the 32 verified state transitions are speech-input evidence.

Local sources: `checkbox-speech-v1-2026-10-15T08-19-55-866Z` (Safari), `checkbox-speech-v1-2026-10-15T08-23-54-833Z` (Chrome). Cases SHA-256 `53d96bc54ba744976b4762906667a485312e8ca6a5424fdfc7f5e1f074534643`; caller-input SHA-256 `6fd1bea67588b69cf0afd5a9df979cf693e2592ceaf11ff59b09bc7f536b5f67`; pre-observation model JavaScript SHA-256 `89cf7a5e827acdc7da751d1f10713dc0baaf52c1835b62b3720fb821da9615c6`. Baseline profiles were Safari v12 / Chrome v6; post-correction profiles are Safari v13 / Chrome v7.
