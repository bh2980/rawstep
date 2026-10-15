# Target-conditioned speech measurement

The speech library consumes an externally supplied target, state, command and previous context. Native setup actions are measurement preparation; this experiment does not implement or evaluate simulator navigation. Raw AX focus and the visible VoiceOver outline remain separate observations.

## Command calibration, 2026-10-15

Eight static conditions use the existing button/checkbox fixtures plus a link and heading: plain button, false toggle, mixed toggle, collapsed disclosure, described checkbox, described toggle, link and heading. Every case first enters its target with Tab or VO+Right, then sends VO+F3. Both browser profiles, all authored inputs, HTML, verifier source hashes and model predictions were sealed before Native collection. The model JavaScript hash is `e91cc6e7de8a11608a49ea0c08afd0b2bf921b53d625b7695b8836c56eee3986`. These are calibration fixtures with reused source groups, not independent holdouts.

| Stage, per browser | Planned | Native observed | Target/state verified | Established command mapping | Main Speech Exact | Literal Full Speech Exact |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Entry, Safari | 8 | 8 | 8 | 8 | 8/8 | 7/8 |
| Entry, Chrome | 8 | 8 | 8 | 8 | 8/8 | 7/8 |
| VO+F3, Safari | 8 | 8 | 8 before and after | 0 | unmeasured | unmeasured |
| VO+F3, Chrome | 8 | 8 | 8 before and after | 0 | unmeasured | unmeasured |

VO+F3 produces an orientation description, ending in `is in the VoiceOver cursor`, without a usage hint. It also puts link/heading names before roles, unlike the ordinary entry announcements in this cohort. The original candidate experiment incorrectly hypothesized that this chord could proxy the formatter's `read_current` label. Its frozen candidate equality was 0/8 per browser. That is a rejected command-equivalence hypothesis; it must not be converted into navigation accuracy, a general speech-engine failure rate, or successful navigation matches by stripping the suffix.

The [immutable source fixture](../tests/fixtures/voiceover-evidence/native-describe-current-2026-10-15.json) retains all 32 Native action windows, candidate inputs/predictions, original scoring, source hashes, timings and independently visible target evidence. The separate [command audit](../packages/vo-corpus/test/describe-current-command-audit.json) records the measurement correction without overwriting the original scores. `evaluateSpeechCandidate` now requires an established chord-to-speech-command mapping in addition to a matching target and bounded receipt window. Unknown commands remain in the planned denominator. Identical strings cannot bypass that gate.

The entry Full Speech differences are the heading hints' double space in Native versus a single space in the candidate. Their original literal failures remain; the engine was not changed to improve this small calibration score. Bounded receipt attribution is not proof of speech completion or late-receipt causality.

Reproduce the HTML and Native calibration with the existing tools after building Rawstep and starting the guest AT Driver endpoint:

```sh
npm --prefix packages/vo-corpus run generate -- --set describe-current-v1 --out data/cases/describe-current-v1-recheck
cd packages/vo-corpus
node --import tsx src/collect.ts --vm vo-collector --url ws://127.0.0.1:14382/session --browser safari --cases data/cases/describe-current-v1-recheck --settings baseline-v2-dnd --visual-cursor
node --import tsx src/collect.ts --vm vo-collector --url ws://127.0.0.1:14382/session --browser chrome --cases data/cases/describe-current-v1-recheck --settings baseline-v2-dnd --visual-cursor
```

Use a new output directory for every generated version; generation refuses to replace existing inputs. `--settings` records an existing verified environment label rather than changing settings. The relay address is local infrastructure, not a public service. Native collection requires the running configured guest and permissions. The corpus tests check source reproduction and the command gate without a Native VM.

## Live-page return protocol

