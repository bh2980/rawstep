# VoiceOver speech sample coverage — 2026-10-15

The archive is sufficient to support some measured local wording rules and regression tests. It is **not evidence that the speech engine covers ordinary web usage adequately**. A perfect score on twelve repeated actions over one button does not establish that coverage. Distinct strings, observation events and independently verified input/output examples are different units.

## Existing archive before the new transfer experiment

Read-only inventory at 2026-10-15 07:58 UTC, before `speech-transfer-v1` produced any case record:

| Item | Count | Meaning |
| --- | ---: | --- |
| Native action records | 4,777 | Includes repeated runs and calibration |
| Native speech receipts | 8,963 | Includes hints and test markers |
| Content receipts under existing screening classifier | 3,875 | Not quality-approved training examples |
| Distinct normalized content strings | 1,421 | Not distinct behavior rules |
| Actions with a preserved after-AX file | 3,016 | File presence does not prove reading-target identity |
| Actions with before/after AX paths | 1,626 | The before snapshot is the previous observation, not necessarily an immediate pre-action observation |
| Actions with AX observation clocks and bounded host receipt attribution | 617 | Does not prove synthesis completion or causal attribution |
| Attribution unmeasured / uncertain | 4,159 / 1 | Retained, not successful observations |

The generic inventory does not have per-row observed `AXHelp`, so title-prefixed usage hints can be counted as content. Its 3,875 and 1,421 figures are screening figures; neither is a validated ML dataset size. Full source records and all old results remain unchanged.

## Measured imbalance

| Dimension | Native actions |
| --- | ---: |
| Safari reference | 4,281 |
| Chrome reference | 496 |
| VO+Right | 2,707 |
| VO+Left | 529 |
| Tab / Shift+Tab | 605 / 302 |
| Space / VO+Space | 115 / 93 |
| Next / previous heading commands | 76 / 5 |
| Next form-control command | 2 |

About 57% of actions use VO+Right, and about 90% are Safari. Counts describe issued commands, not independently verified command equivalence or successful target observations. Some historical runs lack archived scenario-family metadata; do not invent an observed role distribution from AX keyboard focus or case labels.

This imbalance makes additional forward-reading repeats a weak next investment. The priority is independently observed **role × state transition × action × previous context × browser** combinations, especially reverse entry, return after state changes, descriptions versus help, edits/selections, delayed changes and structure-dependent wording. Existing table/editing and live-content studies remain useful; their existence does not establish all combinations or causal attribution.

## Acquisition and evaluation policy

1. Use controlled pairs to discover a rule: same target, change one source/state/context; repeat enough to expose nondeterminism and delayed receipts. Repetition estimates consistency, not independent coverage.
2. Freeze new compositions and model predictions before observing Native. Keep template, contrast, site and exact action-sequence groups together; include unfamiliar structures and state histories. Once inspected, those cases become regression.
3. Verify semantic input independently: target candidates, current state, ancestor context and description/help source. A main-speech mismatch with unequal inputs is an input failure, not a wording rule to learn. A missing or ambiguous observation remains unmeasured.
4. Report normalized Main, punctuation/case-preserving content, literal full receipts, hint candidates and all-plan denominators separately. Raw observations, repetitions and failures are retained. A hint candidate is not a speech queue scheduler.
5. Expand where fresh combinations reveal a common error; retain counterexamples when a proposed rule does not transfer. Use stability on new structures and browsers as evidence, rather than choosing a fixed total sample count as a completion gate.

The next experiment is two newly authored nested form/fieldset layouts with descriptions, title help, checkbox changes and exit/return histories. Its input groups and full command sequences were checked against 791 existing cases before Native collection; the 21 actions per browser are a counterexample-finding evaluation, not proof that a large representative test set exists. The experiment plan explicitly excludes a global structural-independence claim.

There is no justified statement that “N utterances are enough” here. Rule confidence depends on controlled evidence, repeatability and transfer to fresh combinations. Future learned models need their own group-separated evaluation and learning curves; these raw archive totals should not be advertised as model-ready sample counts.

Local evidence: `packages/vo-corpus/data/analyses/speech-sample-coverage-2026-10-15/audit.json` and the original run archives. These counts are a dated snapshot and should not replace previous inventory results.
