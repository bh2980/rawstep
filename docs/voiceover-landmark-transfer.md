# First evaluation of new landmark/state compositions

The previous unnamed-landmark correction was frozen in Safari v17 and Chrome v11 before authoring two new six-control compositions. This evaluates the externally supplied-target speech and activation APIs, without implementing or scoring a simulator navigation engine.

The journal page combines an image-named described button, a toggle, tooltip help, a described checkbox, unnamed banner/main/footer and named navigation/region. The reservation page nests a named group inside unnamed complementary/main regions, changes checkbox/expansion/mixed-toggle states, exposes/hides a real disclosure panel and returns across a named footer. The 15- and 17-action histories differ from earlier complete sequences. The input-group audit found no declared template/site/contrast or exact-sequence collision against **828** prior cases. This is a small composition transfer cohort; shared primitive roles do not establish global structural independence.

Both HTML pages, all caller inputs, model JavaScript, Native acquisition/verifier sources and per-browser predictions were sealed before either Native profile ran. Freeze time: `2026-10-15T11:01:56.963Z`; model JavaScript SHA-256: `6c92a01398ed0784b3eb66026be71a317de16c5bd0abb3553eb2505a11a991a2`. There were no engine/input changes between or after the two captures. The original [Native fixture and first results](../tests/fixtures/voiceover-evidence/native-landmark-transfer-2026-10-15.json) preserve source hashes, shared HTML, commands, predictions, per-command/receipt/AX timing, before/after state evidence and all denominators. These inspected pages are now regression material; their first evaluation remains the prospective result below.

| First evaluation | Safari + VoiceOver | Chrome + VoiceOver |
| --- | ---: | ---: |
| Planned / Native observed | 32/32 | 32/32 |
| Target/state + command inputs verified | 32/32 | 32/32 |
| Eligible bounded-window comparisons | 32/32 | 32/32 |
| Main Speech Exact, conditional and all-planned | 32/32 | 32/32 |
| Literal Full Speech Exact, conditional and all-planned | 28/32 | 28/32 |
| Normalized hint candidate equality | 32/32 | 32/32 |
| Observed activation-state transitions verified | 9/9 | 9/9 |

All 64 Main results also match with case and punctuation preserved after whitespace folding. The four literal Full failures per browser are trailing spaces on two tooltip-help phrases, including three visits to the same control. No roles, states, word order, repeated activation receipts or hints are missing in those cases. They remain literal failures, not excluded rows or silently normalized Full successes. End-space transport fidelity is a lower-priority limitation than missing speech/context; the engine was not patched to raise this cohort's score.

The nine checked/pressed/expanded transitions per browser are independently checked against Native before/after AX states, and disclosure text presence is checked against actual exposed static text. They validate the supplied activation inputs and fixture state, **not** overall simulator State Accuracy or Task Success. Stable visible outlines identify target geometry independently of keyboard focus; this is not a direct logical-cursor API or a Navigation Accuracy result. Bounded host receipt windows do not prove Native speech completion or causality of every late receipt. Native browser viewport sizes and protected preference uncertainties remain separate environment limits.

This supplies new-UI evidence for the observed role/context/state combinations after the earlier correction. Two related synthetic pages and 32 correlated actions per profile are insufficient to establish broad real-site accuracy or freedom from overfitting. Live unseen-site validation continues separately, and failures from earlier real-site collection remain intact.

Reproduce the shared inputs with `npm --prefix packages/vo-corpus run generate -- --set landmark-transfer-v1 --out data/cases/landmark-transfer-v1-recheck`, then run the existing Native collector separately for Safari and Chrome against the new output directory. Keep the [collection environment and independent profiles](./voiceover-target-conditioned-evaluation.md). Browser-free replay is `npm test -- tests/mock-voiceover-landmark-transfer.test.ts`; source/keyboard assertions are `node --import tsx --test packages/vo-corpus/test/landmark-transfer.test.ts` from the repository root. Preserve the original first-score fixture when making future corrections.
