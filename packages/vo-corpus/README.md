# vo-corpus

Collects real VoiceOver speech through AT Driver, to calibrate Rawstep's VoiceOver simulator against it. macOS only.

This package lives on a collection branch and is not merged into master. It will move to its own repository with
`git subtree split --prefix=packages/vo-corpus`, so keep it self-contained:

- Import Rawstep only through its public exports (`rawstep/at-driver`, `rawstep/mock-voiceover`), never its internal files
- Collected data goes to `data/` and stays out of git. Copy small, versioned snapshots into Rawstep's `tests/fixtures/` for regression tests
- Rawstep's build, typecheck and tests do not include this package

## Probe and screening run

The collector and fixture server run on the host Mac. `--vm vo-collector` runs Safari, VoiceOver commands and the native
AX dumper in the guest. Results stay under this package's `data/runs/` on the host; only the helper binary is copied into
the guest. Build Rawstep first (`corepack pnpm build`); this package imports its public `dist` exports.

Before running, start the [Bocoup macOS AT Driver server](https://github.com/bocoup/macos-at-driver-server) in the guest,
enable VoiceOver using **the guest's System Settings > Accessibility > VoiceOver switch**, and select the capture voice.
Command+F5 can reach the host instead of the guest. The npm 0.1.3 package installed by `vm/setup-guest.sh` did not include
the native capture app in our VM; a separately built app was needed. An npm install alone is not proof of voice readiness.
The capture voice is registered as English; adding it as an additional voice and selecting it with the voice rotor
captured Korean announcements in the 2026-10-14 probe. Voice previews alone are not a capture check.

```sh
corepack pnpm --filter vo-corpus probe --vm vo-collector --page smoke.html VO+Home VO+Right
corepack pnpm --filter vo-corpus generate --set screening-v1
corepack pnpm --filter vo-corpus collect --vm vo-collector --cases data/cases/screening-v1 --settings <verified-profile-id>
```

`probe` prints speech but does not save records. `collect` saves `meta.json`, `records.jsonl`, and one initial AX tree per
page under `ax/`. Add `--url` to override the endpoint. In this session, direct guest-IP connections failed and a temporary
Tart control-channel relay supplies `ws://127.0.0.1:14382/session`; that relay must be running to use this address.
`--settings` is a label, not an instruction to apply settings. Use a provisional profile id until guest settings are checked.

`screening-v1` has 20 cases on 18 pages, selected across buttons, checkbox/radio, text input, required/described input,
select/range, headings, images, lists, tables, navigation, details, dialog markup, and Korean/English text. This is more
varied than the first 20 rows of `elements-v1`, which are mostly buttons. It checks capture and navigation, not complete
widget correctness or rotor support.

When running locally, leave the host alone. In a VM run, leave the guest window alone; the host remains usable. A
frontmost-app or connection failure stops the run. `--resume <run-dir>` skips every recorded case, including misaligned
ones: retry such cases in a fresh filtered run, and keep the failed attempt in the reliability totals.
Use `--reverse` for a fresh run in reverse case order; `meta.json` records the order and resume keeps it by default.

Speech is attributed to a step by time only: late speech can land in the next step. A quiet interval is not a native
speech-completion signal, and silence after pressing a button does not prove the button activated.

## AX tree dump

VoiceOver speaks from the macOS accessibility (AX) tree of the browser's web area, so each speech record needs that tree next to it. `axdump/axdump.swift` prints the frontmost window's `AXWebArea` as JSON (role, subrole, title, description, value, DOM id/classes, state and ARIA attributes, children; only present attributes), plus app, pid, window title, timestamp and `focusedPath` (child indices to the `AXFocusedUIElement`, null when focus is outside the web area).

```sh
swift axdump/axdump.swift --app Safari --max-depth 60 --max-nodes 5000
```

```ts
import { dumpAxTree } from "./src/axdump.js"; // compiles to data/bin/axdump on first use or when the source changes
const tree = await dumpAxTree("Safari");
```

It only reads AX attributes: no activation, keys or clicks, so VoiceOver and focus are undisturbed. Depth or node caps set `truncated` and `childrenTruncated` on the cut nodes.
The terminal app that runs it needs Accessibility permission (System Settings > Privacy & Security); without it the dumper exits 2. Chrome exposes its web tree only while an assistive technology such as VoiceOver is on.

## Case sets

A case set is a directory of small pages plus `cases.json` (types in `src/cases.ts`): each case names a page and the chords to press on it. Every page is a "Before marker" button, the element variant, an "After marker" button; names are unique on the page.

```sh
corepack pnpm --filter vo-corpus generate                 # writes data/cases/elements-v1/{pages/*.html,cases.json}
corepack pnpm --filter vo-corpus generate --set screening-v1
corepack pnpm --filter vo-corpus generate --set workflows-v1
corepack pnpm --filter vo-corpus generate --out some/dir
```

`elements-v1` (`src/generate/elements.ts`) has one table row per HTML/ARIA element variant (role × state × name source, about 220 pages). Each page is shared by its cases, id `<variant>.<command>`, with the command in `axes.command`:

- `next`: a bounded sequence of VO+Right (estimated items + 2 presses), then VO+Left. Every variant; complex controls may expose more stops than estimated, so this does not prove complete traversal
- `tab`: Tab, Shift+Tab. Only variants whose target takes keyboard focus
- `activate`: VO+Right, VO+Space. Only buttons, checkboxes, radios, switches, summary, tabs, and links to `#id` on the same page

To add a variant, add a row to the table; `{N}` in the snippet becomes the variant's unique name words.

## Working reference experiments: workflows-v1

Official documentation suggests testing keyboard/focus behavior and actual state changes, not just role markup:
[APG dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/),
[tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/),
[comboboxes](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/),
[accessible names/descriptions](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/) and
[form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/).
[Apple's VoiceOver navigation commands](https://support.apple.com/guide/voiceover/navigation-commands-cpvokys04/10/mac/26)
provide the structural-navigation commands. These sources guide fixture behavior; they do not define golden speech.

`workflows-v1` adds **35 cases on 31 visible pages**, independently of the existing 392-case set:

| Family | Cases | What is varied or exercised |
| --- | ---: | --- |
| Names and containing context | 6 | Visible name vs aria-label vs aria-labelledby precedence vs description; the same Save control alone/in a fieldset/in a named group |
| Real control changes | 8 | Checkbox, scripted switch and favorite toggle; native details vs scripted accordion; native vs roving-tabindex ARIA radio; slider value changes |
| Modal and tabs | 5 | Open, Tab/Shift+Tab wrap, Escape and opener focus return; manual vs automatic tab selection, including focus moving without selection |
| Editing and website tasks | 8 | Character insertion/deletion/select-all replacement; search matches/empty results; autocomplete choose/dismiss; form invalid-to-corrected state; cart totals/removal focus; blog heading jumps |
| Asynchronous announcements | 8 | The same update under off/polite/assertive at 0/1500 ms, or status/alert at 700 ms; repeat the same message without moving focus |

Use native controls where they fit. Scripted controls implement their keyboard behavior, exposed state and visible
selection/focus. Named buttons retain the visible word "Save" in their accessible name. The naming/context cases measure
reading only, not save functionality. Existing incomplete/invalid static fixtures remain exploratory controls; do not mix
them with a working-reference workflow's expected outcomes.

Workflow start alignment also verifies keyboard focus. After VO+Home speaks the marker, the collector uses VO+Command+F4
to move keyboard focus to the VoiceOver cursor, then checks that the native AX `focusedPath` identifies the marker button.
It records these reset commands and the start tree in `start.commands` and `start.axPath`. An AXFocused flag on a page node
alone is insufficient: Safari can retain that flag while actual focus is in its toolbar. A failed focus check records the
attempt and stops the workflow before its keys. See
[Apple's cursor/focus commands](https://support.apple.com/guide/voiceover/navigation-commands-cpvokys04/10/mac/26).
AT Driver sends the F4 function key directly; the physical-keyboard guide includes Fn.

The native collector saves a tree after **each** action for these cases, referenced by `steps[].axPath`; a failed dump is
stored as `steps[].axError`. This is in addition to the initial page tree. AX focus is still distinct from the VoiceOver
cursor, and a later tree timestamp is not an atomic snapshot of the speech receipt. Case-specific minimum observation
windows (2.3 seconds in live-region cases) keep a 1.5-second update from being lost just because speech was initially quiet.
Receipts arriving during an AX dump are retained with that action. The console now shows both the first nonmarker speech
and the last action, rather than displaying only a returning marker.

Before the native workflow pilot, verify **US/ABC input**, **single-key and arrow-key Quick Nav off**, and focus tracking.
Do not toggle these settings mid-run. First pilot checkbox, typing, modal, radio, autocomplete and one delayed live case;
inspect their per-action AX state and raw speech before collecting the whole new set. Starting alignment alone is not
success. Unexpected silence, focus/value differences and unsupported commands remain evidence, not corrected speech.

Validation on 2026-10-14: all 35 fixtures passed keyboard/DOM assertions in a separate headless Chromium on macOS,
including modal focus containment/return, selection vs focus, corrected errors, input values, cart changes and delayed
updates. Static name/context/heading assertions and session-window/replay coverage checks also passed. These checks validate
fixture implementation; Windows execution is not yet verified.

The first native workflow pilot exposed a reset bug: marker speech passed, but Tab moved through Safari chrome and the
checkbox/modal/radio states did not change. That pilot is retained as unsuitable for calibration. After the focus reset
and AX verification were added, seven fresh pilot cases completed with every start verified: checkbox 0/1/0, modal Tab
containment and opener focus return, native radio Red/Green/Blue/Green, text editing to `bee`, autocomplete choose/dismiss,
and a 1500 ms polite update. The repeated identical live update was silent. Run:
`data/runs/workflows-v1-2026-10-14T07-53-14-329Z/`. The remaining 28 cases then completed in that run, giving **35/35
verified starts, all 139 expected actions and 205 usable, untruncated AX snapshots** (31 initial page trees, 35 starts and
139 action trees). Native AX checks of focus, selection, values, visible panels, corrected errors, cart contents and live
content passed 217 assertions, including start/completeness checks. Results are in `completion-summary.json`. The AT session
boundary after the pilot is recorded in `continuation-events.jsonl`. Focus-gate checks bring the package test count to 40.

Several observations need care during calibration. Favorite toggles and native details changed AX state while some
keyboard activation steps were silent. Off live regions exposed updated text without speech; the other tested live
semantics announced their first update but not the identical repeated message. Text-entry receipts contained repeated
characters/values, whose full caption/receipt sequence fidelity remains unverified. Keep the raw receipts.

The blog's backward-heading chord returned the last heading rather than the expected preceding heading; fresh smoke
probes also advanced or stayed at the last heading. The command/provider interpretation is unresolved. Retain that
observation as an anomaly, not a calibrated previous-heading rule. The 217 AX assertions do not verify the VoiceOver
reading cursor or establish simulator accuracy; collection completion is distinct from those remaining checks.

### Windows: generate fixtures and replay the simulator

With the repository's Node/pnpm environment installed, use this collection branch:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm exec playwright install chromium
corepack pnpm --filter vo-corpus generate --set elements-v1
corepack pnpm --filter vo-corpus generate --set screening-v1
corepack pnpm --filter vo-corpus generate --set workflows-v1
corepack pnpm --filter vo-corpus test
corepack pnpm --filter vo-corpus replay --cases data/cases/workflows-v1
```

Generation, headless fixture tests and mock replay use Node/Chromium; they do not require Tart or VoiceOver. The existing
`collect` path uses macOS automation and the Swift AX dumper and **does not collect native speech on Windows**. Native
Windows testing needs a separate NVDA/server/environment profile; do not compare NVDA announcements as VoiceOver goldens.
Generated fixture pages and collected records are ignored by Git; regenerate fixtures from the committed generators.
Local run references in this document do not imply that their raw data has been published.

Mock replay supports the mapped VO intents, basic browser keys and literal lowercase ASCII letters/digits as text entry.
Arrow/editing keys outside its public key capabilities and timed observation windows remain unsupported. An unsupported
command/window marks the **whole case** unsupported instead of skipping it and scoring later actions in the wrong state.
The old supported 392-case replay keeps its format. Broader simulator behavior and native Windows support are separate work.

## Experiment protocol

The target is a simulator calibrated to a **named VoiceOver/Safari/settings profile**, including navigation and changes in
state, not only announcement strings. The 392 cases in `elements-v1` are an initial static matrix. They are not a coverage
claim for all VoiceOver behavior. Several ARIA widgets have no event handlers; their activation observations describe
that static markup, not a functional widget. Likewise, the static live-region rows do not test announcements of updates.

### Freeze the reference environment

The primary calibration target is **English VoiceOver UI + English fixture pages + the English-registered capture voice**.
This matches the simulator's current language and removes localization from the first calibration pass. Korean UI and
multilingual pages remain separate follow-up profiles; existing Korean runs stay intact as exploratory evidence.

Record macOS, Safari and AT Driver versions; English UI (`en-US`); the actually selected capture voice; language detection; Ctrl+Option
as VO modifier; input source; Quick Nav; DOM/group navigation; cursor/focus synchronization; verbosity, punctuation and
hint delay. Capture the guest settings in screenshots or a manually checked profile: `defaults` cannot read all modern
VoiceOver settings. `settings/baseline-v1.json` came from host screenshots and is not a verified guest profile.

Keep the 4 GiB / 2 CPU VM configuration with the run. After consent and settings are stable, stop the VM and clone it as a
baseline before larger runs. Test other settings and Chrome as separate profiles, with their own data and comparison.
Keep page `lang` separate from UI language and voice language. The current generated pages use `lang="en"`; the mixed
Korean text case remains a language-boundary observation, outside the English-only calibration denominator.

### Evidence so far (2026-10-14)

One `screening-v1` run completed 20/20 aligned cases, all 80 expected steps, and 18/18 page AX dumps, with no recorded
errors or truncated trees, in 5.2 minutes. Raw run: `data/runs/screening-v1-2026-10-14T04-28-22-694Z/`, with counts in
`screening-summary.json`. Korean role/state announcements and native checkbox/details changes were captured. This is one
collection pass, not the three-repeat reliability gate or proof that all expected widget behavior is correct.

Three utterances in table/navigation cases included Hangul character names such as `hangul choseong...` instead of intact
Korean words. The cause is unresolved. Keep these raw records. The next screening runs use English UI and repeat the same
table/navigation contrasts; verify caption/receipt fidelity there before calibrating. Resolving Korean rendering is deferred
to the Korean profile and does not gate the English profile.

After the user changed the guest UI to English and rebooted, another screening run completed 20/20 aligned cases,
80/80 steps and 18/18 nonempty, untruncated AX trees in 5.2 minutes, without recorded collection errors. Run:
`data/runs/screening-v1-2026-10-14T04-46-46-186Z/`. Table and navigation announcements were intact English, and the earlier
Hangul-character-name pattern was absent. The mixed-content fixture still yielded its original Korean/English text.
Profile facts are in `settings/en-screening-2026-10-14.json`: UI `en-US`, locale `en_KR` (region unchanged).

Two further English runs completed, including one in reverse case order: 60 case records, 240 key steps and 54 initial
page AX dumps across the three runs. All cases aligned; no collection errors, truncated trees or earlier character-name
artifacts were recorded. Comparing run 2 and run 3 against run 1 gave 160/160 exact main-announcement matches, excluding
hints and timing. Summary: `data/runs/english-repeatability-2026-10-14.json`. This establishes repeatability for these
20 cases, not simulator accuracy, full workflow behavior, or complete settings verification.

### In-progress matrix inspection (2026-10-14)

The full English run is `data/runs/elements-v1-2026-10-14T05-11-20-479Z/`; a read-only snapshot of actual records,
AX health, command distribution and examples is saved as `inspection-2026-10-14.json` there. Collection continues
independently; the snapshot is not the final run total.

- Some fixtures, such as `switch-off`, use an empty `div` with `role` and `aria-label`. Only the marker buttons are
  visible, but Safari AX exposes the named switch and the records contain its name, role and state. The console prints
  only the last step, so a Tab/Shift+Tab case can show "Before marker" after successfully reading its target on Tab.
- Native links currently get skipped by Tab: `link-plain.tab` records After marker then Before marker, while
  `link-plain.next` and `.activate` read the link and destination. This is consistent with Safari's
  [Tab/Option-Tab settings](https://support.apple.com/en-ke/guide/safari/ibrw1075/mac), but the actual preference still
  needs verification. Do not change it during the run; measure alternate settings under a separate profile.
- Both radio-group `next` cases did not reach After marker. In `radio-fieldset.activate`, the first VO+Right lands on
  the group rather than an individual radio, so that case does not establish radio selection behavior. Starting alignment
  and a quiet step are insufficient completion checks.
- The matrix has 222 page variants, 392 cases and 54 generator role labels (including separate input types).
  Text inputs and textareas account for 139 cases. Its command distribution is 222 next, 130 tab and 40 activate;
  it has no rotor, structural-jump, typing, table-navigation or explicit delayed-update cases. Static ARIA buttons,
  switches and popups without handlers, as well as static live regions and dialogs, need functional counterparts.

Keep this run as evidence of the current fixtures/profile. The next collection work should add working state transitions,
target/endpoint and per-action AX/focus checks, followed by the website workflows below; multiplying static rows will not
close these gaps. A marker-only Tab observation is a profile/navigation result to investigate, not a reason to fabricate
target speech from the HTML.

### Prioritized experiment families

`screening-v1`, `elements-v1` and the small `workflows-v1` reference suite are implemented. The additional families are the next collection work, with
their prerequisites listed so a planned scenario is not mistaken for evidence.

| Priority / family | Controlled contrast and representative task | Evidence and prerequisite |
| --- | --- | --- |
| P0: capture fidelity | English UI with English-registered capture voice; English names; table/landmark boundaries; multiline announcements. Korean/mixed names are separate boundary observations | Compare caption text and server receipts for the same action; separate provider/transport text transformations from VoiceOver behavior. Voice preview capture is insufficient |
| P0: screening and repeatability | The same 20 diverse cases, three fresh runs; include reverse/interleaved case order to expose carry-over | Alignment, complete step counts, speech presence where expected, usable AX trees, interruption counts; a fresh run must reload page state |
| P1: static elements (`elements-v1`, 392 cases) | Native vs ARIA role; name source; required/disabled/checked/expanded state; forward vs backward vs Tab | Role/name/state and spoken order; annotate which widgets have actual behavior, and retain invalid markup as separate negative controls |
| P1: names and descriptions; later multilingual profiles | Label vs aria-label vs aria-labelledby when they conflict; description vs name; duplicate names; empty names; English punctuation and numbers. Later: Korean/mixed text, page/subtree `lang`, and Korean UI | Matched pairs differing in one property; raw text, main announcement and hints separately; record content language separately from VoiceOver UI language |
| P1: context and boundaries | The same control alone, in a named fieldset/group/list/table/landmark; nested groups; DOM order vs positive tabindex; first/last item; repeated movement at a boundary | Track cursor and keyboard focus independently; entering/leaving groups and boundary announcements; open shadow roots and named iframes as separate cases |
| P1: state transitions and text entry | Check/uncheck; toggle aria-pressed; expand/collapse details; enable/disable; type/replace/delete generated input text; required/invalid state and error description updates | Implement real handlers, verify DOM changes independently, and save AX/focus before and after actions. The current collector only saves the initial page tree |
| P1: focus workflows | Open a native modal; Tab and Shift+Tab through it; Escape; focus returns to opener; remove or hide the focused node; insert content before the cursor | Verify focus sequence and exposed modal contents, including failures. Implement the workflow; static role=dialog is not a focus trap |
| P2: functional composites | Tabs with roving tabindex; radio arrows; combobox/listbox with aria-activedescendant; menu open/close; slider arrow changes | Key-by-key focus, value and selection; native and scripted versions kept separate; never assume role markup supplies keyboard behavior |
| P2: VoiceOver commands and structural navigation | Heading/form jumps, rotor heading/link/landmark lists, group interaction, table row/column/header navigation, list counts, frame entry/exit | Add scenarios and simulator chord support; unsupported commands count as coverage gaps. Use bounded rotor traversal and always close it before the next case |
| P2: live regions and timing | The same update under off/polite/assertive; status vs alert; aria-atomic/relevant/busy; updates while reading; delays of 0/100/700/1500 ms and repeated identical messages | Add an explicit observation window and event log. An update after the current 800 ms quiet window can otherwise be attributed to a later key or missed |
| P3: held-out workflows and sites | Synthetic search/filter, validation/correction, modal confirmation and tab-panel workflows; then public-site read/navigation tasks with no submission | Keep pages/variant combinations unused during tuning; pin local fixtures for repeatability and separately record changing live-site content. Hold out names and nesting, not just another run of the tuning pages |

Start each family with a few controlled pairs; add combinations only after measuring each factor alone. Prioritize new
navigation/state rules and reproducible mismatches over multiplying equivalent static rows. Test native and ARIA versions
of the same behavior, plus intentionally incomplete implementations, without mixing their expected outcomes.

### Common website workflows

Static roles are only the first layer. The next layer is a controlled component interaction; the third is an end-to-end
task on a small, working site fixture. A blog and a store reuse many components, but differ in how those components are
combined, how focus is restored, and how results are announced. Cover both the shared components and these combinations.

The initial workflow backlog is **36 task recipes across 12 families** (three recipes per row below). These are planned
recipes, not 36 implemented cases or captured golden results. A few short flows are now implemented in `workflows-v1`;
the complete recipes below remain the broader backlog. Start with native controls, then add custom ARIA versions;
do not multiply site skins that exercise the same behavior. Use generated public-looking data in local fixtures so each
task is repeatable. Real sites are a held-out external check after these fixtures pass.

| Family | Three initial task recipes | Required outcomes beyond spoken wording |
| --- | --- | --- |
| Blog, news and documentation | Skip repeated navigation and read the heading outline; follow a table-of-contents anchor and return; open an article/footnote/related link and navigate back | Reading position, heading levels, image descriptions, link destination/current or visited state, focus after returning |
| Search and results | Type and submit a query; choose or dismiss an autocomplete suggestion; change result page/filter then return from a result | Input value vs active suggestion, result count, loading/empty/error feedback, query retention, restored result focus |
| Store and cart | Filter/sort product cards; change variant/quantity and add to cart; remove an item and review updated totals | Option availability/selection, quantity bounds, coherent price text, cart count/status, focus after removal |
| Login, signup and recovery | Complete labeled email/password fields and toggle password visibility; submit invalid data then correct it; complete a generated recovery/verification form | Input echo/privacy, field types, required/invalid state, error-summary links, error removal, completion feedback |
| Multi-step application/checkout forms | Choose dependent address fields; validate a step and move forward; go back and revise an earlier step | Field dependencies, selected values, progress/current step, retained data and focus at each transition; local mock completion only |
| Navigation and responsive shells | Use skip links/breadcrumbs; open a desktop submenu; open and close a small-viewport navigation drawer | Tab vs arrow-key behavior, expanded/hidden state, boundary announcements, Escape and return-to-opener focus |
| FAQ and support | Expand/collapse native details; use a single-open accordion; search help and open a matching answer | Expanded state, exposed content, preserved position, result/empty feedback, discoverable headings |
| Settings and preferences | Toggle a setting; select a tab/panel or radio option; save, undo or discard changes | Focus vs selection, panel exposure, dirty/saved state, enabled/disabled actions, confirmation/toast semantics |
| Admin tables and dashboards | Sort/filter a table; select rows and perform a mock bulk action; paginate or reveal more rows | Row/column headers, sort direction, selected count, accessible row indices/counts, focus when rows are removed or recycled |
| Booking and scheduling | Choose a date with keyboard navigation; change month and inspect disabled dates; choose or revise a time slot | Date/value announcements, grid position, selected vs focused date, availability changes and resulting focus |
| Comments, chat and feeds | Expand a thread and reply; receive a message while editing; load more items and remove or edit an existing item | New-content announcements, no typing-focus theft, author/context, list position, focus after insert/delete, duplicate-message handling |
| Media, galleries and editing tools | Move through a gallery/carousel and pause it; operate a player with volume/seek/caption controls; edit generated text with toolbar actions | Position/count, pressed/value state, playback/status announcements, caret/selection, exposed controls and restored editing focus |

Each recipe needs a written initial state, action sequence and completion check. For example, the cart recipe must verify
that the item count actually changed, not merely that VoiceOver said "button"; a search recipe must check which suggestion
was chosen, not merely that a listbox appeared. Fixtures must reset their own state between cases, including their own
storage namespace. Keep within-task persistence (for example returning to a prior form step) separate from cross-case
carry-over. Keep native forms and scripted validation as separate variants.

### Cross-cutting states that site labels miss

- **Navigation and return:** full page load vs SPA route/title change; anchor jumps; browser Back/Forward; URL fragment
  and tab/window changes; focus and reading cursor after returning. The current same-tab collector does not cover browser chrome.
- **Interruption and overlays:** cookie/promotion dialogs, confirmation dialogs, popovers, tooltips and nested menus;
  initial focus, Tab containment, Escape, close-button name, and return focus. Notification content must not steal editing focus.
- **Lifecycle and asynchronous work:** initial/loading/ready, empty/error/retry, pending/success, stale search responses,
  aria-busy, live updates while reading, and repeated identical announcements. Use explicit observation windows and trigger ids.
- **Scale and rendering:** long content, off-screen controls, infinite scroll, pagination, virtualized rows, responsive
  layout, sticky headers, open/closed shadow components and same-/cross-origin frames. A DOM node being recycled can change
  the cursor's apparent identity; test stable ids, focus and exposed tree state separately.
- **Input and editing:** character/word/line movement, selection, replace/delete, textarea/contenteditable, text masking,
  numeric/date formatting and native select vs scripted combobox. Keyboard text entry and waits are prerequisites missing
  from the current replay mapping, not successes that can be inferred from static input rows.
- **Imperfect sites:** focusable aria-hidden content, wrong/missing labels, duplicate ids, nonfunctional ARIA controls,
  mismatched DOM/visual order and lost focus. Keep a small, labeled negative-control set: the simulator must reproduce
  observed platform behavior rather than silently repair an inaccessible site.

File pickers/download dialogs, browser tabs/chrome, rich canvas/maps/charts, drag-and-drop and advanced rich-text editing
need separate capture/navigation support. Keep them visible in the backlog as unsupported scope until measured; ordinary
HTML image/table tests do not establish support for these experiences.

Two measurement gaps matter even for ordinary sites. The AX dumper's `focusedPath` identifies the browser's AX focused
element, not an independently measured VoiceOver cursor. Keep DOM focus, accessibility focus, VoiceOver reading position
and widget selection distinct. Native select menus and the VoiceOver rotor can also move outside the web-area tree;
`focusedPath: null` there is not by itself evidence that focus was lost. Extend focus/UI evidence before scoring these tasks.

The current target is text announcements and navigation/state behavior. The silent capture voice does not measure
audible earcons, prosody, voice quality or acoustic timing; those need separate instrumentation and are not covered by
a text-only match. Likewise, a DOM oracle validates fixture behavior, not VoiceOver speech: never fill missing native
speech from DOM labels or count a passing DOM test as a native speech match.

### Avoid a misleading "clone" score

The simulator currently derives observations from Chromium, while the reference uses native Safari AX. Store both trees
for paired fixtures and identify browser-tree differences before treating every wording mismatch as a VoiceOver rule.
Do not erase meaningful focus, value or selection differences during normalization. UI language, fixture language and
region are independent axes; the English screening currently uses the Korean region (`en_KR`).

Prioritize search, forms, navigation and cart flows first, then content reading and modal/settings flows. Add tables,
booking and live feed/media flows after the required command support exists. For every shared component, first vary one
factor at a time (native/custom, label source, state, containing context); later add interaction pairs that occur in these
tasks. Reserve whole fixture variants and combinations for held-out tests, with different names, nesting and response
timing. A second run of a tuning page is a repeatability check, not a held-out test.

Use [WAI page-structure guidance](https://www.w3.org/WAI/tutorials/page-structure/) for content landmarks/headings and
[WAI forms guidance](https://www.w3.org/WAI/tutorials/forms/) for field/error workflows. The
[APG pattern catalog](https://www.w3.org/WAI/ARIA/apg/patterns/) and
[keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) guide working fixtures such as
comboboxes, dialogs, tabs, menus, date grids and sliders. They do not prescribe exact VoiceOver announcements; native
capture under the recorded profile remains the speech reference.

### Measurements and acceptance gates

- **Collection reliability:** completed/aligned cases over all attempted cases; AX errors/truncation; quiet/deadline
  outcomes; connection/foreground failures; retries and elapsed time. Invalid starts and missing records stay in the denominator.
- **Speech:** exact and normalized match, role/name/state/order errors, descriptions and hints, and legitimate silence.
  Preserve raw receipts. Compare hints separately instead of discarding them from the entire evaluation.
- **Behavior:** cursor/focus destination, activation result, value/selection changes, modal containment and focus return.
  DOM assertions check that the fixture works; native AX and captured speech check what VoiceOver actually exposed.
- **Timing:** missing, delayed, repeated or interrupted announcements. Log trigger ids and both page event and host receipt
  times; these are different clocks. Do not report receipt time as synthesis latency without clock alignment.
- **Coverage:** report every planned case/command, including missing, unaligned, unsupported and wrong-language results.
  The current comparison's match rate excludes these categories; it is not an overall clone score. State which cases
  belong to the English calibration profile and report multilingual boundary cases separately, rather than silently excluding failures.

Before the full static matrix, require three screening runs with all 20 aligned, every expected step and page AX dump
present, and no connection/foreground failure. Expected silence needs a separate fixture-state check; it is not a failure
merely because there is no utterance. Reproducibility means the same role/name/state and focus sequence, while timing
variation and hint variation are reported separately.

Before claiming a supported profile is calibrated, require supported commands and critical focus/state workflows to pass
on held-out pages; publish the full coverage denominator and per-family errors. Set numeric speech tolerances only after
repeat runs establish VoiceOver's own variability. A high score that excludes Korean output or unsupported commands is not
an acceptance criterion. Broaden to another profile only after the first profile's regressions and held-out results pass.

### Next implementation work

1. English UI and three screening runs are complete. Finish full settings/caption verification and save a verified English
   baseline clone; keep the Korean runs as a separate profile. The static matrix is collected under the recorded provisional profile.
2. Add a small working-fixture set for checkbox/toggle/details, input validation and modal focus, with DOM checks and
   per-action AX/focus snapshots; collect three repeats before expanding it.
3. Add wait/observation-window steps and fixture event logs for delayed live-region tests; record unsupported simulator
   chords and retryable collection failures explicitly.
4. Collect the full static matrix and paired context/name variants under English UI. Calibrate English announcement
   composition, structural navigation and state changes together, using the existing simulator as the starting point.
5. Add functional composites, rotor/table commands and held-out workflows. Re-collect the small regression set after
   each simulator rule change; reserve live-site tasks for the final external check. Add Korean localization and its
   capture-fidelity investigation only when supporting a Korean VoiceOver profile becomes an explicit target.

Generated pages are fixtures, not VoiceOver golden output. Only real capture under the recorded profile supplies reference
speech. Keep the raw runs and the small regression snapshots versioned by fixture content and environment/profile.

## Simulator replay and comparison

`replay.ts` runs the same case set on Rawstep's VoiceOver simulator (`rawstep/mock-voiceover`, headless Chromium, no Mac or VoiceOver needed; do not run it while another process owns a live VoiceOver) and writes records in the live runner's shape, with `source: "simulator"`:

```sh
corepack pnpm --filter vo-corpus replay --cases data/cases/elements-v1 [--filter re] [--limit n]   # -> data/runs/<set>-sim-<time>/{records.jsonl,meta.json}
corepack pnpm --filter vo-corpus compare data/runs/<voiceover run> data/runs/<sim run> [--out report.md]
```

Chord mapping: `VO+Right` next, `VO+Left` previous, `VO+Space` activate, `VO+Cmd+H` next heading, `VO+Cmd+J` next form control, `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape` as browser keys. Any other chord, or an action the simulator refuses (e.g. activating a disabled control), is a step with reason `unsupported` and no utterances. `VO+Home` has no equivalent: a freshly loaded page puts the simulated cursor on its first object, so the start chord is a read of the current object, which must name "Before marker". The page-load title announcement is dropped, like auto-read in the live runner. Utterance `t` is ms since the case started (browser launch included) and only orders steps; the simulator has no speech timing. One Chromium is launched per case, about 1 to 2 seconds each.

`compare.ts` joins by case id and step index, only for cases aligned in both runs. Hints (an utterance starting `현재 ` or `You are currently`, and anything after it) are split from the main announcement, shown apart, and not scored. Per step: `exact`, `normalized` (lowercase, no commas or periods, collapsed spaces), `language` (VoiceOver text has Hangul, simulator text does not; real runs are Korean UI, the simulator is English), `unsupported`, `missing`, or `mismatch` with a token diff. Match rate = (exact + normalized) / (exact + normalized + mismatch). `report.md` has overall counts, tables by `axes.role` and `axes.command`, and the 30 worst mismatches; `compare.json` has one row per step. Both default to the simulator run directory.
