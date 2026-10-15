# Speech descriptions, state changes and return history

This experiment answers whether the description/help rules learned on a single flat button also work in new nested forms with checkbox changes and return histories. **They did not transfer completely:** frozen Safari v11 and Chrome v5 predictions each matched 15/21 main utterances (71.4%). The later 21/21 result is inspected regression after correction, not a fresh independent score.

## Frozen inputs and scope

Two newly authored pages combined a region/form/group with a described checkbox and a help-bearing button, and a main/fieldset/nested group with a help-bearing checkbox and described button. Their 11- and 10-action sequences used Tab, Shift+Tab and Space. The two templates, comparison/site group and exact command sequences had no declared group/sequence collisions with 791 existing cases. This is a deliberately targeted synthetic composition evaluation, not random-site validation or proof of global structural independence.

Predictions, source HTML, caller-owned semantic inputs and the model JavaScript were frozen before Native collection. Both browsers finished before engine changes. Verification code hashes were frozen too. Native description/help values, ancestors, target/state and stable visible geometry candidates were checked independently of speech. All five checked-state changes per browser were verified against before/after Native AX values. AX keyboard focus was not substituted for the VoiceOver reading cursor.

| Metric, each browser | Frozen first evaluation | Post-correction regression |
| --- | ---: | ---: |
| Planned / Native observed actions | 21 / 21 | Same observations |
| Input verified / eligible | 21 / 21 | Same inputs |
| Main Speech Exact | 15/21 | 21/21 |
| Main, preserving punctuation/case and folding only whitespace | 15/21 | 21/21 |
| Normalized hint candidate | 16/21 | 21/21 |
| Literal full candidate receipts | 4/21 | 12/21 |
| Full candidate content after whitespace folding | Not the original primary metric | 21/21 |

There were two Native attempts, no startup failures and 42/42 planned actions observed across both browsers. Eligible and all-planned main rates are equal in this cohort. Remaining literal full differences are nine title-help receipts per browser with one final Native space; the original receipts remain intact. Native State Accuracy, Navigation Accuracy and Task Success were not evaluated. Five verified state transitions are input-quality evidence, not a whole-engine state score.

## Causes and correction

The six main failures per browser all involved the same described checkbox under different states and entry histories. They are not six unrelated rules:

- On reading or entering the checkbox, Native placed the inline description immediately after its name, before checked-state and role wording. The engine had placed it after the role.
- On a checked-state change, Native put the resulting checked/unchecked state first, then name and inline description, then checkbox. The old state-change fast path excluded descriptions.

The formatter now handles these as role/state/description rules, without matching fixture IDs, strings or HTML arrangements. Plain switches retain their previous description behavior because this experiment did not observe described switches.

The five Space state changes per browser emitted a change receipt with no usage-hint receipt in the bounded observation window, while reading or returning to the same control produced a hint. The speech function now omits a hint candidate for a verified checkbox change with `activate_form_control`; it retains hints for subsequent reading. This is a command-context rule under the measured profile, not a universal native completion/timing guarantee. VO+Space with descriptions, required/readonly or custom checkbox combinations and other timing settings still need targeted observations.

The browser adapter already uses the same speech function; new Chromium integration tests replay the shared HTML and commands against Native receipts. Existing scalar, group/table-context and description/help fixtures remain regression evidence. No navigation behavior was added for this correction.

## Evaluation corrections, without changing old results

`checkSpeechInput` now validates supplied description/help/additional-content fields against actual AXCustomContent/AXHelp, retaining missing old observations as unmeasured. The speech evaluator can classify help-prefixed hints using independently observed AXHelp. It never uses the predicted string to decide which Native receipt is a hint. Generic callers without that context retain their previous behavior; historical reports and frozen predictions are unchanged.

Original first-evaluation results are embedded in the [source regression fixture](https://github.com/bh2980/rawstep/blob/claude/voiceover-speech-pattern-collection-5ba5cc/tests/fixtures/voiceover-evidence/native-speech-transfer-2026-10-15.json). It includes shared HTML, original model/input hashes, timing, environment, AX source hashes, transition observations, raw receipts and per-action quality. Full AX trees remain in the local immutable source archives. Once inspected, these inputs were recorded as regression; post-correction results do not replace the first evaluation.

From a source checkout:

```sh
npm run build
npx vitest run tests/mock-voiceover-description-transfer.test.ts
node scripts/test-browser.mjs tests/mock-voiceover-description-transfer.integration.test.ts
```

Regenerate the shared pages and commands with the existing collector generator, choosing a new output directory rather than replacing old inputs:

```sh
cd packages/vo-corpus
npm run generate -- --set speech-transfer-v1 --out data/cases/speech-transfer-copy
```

Local sources: `speech-transfer-v1-2026-10-15T08-00-27-869Z` (Safari), `speech-transfer-v1-2026-10-15T08-02-32-918Z` (Chrome). Cases SHA-256 `6efd720396e2d6568c58bd127dfab5c466b141d73fb289d57e929b611c786194`; caller inputs SHA-256 `2e6266e75656841910515999e9e040930eec329dbc304bf7dc5c74b76ff1bef2`; pre-observation model JavaScript SHA-256 `03772cb8b14d7e39877545c5540633d7ef53868bdc48ffd6b997edfd41d11c25`. Post-correction profiles are Safari v12 / Chrome v6.
