# VoiceOver observation evidence and simulation calibration

## What was collected

The initial research collected **reported native VoiceOver output**, not just ARIA expectations or
browser accessibility-tree fields. That phase did not run native VoiceOver. Local native collection and the v3
calibration described below followed on 2026-10-14.

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

## Local native calibration in v3 (2026-10-14)

`english-dom-navigation-evidence-v3` retains the historical wording fixtures and adds selected observations from
macOS/Safari/VoiceOver 26.6.2, captured in `vo-collector` with AT Driver 0.1.3 and its English capture voice. UI language
was en-US and locale en_KR. Verbosity, punctuation, grouping, Quick Nav and caption/capture agreement remain unverified.
It is still a composite Chromium simulation profile, not a complete emulator of that native configuration.

The new fixture file `tests/fixtures/voiceover-evidence/native-2026-10-14.json` retains 17 main-speech observations with
source run/case/step identifiers, SHA-256 of the original JSONL, commands and available per-action AX references/hashes.
Semantic inputs are manually abstracted from the fixture and native evidence; they do not establish Chromium/Safari
tree equivalence. Source runs and full raw captures remain local under `packages/vo-corpus/data/runs/`.

- Heading navigation: `heading`, `level N`, name, supported by all six native heading levels and forward blog jumps
- Boolean switch navigation: name, `on`/`off`, `switch`
- Plain checkbox/switch changes: state, name, role after Space or simulated activation, only when the same named
  object actually changes its boolean checked state. Replacement, renaming, mixed transitions and combined attributes
  do not use this calibrated change template
- Plain button descriptions: name, description, `button`, without changing toggle/disclosure combinations
- Next at a terminal enabled plain button: re-read the current button. The source matrix repeats the endpoint marker
  in 137 cases; applying this behavior to other button names is an inference. Other roles, disabled/toggle/disclosure
  endpoints, previous-boundary behavior and heading exhaustion retain their existing fallback semantics

The 17 selected wording fixtures matched 2 before and 17 after the change, ignoring separators but preserving words
and order. This is a calibration regression result, not a held-out accuracy estimate. Full before/after fixture replay
results and remaining limitations are documented in [the corpus README](../packages/vo-corpus/README.md).

## What is deliberately not claimed

- The runtime still uses Chromium semantics and produces simulation evidence.
  Collected Safari output does not establish Chromium/Safari AX equivalence
- Apart from the limited boolean checked-change rule above, the formatter still summarizes current state after simulated activation.
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
- Other role/state combinations, description timing, hints, radio position, group context,
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

- `tests/mock-voiceover-evidence.test.ts`: 13 historical and 50 selected local wording cases, explicit
  simulation provenance, and protected-value safety
- `tests/mock-voiceover-hints.test.ts`: 16 selected native role/context/direction hint receipts and protected/unknown
  semantic input guards
- Existing Chromium-backed mock tests retain their navigation, DOM effect,
  focus, redaction and cancellation assertions; only affected speech wording
  expectations changed
- Run with the normal installed Playwright Chromium or set
  `RAWSTEP_TEST_BROWSER_PATH` to a verified compatible executable. Browser tests
  remain actual browser tests, not native VoiceOver tests

## Structural and interaction calibration in v4 (2026-10-15)

Fresh local English captures contain 52 training cases and 52 initially held-out cases, 265 actions each, with a native
AX snapshot after every action. The held-out set changes names, input words and containing landmark context. Once its
results were inspected, subsequent replays were labeled regression rather than new held-out evidence. Nine additional
focus experiments (34 actions) test ordinary Space/Enter after VO navigation, text focus return and Tab across links.

The native profile projects named groups and landmarks with end stops, lists with markers/positions and nested levels,
description lists, table coordinates/column headers, dialog entry and item counts, radio/tab/menu positions, editable
caret/selection changes and listbox active descendants. It preserves native silence on keyboard activation of unchanged
controls and polls delayed live updates for an explicit minimum observation window. Local Space/arrow state receipts
also support repeated announcements for expanded buttons and manual/automatic tab selection. Those receipt counts
remain profile-specific; they do not establish an audio or speech-interruption model.

