# New-site speech input audit

After the dialog correction, seed `ef2cc8d61ff32b3ffa2d58cf5e55becb` selected [Smashing Magazine](https://www.smashingmagazine.com/) and [UNIQLO](https://www.uniqlo.com/us/en/) from four remaining blog/shop/service/documentation candidates. All previously planned case URLs and archived selection plans were excluded, including the inspected NASA/NPR cohort. This is sampling within a small declared pool, not representative web sampling.

The Safari v20 / Chrome v14 model remained `8b86cf97886e5332846611e5bf6b264e86c3e8d06063427273cae752dd920ece`. Selection, model and acquisition sources were fixed before either site was opened. Each profile kept four slots per site: two uniquely named enabled buttons and two links. Target attributes and previous context came from Native AX; each prediction was sealed before its scored return. Setup speech never supplied prediction inputs. Both profiles finished before analysis or observer changes. Dynamic sites can expose different content/targets across browsers, so this does not isolate causal browser differences or test Chromium-to-Native projection.

## Observations and an input-quality defect

| First attempt, per profile | Safari | Chrome |
| --- | ---: | ---: |
| Planned scored returns / Native observed | 8 / 7 | 8 / 7 |
| Planned setup keys / observed | 16 / 14 | 16 / 14 |
| Originally claimed comparable | 5 | 6 |
| Original Main and literal Full matches | 3 | 5 |
| Original matches / all planned | 3/8 | 5/8 |
| Previously accepted inputs missing set metadata | 2 | 1 |

The apparent wording failures are list links: Native includes an ordinal, while the observer omitted `semantic.position`/`setSize`. The formatter already supports these fields. The verifier also ignored their absence, so the original 3/5 and 5/6 conditional figures do not establish a speech-engine error rate under equivalent inputs. Original observations, inputs, predictions and first scores remain unchanged.

The corrected observer derives default ordinals only from complete, uniquely identified Native `AXContentList` children and the current link's direct list unit. Mixed direct children, such as a popup button, contribute to the count. A singleton still needs its observed 1/1 metadata even when the words happen to match without it. Truncated/alias-conflicting sets, explicit ARIA set attributes and multi-unit/named list-item contexts remain unmeasured. No count comes from a speech string. This reuses the existing semantic fields and leaves speech rules unchanged.

Applying the corrected gate to **every original input** identifies 2 Safari and 1 Chrome input mismatches, leaving 3 and 5 valid original comparisons. Their all-planned matches remain 3/8 and 5/8; unavailable comparisons were not converted to successes. The [audit](../packages/vo-corpus/test/public-named-target-v3-audit.json) preserves both original and corrected-gate summaries and the separate regression below. The singleton unit test explicitly rejects incomplete inputs even when a missing ordinal would not change speech.

## Observed-input regression and remaining gaps

The same frozen engine was replayed with the missing fields reconstructed from the original **pre-request** AX snapshots. Only set fields changed. The snapshots' observation times precede the original prediction seal and scored requests. These predictions were recomputed after inspection: they are input regression, not a fresh independent evaluation.

| Same observations, corrected inputs | Safari | Chrome |
| --- | ---: | ---: |
| Normally comparable / all planned | 5/8 | 6/8 |
| Conditional Main and literal Full matches | 5/5 | 6/6 |
| Matches / all planned | 5/8 (62.5%) | 6/8 (75%) |

Five planned slots still lack a valid complete comparison. One per browser failed AX focus preparation; these are collection/preparation failures, while the source wrapper's original environment-failure label is preserved. Three observed windows have unmeasured reading targets/previous context. The [independent geometry audit](../packages/vo-corpus/test/public-named-target-v3-reading-quality.json) shows the image-link cases have three distinct AXGroup/AXLink/AXImage candidates with the same outline geometry. The Safari blog case has an unavailable previous outline and an unmatched later outline. Neither speech text nor keyboard focus resolves those positions.

All 16 planned slots remain visible. Missing/ambiguous observations and failed preparations are not wording failures or successes. Conditional equality on eleven small, biased samples does not prove 90% generalization, and these sites do not validate the new dialog rule independently. Navigation Accuracy, whole-engine State Accuracy and Task Success remain unmeasured for this read-only target protocol. Bounded receipts do not establish causal attribution, completion or queue timing.

Raw website AX/utterances stay local; public audits contain URLs, metrics, source hashes and quality categories. Source code, raw records, initial scores and an intermediate observer audit were retained separately. Both sites are now inspected regression material and must be excluded from future unseen-site selection. The next evidence should check list/image input projection in controlled cross-browser contrasts and the corrected dialog rule on new compositions, while preserving current actual-site failures.

Run the parser and audit checks from the repository:

```sh
node --import tsx --test packages/vo-corpus/test/speech-input.test.ts packages/vo-corpus/test/speech-evaluation.test.ts packages/vo-corpus/test/public-named-target-v3.test.ts
```

These checks validate the input contract and preserved audit accounting; they do not revisit a live site or create new Native observations.