The next protocol selects a target with a Native setup Tab, captures its independent visible/AX attributes, moves away with Shift+Tab, observes the previous target/context, then seals the input and prediction **before** a scored Tab return. An unchanged target-state/ancestor signature before the return and independently verified target/state afterward are required. Setup speech is archived, never supplied to the predictor. This avoids substituting orientation wording for an ordinary Tab announcement.

`observedSpeechInput` constructs caller inputs from independently visible Native targets, not from utterances or AX keyboard focus. It currently handles button, checkbox, link and heading roles and named ordinary ancestor contexts. Missing custom-content/state observations and table/cell/list/outline/dialog/article ancestry remain unmeasured; the helper does not invent missing context. The derived input tests the formatter independently of Rawstep's Chromium-to-Native semantic projection, which still needs separate validation.

The procedure and model are fixed before visiting sampled domains; each Native-derived input is sealed before its scored event. This is a prequential target-conditioned experiment, not a fully preauthored frozen-HTML evaluation. Browser content may differ, so results cannot establish causal Safari/Chrome differences. All setup and scored-action denominators, missing inputs, environment failures and late-receipt uncertainty must be retained. A selected site is never replaced because collection failed, and an inspected site becomes regression material for future work. New-site generalization and overall 90% accuracy remain unproven.

## Live pilot result and reduction

Seed `cc3bc670e8dabea4fc9af235ad117245` selected Project Gutenberg's history search and eBay's notebook search from the remaining ten-domain pool, excluding previously planned live domains. The original model and selection procedure were fixed at `2026-10-15T10:21:24.474Z`. The [initial audit](../packages/vo-corpus/test/public-target-return-audit.json) preserves both profiles and the same-site protocol recovery; the [scope audit](../packages/vo-corpus/test/public-target-return-scope-audit.json) separately corrects a newly discovered input-verification defect.

| Stage | Planned / observed scored Tab returns | Planned / observed setup keys | Currently comparable speech |
| --- | ---: | ---: | ---: |
| Original, both browsers | 16/16 | 32/32 | 0 |
| Same-site protocol recovery, both browsers | 16/16 | 36/36 | 0 |

The 32 observed return windows are real Native observations, unlike the earlier pilot's failed starts. They still do not establish a speech accuracy rate. Many selections reached browser chrome or unsupported controls/contexts. Recovery prepared keyboard focus inside the URL-guarded web area and synchronized VoiceOver before each page; this is not proof of a particular reading target. The source wrapper originally summarized only constructed predictions under `nativeObserved`; both audits instead count the raw action journal across **all** planned rows, preserving the original wrapper output locally.

A Chrome local-network permission alert was active in UserNotificationCenter while System Events continued to mark Chrome frontmost. After the already-authorized permission was granted, the guard was changed to NSWorkspace's active application and tested against this disagreement. New standard collector sessions use observation protocol v7, so old sessions cannot silently resume under the stronger guard. The Native Swift focus helper separately requires an exact page URL, the expected foreground browser and independent confirmation that keyboard focus is within that web area. It never reports that keyboard focus is the VoiceOver reading cursor.

One recovery comparison initially appeared eligible and mismatched: Native appended the unnamed banner role to the eBay home image-link, while the candidate omitted it. Inspection exposed two related issues: the Native input builder/verifier both discarded landmarks with empty names, and the speech formatter also ignored an explicitly supplied unnamed landmark during Tab entry. The corrected verifier requires every exposed landmark role, even if its name is empty. That turns the earlier input-equivalence claim into an input mismatch; the original result remains visible. Native web dialogs and embedded web areas, also present in the shop flow, remain unmeasured rather than being treated as context-free buttons. No location/personal text from that flow is published.

`landmark-speech-v1` reduces the banner finding to ordinary buttons in unnamed banner/navigation/main/complementary/contentinfo containers and a named-banner contrast. Its five-action sequence covers entry, movement within a region, exit, reverse reentry and movement within it again. This is calibration derived from an inspected real-site failure; later corrected scores must remain regression results, not fresh real-site generalization.