The focus experiments confirm that native VO navigation to an actual button or link synchronizes keyboard focus:
ordinary Space/Enter then executes that control. Static navigation preserves keyboard focus. The simulation now follows
that distinction and still refuses to repair missing widget handlers or type into an unfocused/noneditable element.

Validation uses every planned action, including missing, unaligned, unsupported and redacted actions as failures.
Marker-only receipts and silence have separate rates. Main speech excludes known usage hints; full speech retains them.
A separate generated-fixture oracle compares native AX focus/values/states with the simulated browser state. State
evidence does not select actions and is absent for ordinary private task inputs. Native secure-field values are excluded.

At the recorded focus-calibration checkpoint, training content main speech is 220/236 (93.2%), spoken content 201/217
(92.6%), and the bounded state oracle 254/265 (95.8%, including nine missing native state observations as failures).
Full speech including hints is only 75/265 (28.3%). The earlier validation set reached 213/238 content matches (89.5%)
on a subsequent regression replay. These are fixture measurements, not proof of full replacement or random-site accuracy.
The checkpoint runs and native source paths are recorded in `packages/vo-corpus/README.md`.

Thirteen additional matrix receipts calibrate explicitly named empty email/telephone/URL/number fields, empty required
and invalid inputs, current-page links and determinate/indeterminate progress indicators. Placeholder-only names,
prefilled selection receipts and password/autofill sequences remain separate unresolved cases. These are calibration
examples drawn from the existing matrix, not new held-out observations. A complete matrix replay after these changes
matches 517/803 spoken content steps (64.4%), up from 439/803 (54.7%) at the structural v4 checkpoint. The original
native matrix has no historical fixture byte fingerprint and is reported as legacy evidence.

Eight reduced live-page questions were then collected (54 planned actions). The main content score improved from
30/44 (68.2%) to 44/44 (100%) after treating image/SVG logos as a single `link image` stop and folding unmarked list
positions into their links, omitting the position for a single item. Six selected receipts are included in the native
wording fixture. This is a training regression; full speech including hints is only 2/54 (3.7%). A Tart internal
virtualization error stopped the guest after five cases; their records were preserved and the final three resumed
after restarting the same VM and AT Driver. The interruption is retained in the run's local resume event log.

Seeded live-page validation samples a fixed public URL pool before collection, preserves failed samples, adds the same
two harness markers in both browsers, and records URL, viewport and rendered-text hash. A content/viewport difference
counts as an environment failure rather than a speech match. The first native eight-page batch completed, with only two
aligned starts. One aligned page had different rendered text across browsers. Strict planned-step agreement was 15/240
(6.3%); full speech matched 0/240. This result includes setup/content failures and does not isolate the speech formatter.
The temporary Safari Apple Events JavaScript permission was restored off. Eight reduced follow-up cases now isolate
logo links, unstyled breadcrumbs, landmark boundaries, navigation headings and cookie regions before further fitting.
No real-page ≥90% or full-replacement claim is supported. Rotors, cross-frame traversal, native queue/interruption,
Safari Tab settings, provider/caption fidelity and complex widget patterns remain open work.

The redesigned paired collection and partition-scoped reports are documented in the corpus README's collection audit.
Twenty new cases retain complete action histories, attempt-specific native AX snapshots, input-byte archives and host
observation timing. A measured native-button contrast corrects physical Space dispatch when `aria-disabled` is only
an incorrectly enforced ARIA state; explicit activation and custom-control guards remain unchanged. Two legacy native
button receipts retain the observed `dimmed button` wording. The new frozen-model scenario test reached 14/20 content
matches (70.0%) and 4/22 full-speech matches (18.2%); it does not support a 90% replacement claim. The existing 52-case
regression remains 219/238 content, 200/219 spoken and 74/265 full speech after this correction.

## Article reading units in v5 (2026-10-15)

