# Linked-heading speech and input projection — 2026-10-16

Rawstep still owns target selection and movement. This change preserves the compound meaning of a heading/link
in its existing speech input, and independently checks that meaning against Native AX and the visible outline.
It adds no movement implementation. Safari and Chrome remain separate profiles (v26 / v20).

## Controlled evidence

Four shared pages hold text, style and three object next/previous actions constant: ordinary link, ordinary h2,
link wrapping h2, and h2 wrapping link. Both browsers completed all 12 actions. HTML, released v25/v19 predictions,
actual Rawstep inputs and observation sources were frozen before Native. The original
[fixture](../tests/fixtures/voiceover-evidence/native-linked-heading-source-2026-10-16.json) is immutable calibration.
The first verifier accepted 8/12 current inputs and 6/12 complete comparisons per browser; Main was 6/6 and literal
Full 4/6. Four compound inputs and two previous contexts remained unmeasured. Those are the original scores.

| Object-reading unit | Native main speech | Native hint role |
| --- | --- | --- |
| Ordinary link | link + name | link |
| Ordinary heading | heading level 2 + name | heading |
| Link wrapping heading | link heading level 2 + name | link |
| Heading wrapping link, Safari | heading level 2 link + name | heading |
| Heading wrapping link, Chrome | heading level 2 level 1 link + name | heading |

Native heading hints have two spaces before the web-area exit instruction in these controls. Preserve literal
receipts separately from normalized main/hint metrics. The hint role follows the outer measured unit; the mere
presence of a link does not establish a link hint.

## Separate level attributes

A subsequent metadata-only Chrome probe on the same document exposed heading AXValue=2 and AXDisclosureLevel=1.
This was not a read-cursor observation and is not backfilled into the earlier snapshots. Chromium's
[macOS implementation](https://chromium.googlesource.com/chromium/src/+/HEAD/ui/accessibility/platform/ax_platform_node_cocoa.mm)
maps heading hierarchical level to zero-based disclosure level. The Chromium adapter derives that separate field
for its single-link heading projection. The formatter accepts `semantic.nativeDisclosureLevel`; Safari omits the
additional wording. The currently measured positive range does not certify h1/zero disclosure or mixed headings.

AX schema v7 now captures AXDisclosureLevel and collection protocol v10 identifies that instrumentation. Old missing
values remain unknown; old run metadata and first evaluations are retained. The extra word's generality must be
checked on a fresh level and structure before claiming transfer.

## Native input verification boundary

The verifier accepts next/previous object reading on a complete, unique, equal-name single heading/link pair with
one plain-text unit and no help, extra custom content or nondefault states. Generic unnamed wrappers may be
transparent. It verifies heading order, parts, link identity and independently exposed Chrome disclosure level.
It rejects incomplete children, aliases, name disagreements, extra content, unmeasured commands and selecting an
inner child outside the measured outer-unit scope. The physical outer heading's DOM ID differs legitimately from
the activation link's ID. Neither is inferred from speech or keyboard focus.

Specific unmodeled AXGroup roles, including image-map containers, cannot silently become transparent ancestors.
Ordinary unnamed generic groups keep their previous behavior. A previous object's observed ancestor context can
be checked without claiming support for that object's own utterance.

## Reserved evaluation

Before inspecting calibration, two other wrapper/reverse-entry compositions were reserved with h3/h4 and a
different seven-action history (14 actions per browser). They are fixture-health reading sequences, not completed
user tasks. Their HTML and action sequences stay fixed. Freeze the corrected model and actual inputs before Native;
report first input equivalence, Main, Full and all-plan counts separately. Unknowns are not successes. These small
synthetic cohorts cannot establish overall 90% web accuracy, logical-cursor Navigation Accuracy or speech timing.
