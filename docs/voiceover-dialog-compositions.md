# New dialog compositions and description/help input correction

The speech engine consumes Rawstep's selected target, state, command and previous context. This experiment adds no movement implementation. Two new tasks put a nonmodal named dialog inside an article or named form, with inner groups, forward/reverse returns, checkbox/toggle/disclosure changes and independently verified save outcomes. Safari and Chrome use the same HTML and complete commands; their Native inputs and results remain separate.

## Frozen first evaluation and input audit

Cases/model/predictions were fixed before either Native browser. The two declared template/site/contrast groups and complete action histories had no collision against 865 prior cases. Primitive roles and previously observed rules are shared; this does not establish global structural independence or representative web sampling. Cases SHA-256: `c0216f69bdf3669fb2a52ebfbbcc49e22ea69ef3ca1e6f937e8cb1094bf4da57`. Model JavaScript SHA-256: `8b86cf97886e5332846611e5bf6b264e86c3e8d06063427273cae752dd920ece`, Safari v20 / Chrome v14.

Actual formatter calls, previous contexts and output windows were sealed at `2026-10-15T16:14:23.096Z`, before Native collection. The model came from the collection worktree, including pending evaluator diagnostics; the plan retains source/build hashes and does not claim a pristine commit build. macOS 26.6.2, Safari 26.6.2, Chrome 155.0.8059.80, English VoiceOver, locale en_KR and `baseline-v2-dnd` were recorded. Protected/unknown settings are not asserted equal.

The [original fixture](../tests/fixtures/voiceover-evidence/native-dialog-compositions-2026-10-16.json) retains every first input, prediction, score, receipt, clock, AX hash and task outcome. Its original gate claimed all 39 inputs were equivalent in both browsers. Inspection of Safari's three Full failures found omitted `AXHelp`: Rawstep supplied the inline ARIA description but dropped the independent title help. The verifier also skipped help when the expected input omitted that field. This is one input-conversion/verification cause across first entry and two returns, not three separate speech rules.

The [separate audit](../packages/vo-corpus/test/description-help-input-audit.json) rechecks **every original input** against the preserved AX snapshots with the stricter verifier. It never rewrites the first fixture or supplies the observed words as prediction input.

| First predictions, corrected input gate | Safari | Chrome |
| --- | ---: | ---: |
| Planned / Native observed | 39 / 39 | 39 / 39 |
| Input-equivalent / normally comparable | 36 / 36 | 39 / 39 |
| Missing-help input differences | 3 | 0 |
| Main Speech Exact, conditional | 36/36 | 39/39 |
| Literal Full Speech Exact, conditional | 36/36 | 39/39 |
| Main / all planned | 36/39 (92.3%) | 39/39 |
| Literal Full / all planned | 36/39 (92.3%) | 39/39 |

Independent geometry/AX joins matched the actual model reading target on 39/39 actions per browser. Keyboard focus was separately observed and matched 39/39. The five predeclared boolean checked/pressed/expanded transitions matched 5/5; repeated post-state fields matched 97/97. Both environments independently met both final task outcomes (2/2). Five transitions are not 97 distinct transitions, and these controls do not measure value/selection state or general logical-cursor Navigation Accuracy. The missing-help fields do not invalidate the separately observed target/state evidence.

## Controlled source contrasts

After finding those failures, five calibration pages change only the target button's source attributes: referenced description alone; referenced description plus a different title; `aria-description` plus title; title alone; referenced description with an equal title string. Each uses Tab, Shift+Tab, Tab. Shared templates and command sequences are deliberate calibration overlap, not independent evaluation.

Both Native profiles completed 15/15 actions before conversion/verifier changes. The [calibration fixture](../tests/fixtures/voiceover-evidence/native-description-help-combinations-2026-10-16.json) preserves original actual inputs and first scores. Independently observed `AXCustomContent` and `AXHelp`, not spoken text, establish source placement:

| Source | Safari | Chrome |
| --- | --- | --- |
| ARIA description only | Inline description; more-content hint | Same |
| ARIA description plus title | Inline description plus independent title-help prefix | Inline description; superseded title omitted |
| Equal referenced description/title | Both sources retained | Description retained; title omitted |
| Title only | Help prefix, no inline description | Same |

The old input gate falsely accepted six Safari and two Chrome calibration inputs. The audit preserves them as input mismatches. Missing inputs are neither wording failures nor successful comparisons.

## Correction and regression scope

Safari v21 / Chrome v15 preserve CDP described-by source relationships even when title and description strings are equal. For the calibrated native HTML button scope, Safari additionally preserves title help alongside the ARIA description; Chrome keeps its measured omission. The existing pure formatter already supports separate `description`, `help` and `hasMoreContent`; its wording rules are unchanged. Other roles and ambiguous sources still need independent Native evidence.

The verifier now detects omitted observed help, inline description, additional-content availability and expanded state. Conflicting help aliases remain unmeasured. Old snapshots lacking custom-content observations are not retroactively filled. Small tests reproduce the omitted-field false acceptance before the correction.

The browser regression reexecutes the HTML and full command histories, checks actual formatter inputs against the independent AX source audit, checks reading IDs/ancestor context, compares ordered outputs and rechecks all declared state fields and final outcomes. It reports literal Full separately from content equality; Native title-help receipts retain a final space absent from the candidate. These inspected pages are regression/update material after correction, never fresh holdouts. See the [correction report](../packages/vo-corpus/test/description-help-projection-correction.json) for measured counts and build/source hashes.

| Actual Rawstep regression | Source fields / planned | Ordered full content, Native final spaces removed | Literal Full |
| --- | ---: | ---: | ---: |
| New task compositions, Safari | 39/39 | 39/39 | 36/39 |
| New task compositions, Chrome | 39/39 | 39/39 | 39/39 |
| Source calibration, Safari | 15/15 | 15/15 | 7/15 |
| Source calibration, Chrome | 15/15 | 15/15 | 13/15 |

Main Speech matches all 39 task actions per browser in the separate AX-supplied formatter regression. This is
post-inspection evidence, not a replacement for the audited first-evaluation denominators above. Calibration's
unchanged enabled-state oracle is a fixture-health check, not five additional successful user tasks.

Bounded Native receipts and the model's 900 ms windows do not establish queue timing, completion, interruption or asynchronous causal attribution. No general 90% VoiceOver replacement claim follows from these small tasks. Existing actual-site preparation/reading-target gaps remain in their original reports.

## Reproduction

From the repository root:

```sh
npm run build
npm run test:integration -- tests/mock-voiceover-description-help.integration.test.ts tests/mock-voiceover-help.integration.test.ts
node --import tsx --test packages/vo-corpus/test/speech-input.test.ts packages/vo-corpus/test/dialog-compositions.test.ts packages/vo-corpus/test/description-help-combinations.test.ts
npm --prefix packages/vo-corpus run generate -- --set dialog-compositions-v1 --out data/cases/dialog-compositions-update-check
npm --prefix packages/vo-corpus run generate -- --set description-help-combinations-v1 --out data/cases/description-help-update-check
```

Collect a fresh generated directory with the existing VM/relay collector for each browser, retaining every run/attempt. Regenerated inspected pages detect update regressions; they do not measure new generalization. Source Native runs and full AX/overlay archives stay local under `packages/vo-corpus/data/runs/`; public fixtures link source hashes and contain generated test text.
