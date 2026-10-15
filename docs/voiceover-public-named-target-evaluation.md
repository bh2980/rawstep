# Actual-site target-conditioned collection

This experiment evaluates the speech engine on Native-derived, externally supplied targets. It does not implement simulator navigation or treat keyboard focus as the VoiceOver reading cursor. The [complete sampling/count audit](../packages/vo-corpus/test/public-named-target-audit.json) records original failures, recovery attempts and the next unseen-domain evaluation separately. Raw site AX/speech, potentially including location or personal text from site UI, stays local.

## Fixed model and target procedure

The Safari v17 / Chrome v11 JavaScript build remained `6c92a01398ed0784b3eb66026be71a317de16c5bd0abb3553eb2505a11a991a2` throughout all four attempts. Site pools, seeds, role slots, model and acquisition/verifier source hashes were fixed before opening each cohort. Each site has four planned slots: button, link, button, link. Candidates are enabled Native controls with a unique role/name, selected by hash rank without inspecting speech or predicted correctness. Missing roles and failed targets are retained. This biases selection toward uniquely named enabled controls and does not cover unnamed/disabled defects or representative web element frequencies.

Native AX focus is guarded by the actual page URL, expected foreground browser, unique role/name and confirmation of keyboard focus on that exact object. VO+Shift+F4 is unscored setup. Buttons move away/back with Shift+Tab/Tab; links use VO+Left/VO+Right. The intended target attributes come from an AX path, independently of cursor confirmation. Previous used context comes from visible ancestor observations even when the previous object's own speech role is unsupported. The complete prediction is sealed **before** the scored return. Actual target/state/ancestors after the return must still pass the independent visible-geometry/AX verifier. Neither setup speech nor scored speech becomes a prediction input.

Unused container item-count placeholders are marked unmeasured; they are not observed zeroes or future ML ground truth. Root-probe timestamps use host Unix milliseconds; action/receipt/AX windows retain their session origin. Raw observations remain separate from model inputs and derived judgments. Live HTML/targets can differ across browsers, so these captures are separate profile measurements, not a causal same-HTML browser comparison. The [controlled composition study](./voiceover-landmark-transfer.md) supplies that shared-HTML/command evidence.

## First cohort and measurement recovery

Seed `9a9d4f515e7e245aa16f2605aadeaec0` selected Open Library's history search and Python's documentation page after excluding earlier domains. Original acquisition preserved only 3/8 scored actions per browser. The first Chrome comparison was Main 1/1 eligible and literal Full 0/1; Safari had no eligible comparison. The overall planned Main match rate was 1/8 and 0/8 respectively. This sparse first result is retained rather than presented as broad 100% accuracy.

The recovery exposed two measurement gaps. `AXContentList` ancestry was rejected even though the formatter already consumes list context. The observer now preserves that plain-list role and previous list-marker ancestry; list widgets remain unsupported. Separately, a quiet page-load speech gap occurred while Safari still exposed the **old Python document**, and Chrome sometimes had no new AX web area yet. Requested URL, original query parameters and nonempty AX body are now observed before page preparation. Same-origin slash/query-key canonical additions are accepted; old pages, changed requested values and other origins fail. Root probes and timeout receipts are journaled, and the standard collector uses observation protocol **v8** rather than silently resuming v7 data. A shallow readiness probe is navigation-commit evidence, not network-idle, complete content, reading-position or speech-completion evidence.

With the same sites/seed/model and corrected acquisition, Open Library's document appeared after 14 probes / 10.9 seconds in Safari and 20 probes / 12.8 seconds in Chrome. The final same-site recovery retained:

| Per profile, 8 planned returns | Safari | Chrome |
| --- | ---: | ---: |
| Native return windows observed | 6 | 7 |
| Target/state + command inputs verified | 6 | 5 |
| Normally comparable | 5 | 4 |
| Conditional Main Speech Exact | 5/5 | 4/4 |
| Conditional literal Full Speech Exact | 4/5 | 3/4 |
| Main matched / all planned | 5/8 | 4/8 |

The remaining Full failures are tooltip-help trailing spaces. One Safari named-focus setup failed independent confirmation; missing second-button slots, unknown previous context and unmeasured reading targets remain visible. These are inspected-site recovery results, **not an independent generalization score**. Original source-wrapper failures and stale prose about list support remain in the audit metadata notes; no raw files or scores were overwritten.

## Next unseen-domain evaluation

After those acquisition changes, seed `7a37ed26634f93b81661f3013fab8560` selected NASA News and NPR News from the remaining six-domain pool, excluding all prior domains. All acquisition/verifier helpers and the speech model were verified byte-identical to the completed recovery before either new site was opened. No engine/input rules changed between profiles.

| First v2 evaluation, 8 planned returns per profile | Safari | Chrome |
| --- | ---: | ---: |
| Requested documents observed | 2/2 | 2/2 |
| Native return windows observed | 7 | 5 |
| Normally comparable | 0 | 0 |
| Main / Full conditional accuracy | unmeasured | unmeasured |
| Verified Main matches / all planned | 0/8 | 0/8 |

This result does **not** prove a 0% wording rate: no speech comparison met the input-quality gate. It does prove that the current acquisition/evaluation coverage cannot substantiate broad actual-site accuracy. NASA's sampled content controls require article context; NPR adds web dialogs and nested web areas. Footer-link returns also had unmeasured target/previous-context geometry. The missing role quotas are not replaced. These failures remain in the planned denominator and now make both sites inspected regression material.

The next structural work is to independently establish article naming, dialog entry versus within-dialog context and frame/document boundaries. The library has article/dialog formatting paths, but parts of their Native naming/count behavior remain unverified; the existing Chromium browser adapter is limited to the main document. Those are distinct from the already verified plain button/link/checkbox/landmark wording. Loosening the gate, inventing missing counts or silently dropping frame/dialog/article context would create misleading scores. The two-news-site sample is also too small and narrow to establish generalization even if acquisition succeeded.

The standard collector's v8 integration was checked on the existing plain-target fixture in **both Native browsers**, each with one requested document observed, one aligned start and both planned actions retained. That is a collector smoke check, not new speech accuracy evidence. Its Native reading-position description command remains separate from ordinary navigation wording.

The [later v3 actual-site/input audit](./voiceover-public-target-v3.md) uses two further site groups after the dialog
correction. It identifies missing list-link set metadata in the observer/verifier, preserves the original scores and
reports corrected-input regression separately. The v1/v2 observations and results above remain historical evidence.