Native contrasts show that text headings containing links and links wrapping headings form one reading stop, with
nesting- and command-dependent wording. A fully linked heading uses its actual anchor for keyboard focus and guarded
activation; a partially linked heading preserves static focus. The native profile also projects article names and
boundaries, named figure boundaries, unnamed figure/header/footer contents, isolated punctuation and a repeated text
receipt for simple date-only `time[datetime]`. Other datetime formats and mixed interactive/image headings remain
uncalibrated. Same-document activation updates the reading cursor after an actual hash change without manually
repairing DOM focus. Unchanged hashes, duplicate targets and shadow-tree targets need separate native validation.

The original 12-case article calibration improves from 5/57 (8.8%) to 54/57 (94.7%) content matches. Its remaining three
failures include a native Safari-unresponsive receipt and following cursor divergence. They remain in the historical
denominator. Analysis emits quality-review warnings without changing observations or scores. A separate two-case
activation repeat has 8/8 main-speech matches but 0/8 full-speech matches; it does not replace the failed original run.

Twelve additional calibration questions (81 actions) and eight reserved new compositions (79 actions) use a constant
page title and pre-observation frozen input-group partitions. The v5 build was fixed before opening the reserved results.
Calibration content matches 46/48 (95.8%). The first reserved composition test matches **45/50 content steps (90.0%)**,
45/49 spoken steps (91.8%), 73/79 all main-speech steps (92.4%), and 76/79 bounded state checks (one native observation
missing). **Full speech including hints matches only 23/79 (29.1%)**. The familiar 52-case regression remains unchanged
at 219/238 content, 200/219 spoken, 74/265 full speech and 254/265 bounded state checks.

These are small synthetic compositions, not a random-site or full-replacement result. The reserved set is now inspected;
further fitting must treat it as regression. Transfer errors involve containing-context heading jumps, headings in
tables and fragment destinations. Safari/Chromium Tab preferences and usage hints remain substantial gaps. Run IDs,
source hashes, reports and the next collection priorities are recorded in the corpus README.

## Usage hints and actual summary activation in v6 (2026-10-15)

Twenty new calibration pages (145 native actions) and eight reserved compositions (89 planned actions) extend the
corpus with role/state, containing context, revisit, directional boundaries and editing histories. Sixteen selected
native hint receipts retain source hashes in `native-hints-2026-10-15.json`. Hints depend on observable semantic
structure and navigation history, not fixture IDs or a lookup of element names. The default minimum post-action
observation is 800 ms; hints are polled after a rounded 600 ms delay from the main receipt, with repeated-target
suppression and pending-hint cancellation on another action. Local receipt intervals do not establish audio latency
or native interruption fidelity. Corpus-based alternative wording profiles retain their historical behavior.

Calibration also identified an unsupported actual HTML summary activation. The native profile now activates the
summary through the existing guarded click, emits its observed `expanded` / `collapsed` state receipt, and suppresses
the repeated summary child-text stop. Browser checks verify the actual details state, reading order, hints and focus.
Editing/autofill hints, protected-field hints, timing preferences and complete speech queues remain incomplete.

On the same 20 calibration pages, content main speech improves from 91/101 (90.1%) to 95/101 (94.1%). Full speech over
all planned actions improves from 26/145 (17.9%) to 133/145 (91.7%); **content full speech with marker steps excluded
improves from 10/101 (9.9%) to 91/101 (90.1%)**. Bounded state matches 140/145, with two missing native state readings.
The confirmed build and predicted outputs were fixed before opening native transfer labels.

The first eight-composition test reaches only 46/89 (51.7%) full speech and 32/72 (44.4%) content full speech. Three
start-focus failures leave 31 actions absent; these remain failures. Labels after controls, controls inside table
cells and dialog Tab order also fail in successfully started cases. Later start-recovery repeats are separate
diagnostics, never replacements for the first test. This set is now inspected and future fitting must call it
regression. Passing ≥90% on the calibration set does not satisfy the replacement goal or real-site/NVDA validation.

The familiar 52-case / 265-action regression preserves main content 219/238 (92.0%), spoken content 200/219 (91.3%) and
bounded state 254/265 (nine missing). Full speech improves from 74/265 (27.9%) to **211/265 (79.6%)**; full speech with
marker-only steps excluded is **185/238 (77.7%)**. Exact measured JS and engine source hashes are archived locally.
These results still leave substantial full-speech, real-site and native NVDA work before a replacement claim.
