# Native description and help receipts

This is a controlled calibration report for the **speech engine**. Rawstep supplies the target, state, action and previous context. `formatVoiceOverSpeech` returns wording and a hint candidate; it does not execute the action. Safari and Chrome remain separate reference profiles.

## Observation

On macOS 26.6.2 with the recorded English VoiceOver settings, the same `Print copies.` button was observed with four conditions: no description, `aria-description`, `aria-describedby` referencing the same hidden text, and `title`. Only the description attribute changed; all four pages contained the same hidden description node. Each page used Tab, Shift+Tab, Tab, testing first entry and return. The four conditions share a template, contrast group and action sequence and are **calibration/regression**, not independent evaluation.

Both browsers exposed these differences:

| Source | Native main receipt | Native help/usage-hint receipt |
| --- | --- | --- |
| None | `Print copies. button` | Ordinary button hint |
| `aria-description` | `Print copies. Copies, not originals. button` | Includes the more-content-menu instruction |
| `aria-describedby` | Same inline description | Includes the more-content-menu instruction |
| `title` | `Print copies. button` | Help text precedes the ordinary hint |

The instruction is `Press Control -Option -Command -Slash to bring up the more content menu.` It followed the click instruction and preceded the exit instruction. First entry and return agreed in this cohort. That does not establish suppression behavior under other histories, timing settings or dynamic updates.

## Input evidence and preservation

Native description content was independently observable in `AXCustomContent`: an archived array with label `description`, value `Copies, not originals.`, and importance 1. Tooltip text appeared in `AXHelp`. The new AX schema 5 records bounded raw archive bytes, secure decoding, entries and API/decode status. Explicit API `noValue` establishes absence. Missing old fields, unsupported attributes, read/decode failures and withheld secure content remain unmeasured. Old AX snapshots are unchanged.

Chromium CDP reports a single description string for all three sources. The existing DOM adapter now distinguishes unambiguous ARIA descriptions from title help using DOM attributes and CDP described-by relations. It does not implement a replacement accessible-description algorithm. Combined/ambiguous sources, nested help contexts, other roles and live changes require further observation. For callers that already have semantic inputs, `SimulatedSemanticNode.description` is inline content, `help` is a help/usage-hint prefix, and `hasMoreContent` independently requests the observed menu instruction. Do not infer that flag from any arbitrary description string.

The [shared regression fixture](https://github.com/bh2980/rawstep/blob/385fad4/tests/fixtures/voiceover-evidence/native-additional-content-2026-10-15.json) preserves HTML, hashes, frozen original inputs/predictions, revised input provenance, Native receipts, timing, environment and source AX/record hashes. Full AX archives remain in the local source runs. Revised inputs use observed AX attributes, never speech. The original frozen input incorrectly represented title help as inline description in two actions per browser; these are recorded as input differences, not engine errors.

## Results and denominators

| Browser | Planned | Observed | Basic target verified | Revised source inputs verified | Main exact | Literal full exact |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Safari | 12 | 12 | 12 | 12 | 12/12 | 10/12 |
| Chrome | 12 | 12 | 12 | 12 | 12/12 | 10/12 |

There were two collection attempts, no startup failures and no omitted actions. Full speech compares receipt arrays literally, including order, repetition and whitespace. Both remaining differences per browser are the final space in Native's combined title-help/hint receipt. The engine preserves the observed two-space help/hint separator but does not synthesize that trailing space. Whitespace-folded full content matches 12/12. This is a separate diagnostic, not a replacement for literal full exact.

Frozen original predictions produced diagnostic main 10/12 and literal full 6/12 per browser. Only 10 original inputs per browser had equivalent description placement. Those diagnostics must not be presented as an accuracy baseline over 12 verified inputs. Revised inputs and post-observation calibration results remain separate from the frozen originals.

Main/hint receipt boundaries were manually reviewed for this small cohort. The generic corpus splitter currently recognizes ordinary hints at the beginning of a receipt and does not automatically identify title-prefixed hints. Its scores on these rows are not authoritative; the regression fixture retains the actual two receipt boundaries. A future generic classifier must use independently observed help context rather than the generated prediction.

Input verification uses stable unique visible geometry candidates plus AX role/name/state/ancestor observations. It is **not Navigation Accuracy or a logical VoiceOver cursor API**. There were no state-changing actions or whole-task outcomes here, so State Accuracy and Task Success are unmeasured, not 100%.

## Reproduction and provenance

From a source checkout, run the shared speech regression and Chromium projection checks after building:

```sh
npm run build
npx vitest run tests/mock-voiceover-help.test.ts
node scripts/test-browser.mjs tests/mock-voiceover-help.integration.test.ts
```

These replay stored Native evidence; macOS collection is a separate operation using the existing corpus collector. AX archive decoding has a macOS-only self-check in `packages/vo-corpus/test/custom-content.test.ts`; status validation is covered in `test/native-content.test.ts`.

Local source runs:

- Safari: `additional-content-v1-2026-10-15T07-27-42-538Z`
- Chrome: `additional-content-v1-2026-10-15T07-31-33-473Z`
- Cases SHA-256: `e20d40ffa02366effbc6a5fed6ab17972bd5d0741fb7e0af903bd553d81bcc7c`
- Pre-observation model JavaScript SHA-256: `7135faff19cebc4d2155d1e1e009c2cceba6dc2c5aaeb59736138a607a3e8ddb`

The pre-observation model was Safari v10 / Chrome v4. The correction is Safari v11 / Chrome v5. The earlier punctuation fixture remains unchanged, including its four unmeasured description inputs; this new schema does not retroactively fill missing old observations.

The later [combined-source study](./voiceover-dialog-compositions.md) adds controlled ARIA description plus title
contrasts, including equal strings. Safari v21 preserves the native button's independent title-help prefix; Chrome v15
retains inline description and omits the superseded title. The source-input verifier now catches omitted observed help,
description and more-content fields. Original inputs/scores above remain unchanged; other roles and ambiguous sources
remain uncalibrated.

The later [help/form study](./voiceover-hint-source-context.md) preserves the final space in emitted help receipts. Current inspected regressions now match all 12 literal receipt windows per browser; the original first scores above remain unchanged.
