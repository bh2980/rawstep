# VoiceOver observation evidence and simulation calibration

## What was collected

We collected **reported native VoiceOver output**, not just ARIA expectations or
browser accessibility-tree fields. No Mac or native VoiceOver session was run by
Rawstep during this work.

1. [Accessibility Supported](https://github.com/accessibilitysupported/a11ysupport.io)
   at commit `6730ad42e83dd780f63555ab3f14f1c26ea0fae5`: 548 macOS command-result
   records across 129 test/browser datasets. Test dates range from 2018-10-19 to
   2026-02-28. The records include actual reported speech, prose descriptions,
   templates, and reports of silence. They are **not 548 clean audio transcripts**.
2. [ARIA-AT published reports](https://aria-at.w3.org/reports): 742 scenario-result
   records across 32 finalized VoiceOver reports. These retain command sequences,
   reported AT/browser versions, report status and test references. Finalized
   results are not automatically vendor-approved. Some results are untestable,
   report no output, or contain test-harness capture artifacts.

The separate research corpus retains full provenance and quality flags. The
repository's small regression subset is in
`tests/fixtures/voiceover-evidence/a11ysupport-navigation.json`. Each case has a
commit-pinned source URL, JSON pointer, SHA-256, recorded environment and action,
verbatim reported speech, and an independently authored semantic abstraction.
These semantic inputs are **not captured native AX trees**.

## Implemented, narrowly supported changes

`english-dom-navigation-evidence-v2` is an explicitly **composite simulation
profile**. Its wording combines findings from different recorded OS/browser
versions. It does not identify itself as any actual VoiceOver version.

- Plain toggle-button navigation: `Action, toggle button`; selected state becomes
  `Action, selected, toggle button`; mixed becomes `Action, mixed, toggle button`.
  The false state does not add `not pressed`. This is supported by the
  [2025 aria-pressed results](https://a11ysupport.io/tests/tech__aria__aria-pressed)
  for VoiceOver/macOS 15.5 and Safari 18.5
- Checkbox navigation: name, checked state, `checkbox`, instead of placing the
  state after the role. The retained historical fixtures are corroborated by
  [ARIA-AT checkbox results](https://aria-at.w3.org/report/163678/targets/560)
- Disclosure-button focus: name, `expanded`/`collapsed`, `button`. See
  [aria-expanded results](https://a11ysupport.io/tests/tech__aria__aria-expanded)
  and [ARIA-AT disclosure results](https://aria-at.w3.org/report/163673/targets/549)
- Plain unvisited link navigation: `link`, name. See
  [simple-link results](https://a11ysupport.io/tests/tech__html__links__example1)
  and [ARIA-AT link results](https://aria-at.w3.org/report/163672/targets/548)
- Empty text fields: `edit text`, with `required` before the role when present.
  The inspected textarea form-navigation record uses name, `edit text`, value,
  with no added `multi-line` suffix. These are historical, version-limited records

The 13 selected navigation-wording comparisons matched 2 cases before this
change and 13 afterward. This comparison ignores case, whitespace, commas and
full stops, while retaining every word and its order. **13/13 is a result on this
small selected wording set, not a fidelity or accessibility-conformance score.**

## What is deliberately not claimed

- The runtime still uses Chromium semantics and produces simulation evidence.
  Collected Safari output does not establish Chromium/Safari AX equivalence
- The same formatter still summarizes current state after simulated activation.
  Native activation speech is action-specific. Checkbox activation can put the
  changed state first. A toggle's activation can produce a short state word or
  no speech. [ARIA-AT toggle results](https://aria-at.w3.org/report/163626/targets/483)
  and the a11ysupport records demonstrate why these are not navigation templates
- Space and VO+Space are distinct commands. The corpus preserves that distinction
  even where a simulation's DOM click is only an approximation
- Querying the VoiceOver cursor, querying keyboard focus, navigation, typing,
  and activation can announce different information. A role-only formatter
  cannot reproduce all of them
- Filled single-line inputs can announce selection/insertion state and hints.
  The current simulator does not model that state or VoiceOver's speech queue
- Password output remains deliberately sanitized. It does not attempt to
  reproduce character counts, autofill hints, or typing sounds
- Other role/state ordering, descriptions, hints, radio position, group context,
  heading behavior, live regions, earcons and timing remain uncalibrated heuristics
- OS/AT versions and test dates are preserved per record. Quick Nav, verbosity,
  punctuation, voice, keyboard layout and other unreported settings remain
  unknown; they are not replaced with assumed defaults
- Manual source transcripts can contain typos or omissions. The source output
  is retained, not silently corrected. Pinned example HTML can be newer than a
  historical result and is not proof of the exact historical DOM

Do not train or evaluate by turning assertion/expectation text into observed
speech. Likewise, `No output was detected.` is a report sentinel, not an utterance.

## Attribution and reuse

Accessibility Supported was originally created by Michael Fairchild and is
maintained by its contributors. Its site's footer explicitly offers text/data
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The repository
LICENSE and FAQ also contain GPL notices. Both notices are retained in
`tests/fixtures/voiceover-evidence/THIRD-PARTY-NOTICES.md`; no upstream application
or test HTML implementation was copied into the formatter. This project does
not claim that all upstream materials are MIT-licensed.

ARIA-AT materials are attributed to W3C and ARIA-AT contributors. The research
archive retains their source links, publication status and applicable W3C notices;
its reported observations must not be confused with copied test code, standards,
or an endorsed modified W3C document. No Apple/W3C/maintainer endorsement is implied.

## Verification

- `tests/mock-voiceover-evidence.test.ts`: 13 source-backed wording cases, explicit
  simulation provenance, and protected-value safety
- Existing Chromium-backed mock tests retain their navigation, DOM effect,
  focus, redaction and cancellation assertions; only affected speech wording
  expectations changed
- Run with the normal installed Playwright Chromium or set
  `RAWSTEP_TEST_BROWSER_PATH` to a verified compatible executable. Browser tests
  remain actual browser tests, not native VoiceOver tests
