# Seeded real-page pilot: collection failure remains visible

This experiment tested whether the current real-page collection path could validate the speech library outside its synthetic calibration pages. It did not produce comparable Native action windows. No real-page speech accuracy or freedom from overfitting is established by this pilot.

Before viewing either selected site's Native output, a twelve-URL pool spanning blogs, news, search, shops, services and documentation was recorded. Seed `669590104a1d26e61b611b52cde4a860` selected [Josh W Comeau's blog](https://www.joshwcomeau.com/) and the [National Park Service park finder](https://www.nps.gov/findapark/index.htm). Neither domain was in the historical candidate pool. A new 24-action read-only sequence per page was checked against prior case groups/full sequences without declared collisions. No failed site was replaced. This is sampling within a small declared pool, not a representative random sample of the web.

## What was fixed before Native

The shared [case inputs](../packages/vo-corpus/test/public-transfer-v1/cases.json), [full sampling record](../packages/vo-corpus/test/public-transfer-v1/sampling.json) and [quality audit](../packages/vo-corpus/test/public-transfer-v1/quality-audit.json) retain the selected URLs, seed, pool, commands, viewport and failed attempts. Cases were authored with full per-action AX capture before execution. The original `unseen` label describes that pre-observation moment; these sites are now inspected protocol-development material and must not be reclaimed as fresh holdouts.

The Safari viewport was measured as 1024 × 626. The model's input anchors came from an independently captured host Chromium AX tree, without using VoiceOver speech. The frozen v16 Safari model replayed all 48 actions and aligned to both host anchors. Its output records were sealed at `2026-10-15T09:42:37.530Z`, before the first Native attempt began at `09:43:36.413Z`. JavaScript SHA-256 `e91cc6e7de8a11608a49ea0c08afd0b2bf921b53d625b7695b8836c56eee3986`; sealed model-record SHA-256 `b1de7d994d65f80b15a2328fe2d816a105e372538651350cb4ef3b864831a7db`. Frozen JavaScript and raw archives remain local.

## Observed result

| Collection stage | Planned Native actions | Observed action windows | Aligned sites |
| --- | ---: | ---: | ---: |
| Original natural-heading protocol | 48 | 0 | 0/2 |
| Protocol recovery, same sites/commands/model predictions | 48 | 0 | 0/2 |

There are 48 unique planned actions and 96 planned actions across the two retained attempts. Both attempts keep the failed starts and original observations. Main Speech Exact, Full Speech Exact, input-equivalent comparisons, Navigation Accuracy, State Accuracy and Task Success are **unmeasured**, not successful. Overall planned collection completion is 0/48 in each attempt. The 48 recorded simulator action windows are not Native observations.

The original service-page attempt heard the intended heading but then incorrectly ran a keyboard-focus check for an injected marker that this protocol does not use. The collector now keeps natural-heading starts separate from marker checks and captures an AX snapshot without that focus-transfer command. Its heading-level extraction also uses the actual AXHeading numeric AXValue observed in Safari, validating the 1–6 range and preserving invalid values as unknown. Unit checks and corpus type checking cover that extraction. Original run files were not rewritten.

After that measurement correction, both sites still failed to reach the declared Native heading reliably. The blog's first AX heading has one-pixel-wide bounds; the evidence does not establish why heading navigation skipped it. The service retry reported no heading found. These are collection/setup failures. They do not justify changing wording rules or declaring the selected web pages unsupported by the speech formatter. No speech-engine changes were made after this live sample's predictions were sealed. The retry is protocol recovery on inspected sites, not a new independent holdout.

The private model-first wrapper also omitted `casesGeneratedAt` from run metadata. The standard evaluator correctly refused that metadata. The audit separately verifies the archived case bytes, fingerprint and archived generation timestamp; raw model metadata was preserved. This bookkeeping failure is recorded, and future wrapper outputs include the missing field. It does not turn the failed Native captures into comparable observations.

## Scope and next measurement

The existing live-page Native path currently supports Safari. Chrome Native has independent controlled-HTML speech evidence, but this live pilot does not validate its profile. Public-page AX-text fingerprints are conservative global checks; they do not prove identical per-target semantics or reading positions.

For the speech library, a failed whole-page start must not force speculation about wording. A subsequent probe should independently observe a Native reading target's role, state and context, freeze the caller input and model prediction, then capture the matching Native reading event. That evaluates the externally supplied-target API without implementing movement inside the library. Unknown target identity/context remains unmeasured. Successful random-page speech validation is still required, with new site groups reserved after protocol development.

Native run directories: `public-pages-669590104a1d26e61b611b52cde4a860-first-heading-2026-10-15T09-43-36-413Z` and `…09-48-19-092Z`. The model run is `public-pages-669590104a1d26e61b611b52cde4a860-first-heading-sim-pre-native-2026-10-15T09-41-32-792Z`. Complete source hashes and failure messages are in the shared quality audit. The reproducible input directory is `packages/vo-corpus/test/public-transfer-v1`; the original caller-input synthetic regression results remain in the [activation evaluation](./voiceover-activation-evaluation.md).
