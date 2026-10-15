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
boundary after the pilot is recorded in `continuation-events.jsonl`. Focus-gate and comparison checks bring the package test count to 42.

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

`replay.ts` runs the same case set on Rawstep's VoiceOver simulator (`rawstep/mock-voiceover`, headless Chromium, no Mac or VoiceOver needed) and writes records in the live runner's shape, with `source: "simulator"`. Stored runs can be analyzed with Tart stopped. Headless replay does not control the guest's VoiceOver or Safari.

```sh
corepack pnpm --filter vo-corpus replay --cases data/cases/elements-v1 [--filter re] [--limit n]   # -> data/runs/<set>-sim-<time>/{records.jsonl,meta.json}
corepack pnpm --filter vo-corpus compare data/runs/<voiceover run> data/runs/<sim run> [--out report.md]
```

Chord mapping: `VO+Right` next, `VO+Left` previous, `VO+Space` activate, `VO+Cmd+H` next heading, `VO+Cmd+Shift+H` previous heading, `VO+Cmd+J` next form control, `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape` as browser keys, and lowercase ASCII letters/digits as task input. A case with any other chord or a minimum timed observation window is marked unsupported in full before its workflow runs. An action the simulator refuses (e.g. activating a disabled control) marks that and subsequent steps unsupported. `VO+Home` has no equivalent: a freshly loaded page puts the simulated cursor on its first object, so the start chord is a read of the current object, which must name "Before marker". The page-load title announcement is dropped, like auto-read in the live runner. Utterance `t` is ms since the case started (browser launch included) and only orders steps; the simulator has no speech timing. One Chromium is launched per case, about 1 to 2 seconds each.

`compare.ts` joins by case id and step index, only for cases aligned in both runs. Each known hint receipt (starting `현재 `, `You are currently`, or `To open the autofill menu,`) is shown apart and not scored. Main receipts after a hint remain in the comparison, including repeated characters and delayed updates. Per step: `exact`, `normalized` (lowercase, no commas or periods, collapsed spaces), `language` (a heuristic: VoiceOver text has Hangul, simulator text does not), `unsupported`, `redacted` (the public runner withheld typed input or redacted content), `missing`, or `mismatch` with a token diff. Privacy protection remains enabled. Match rate = (exact + normalized) / (exact + normalized + mismatch). The report also shows the scoreable fraction of all compared steps and matches over that whole denominator. These figures include marker navigation and silence; they are not a clone fidelity score. `report.md` has overall counts, tables by `axes.role` and `axes.command`, and the 30 worst mismatches; `compare.json` has one row per step. Both default to the simulator run directory.

### First native-pattern analysis (2026-10-14)

The completed English runs establish a useful **training baseline**, not an independently validated clone. The scope is
the observed macOS/Safari 26.6.2 profile with the AT Driver capture voice. Full preference settings remain provisional.
Exclude the original host captures, Korean exploratory runs, failed toolbar workflow pilot and menubar reset failure from
this English calibration. Keep the backward-heading anomaly as provider/command evidence, not a rule to imitate.

The `workflows-v1` replay of `english-dom-navigation-evidence-v2` compared all 139 recorded steps: **29 matches, 34 wording
mismatches, 69 unsupported steps and 7 privacy-redacted observations**. The scoreable subset is 63/139 (45.3%), with
29/63 matches (46.0%); matches over every compared step are 29/139 (20.9%). All 35 starts aligned. A case containing an
unsupported key or timed observation window is withheld in full, so 69 is a workflow coverage gap, not 69 individually
unsupported keys. The four-heading case includes one unresolved backward-command anomaly among the mismatches.
The comparison does not establish behavioral or native-tree equivalence. Files:
`data/runs/workflows-v1-sim-2026-10-14T09-32-12-851Z/{report.md,compare.json}`.

The full `elements-v1` replay aligned all 392 simulated starts; the native run aligned 391/392. The paired comparison
contains **1337 steps: 540 matches, 789 mismatches and 8 unsupported**. Its scoreable wording match rate is 540/1329
(40.6%), or 540/1337 (40.4%) over all compared steps. Restricting the scoreable rows to native speech that is nonempty
and not just a marker gives 254/791 matches (32.1%). This simple subset is a diagnostic, not an independent test set.
There are 148 differences where native speech repeats `After marker button` and the simulation says `End of content`.
Ten Tab steps skip an HTML link in Safari while the simulation focuses it; Safari's link Tab preference and the older
collector's unverified keyboard reset must be resolved before treating these as simulator defects. Fixed-length walks,
static/no-op widget activations and incomplete group/table traversal also limit this older matrix. Files:
`data/runs/elements-v1-sim-2026-10-14T09-32-12-026Z/{report.md,compare.json}`. The local combined analysis, source references
and raw examples are in `data/runs/pattern-analysis-2026-10-14.json`; these raw-data outputs remain ignored by Git.

Observed patterns preserve command, context and silence:

| Context/action | Observed native speech | Implication for calibration |
| --- | --- | --- |
| Focus checkbox vs Space toggles | `Email updates unchecked checkbox` → `checked Email updates checkbox` → `unchecked Email updates checkbox` | Navigation and state-change templates have different ordering |
| Focus switch vs Space toggles | `Email updates off switch` → `on Email updates switch` → `off Email updates switch` | Switch state uses on/off; checkbox wording does not transfer |
| Forward heading jump | `heading level 1 Cat care`, then `heading level 2 Feeding` | Role/level precede the heading name in this profile |
| Button with description | `Save changes Only affects this account button` | Description participates in the main announcement before the role |
| Named group traversal | `Billing address group` → `Save button` → `end of Billing address group` | Group entry/exit are reading stops; a flat node list loses context |
| Right at the final page object | `After marker button` repeats in 137 matrix cases | Reaching an endpoint does not necessarily produce the simulation's `End of content` text |
| Fieldset traversal | `Billing address group` → `Billing address` → `Save button` | Suppressing every repeated legend changes subsequent cursor positions |
| Modal opening | `Delivery settings web dialog with 4 items Alex Insertion at beginning of text. Delivery name edit text` | Container entry and caret state add information beyond the focused input |
| Favorite toggle/native details | AX state changes on activation with no speech | Re-announcing the current object after every action produces false output |
| Search/cart updates | `2 results`, `No results`, `1 items, total 10 dollars` | Ordinary Enter actions can announce only changed live text |
| Remove last cart item | `Add Cat toy to cart button`, while AX contains `Cart empty` | Focus restoration can dominate the captured announcement; AX text is not automatically spoken |
| Live update and identical repeat | off: silence; polite/assertive/status/alert: `Delivery arrives tomorrow` once, then silence | Change detection and duplicate suppression matter; interruption behavior is still untested |
| Manual vs automatic tabs | Focus can move without selected state; automatic selection adds repeated receipts | Model keyboard focus and selection separately; preserve raw repetitions until capture fidelity is checked |

These findings support a scoped English web simulator. They do not cover VoiceOver audio, earcons, all settings,
rotor/group interaction, tables, frames, complex content editing or speech-queue interruption. The next implementation
order is: command-specific navigation/state-change wording; group entry/exit and modal context; keyboard editing and
selection; timed live updates and focus restoration. Calibrate against the raw native records and their action AX trees,
then evaluate on newly named/composed pages kept out of calibration. A better score on these same pages is a regression
result, not proof of generalization to blogs, shops or other sites.

### First simulator calibration: v3 (2026-10-14)

`english-dom-navigation-evidence-v3` applies five bounded changes from the observed English profile:
heading role/level before the name; boolean switch on/off wording; state-first plain checkbox/switch changes;
description before the role on plain buttons; and repeating an enabled terminal plain button on next.
Checked-change wording requires Space or simulated activation, the same node/role/name, and an actual boolean state
change. Required/disabled/readonly/value/description combinations, mixed transitions, object replacement and renaming
retain heuristic output. Terminal buttons with pressed/expanded state and other endpoint roles keep their fallback.
Other behaviors, including toggle/details silence, duplicated receipts and the backward-heading anomaly, were not fitted.

The selected native fixture subset has 17 observations with original record hashes and available per-action AX
references: 2/17 wording matches before, 17/17 after. All 13 historical wording fixtures remain compatible.
Actual Chromium tests verify changed vs unchanged state, navigation vs activation, replacement, mixed transitions,
terminal-button cursor/focus behavior, independent corpus-wording backends, and the existing runner.

Both complete case sets were replayed against the same native runs and the same generated fixtures. Matching case/step
keys and identical `casesGeneratedAt`/`casesDir` metadata were checked; scoring and exclusions did not change.

| Comparison | Before (v2) | After (v3) | Newly matched | Previously matched → mismatched |
| --- | ---: | ---: | ---: | ---: |
| Elements: scoreable wording | 540/1329 (40.6%) | 731/1329 (55.0%) | 191 | 0 |
| Elements: nonempty, nonmarker native speech | 254/791 (32.1%) | 297/791 (37.5%) | 43 | 0 |
| Workflows: scoreable wording | 29/63 (46.0%) | 39/63 (61.9%) | 10 | 0 |

The elements comparison still has 1337 total steps, 391/392 native-aligned cases and 8 unsupported steps. Of its 191
new matches, 148 are endpoint-marker repeats; do not present that gain as target-wording generalization. The workflows
comparison still has 139 total steps, 35/35 aligned cases, 69 unsupported steps and 7 privacy-redacted observations.
Its remaining 24 mismatches include the unresolved backward-heading command. Unsupported and privacy-redacted rows
were not removed or reclassified to improve the score. These are same-fixture regression results, not held-out clone
accuracy. No new native collection or Tart session was needed.

After-run outputs:
`data/runs/elements-v1-sim-2026-10-14T09-50-34-833Z/{report.md,compare.json}` and
`data/runs/workflows-v1-sim-2026-10-14T09-50-38-498Z/{report.md,compare.json}`.
`data/runs/calibration-v3-2026-10-14.json` retains counts and all improved/regressed rows with both simulated texts and
the native reference. The final boolean-only guard was also checked on the three mixed-checkbox cases; their speech
was unchanged from the complete replay. These local data outputs remain ignored by Git.

Next calibration candidates are group reading stops and modal entry/focus context, followed by keyboard editing and
timed updates. Safari link Tab settings, provider repetitions and previous-heading input fidelity require native
follow-up before changing their rules. New composed/name-varied pages must remain out of fitting for a generalization
evaluation; replaying these same pages again alone cannot establish a clone.

## Continued calibration and independent validation (2026-10-15)

New sets: `training-v2` (52 cases), `validation-v2` (52 name/context-varied cases), and `focus-followup-v3`
(9 cases). The first two include 265 actions each; the focus followup has 34. All request a native AX snapshot after
each action. The first validation result was inspected after the model had been fitted to training; later runs of that
same set are regression checks. Reserve fresh URLs/fixtures before the next generalization claim.

```sh
node --import tsx src/generate/index.ts --set training-v2
node --import tsx src/generate/index.ts --set validation-v2
node --import tsx src/generate/index.ts --set focus-followup-v3
node --import tsx src/collect.ts --vm vo-collector --url ws://127.0.0.1:14382/session \
  --cases data/cases/training-v2 --settings observed-en-2026-10-15
node --import tsx src/replay.ts --cases data/cases/training-v2
node --import tsx src/validate.ts data/cases/training-v2 data/runs/<native> data/runs/<simulator>
```

The relay URL is specific to the configured host-to-VM relay; without a relay, pass the actual VM AT Driver URL.
Do not regenerate a collected set in place: generated timestamps and fixture bytes identify the experiment. New runs
hash case metadata and page bytes; resume rejects changed bytes. Simulator metadata also hashes the built JavaScript.
The strict validator rejects wrong source/set identity, duplicate records and known fingerprint changes. Older runs
without byte fingerprints are explicitly labeled legacy, rather than retroactively claiming byte verification.

`validate.ts` uses every planned action as its denominator. Missing native/model steps, unsupported keys, unaligned
starts and redacted input do not disappear. Marker-only receipts and silence are reported separately. Main speech
excludes usage hints; full speech includes them. `state-validation.json` independently compares actual native AX
focus/value/checked/selected/expanded/pressed evidence with generated-fixture browser state. It does not establish
caret, timing, rotor, cross-frame or complete WebKit parity. Native secure-field values are excluded. The policy never
uses the state oracle to choose its next action.

Generated sets explicitly label their typed characters as public synthetic input. Ordinary task inputs remain sensitive
by default. Existing unlabeled sets retain privacy withholding; do not edit old metadata to make their scores improve.

Recorded checkpoints, before later v4 refinements:

| Check | Main content | Spoken content | Full speech with hints | Bounded state oracle |
| --- | ---: | ---: | ---: | ---: |
| Training, group/list/table projection | 130/236 (55.1%) | 130/217 (59.9%) | 20/265 (7.5%) | Not collected by model |
| First independent validation | 203/238 (85.3%) | 184/219 (84.0%) | 70/265 (26.4%) | 191/265 (72.1%) |
| Training, autocomplete + focus calibration | 220/236 (93.2%) | 201/217 (92.6%) | 75/265 (28.3%) | 254/265 (95.8%) |
| Validation-set regression, autocomplete | 213/238 (89.5%) | 194/219 (88.6%) | 71/265 (26.8%) | Separate JSON |
| Validation-set regression, repeated state receipts + typed-field rules | 219/238 (92.0%) | 200/219 (91.3%) | 74/265 (27.9%) | 254/265 (95.8%) |
| Original 392-case matrix, typed-field rules | 517/825 (62.7%) | 517/803 (64.4%) | 145/1342 (10.8%) | No per-action native state oracle |

Native references:
`data/runs/training-v2-2026-10-14T19-01-06-522Z`,
`data/runs/validation-v2-2026-10-14T19-23-21-501Z`, and
`data/runs/focus-followup-v3-2026-10-14T19-58-57-152Z`.
Training checkpoint: `data/runs/training-v2-sim-2026-10-14T20-02-04-329Z/{validation.json,state-validation.json}`.
First validation: `data/runs/validation-v2-sim-2026-10-14T19-46-19-365Z/validation.json`.
Regression: `data/runs/validation-v2-sim-2026-10-14T19-57-06-269Z/validation.json`.
Latest validation regression: `data/runs/validation-v2-sim-2026-10-14T20-45-47-375Z/{validation.json,state-validation.json}`.
Matrix: `data/runs/elements-v1-sim-2026-10-14T20-45-46-317Z/validation.json`, compared with
`data/runs/elements-v1-2026-10-14T05-11-20-479Z`. Its preceding structural-v4 spoken rate was 439/803 (54.7%).
Failed focus-collection attempts are retained as failed runs: an OS screen-capture permission alert intercepted VO
navigation. No experimental workflow keys were sent after failed alignment. The collector now halts at the first
unaligned workflow. A stale VO cursor can be resynchronized only when native AX proves page keyboard focus at the marker.

### Seeded live public pages

`real-pages.ts` samples a fixed public candidate pool by a recorded random seed before collection. The pool contains
blogs, articles, government services/search and shopping catalogs. This is random sampling within that pool, not a
representative random sample of the entire web. It retains unavailable/access-blocked pages and never replaces them
with easier successes. Only object/heading navigation and Tab are used; forms/orders are not submitted.

```sh
node --import tsx src/real-pages.ts --out data/cases/public-<new-id> --width 1024 --height 588 --count 8
node --import tsx src/replay.ts --cases data/cases/public-<new-id>
node --import tsx src/collect.ts --vm vo-collector --url ws://127.0.0.1:14382/session \
  --cases data/cases/public-<new-id> --settings observed-en-2026-10-15
node --import tsx src/validate.ts data/cases/public-<new-id> data/runs/<native> data/runs/<simulator>
```

Use the actual Safari content viewport, not a copied example size. Both browsers add the same two marker buttons,
preserving the original page's content and handlers. URL, rendered-text hash and viewport must agree to score a match;
dynamic/personalized/cookie-dependent differences are environment failures in the planned-step denominator. Tiny pages,
obvious HTTP-error titles and access challenges are preserved as failed samples. This protocol does not establish
arbitrary production interaction equivalence. The simulator's public-page run uses the existing read-only navigation guard.

Safari requires **Settings → Advanced → Show features for web developers → Developer → Allow JavaScript from Apple Events**
for marker preparation. The user authorized temporary use for this validation; restore it off after the native batch.
Do not bypass the native authorization UI. Current collection proves native AX focus at the injected marker before
VO+Shift+F4, then verifies marker speech and keyboard focus. VO+Home first can instead move focus into a cookie/banner
group and invalidate that recovery. JavaScript `.focus()` alone can also leave Safari's native focus at a previous
object; the harness sets native AX focus on the injected button, verifies its DOM identifier and then synchronizes VO.
Initial native AX snapshots preserve failed public starts for diagnosis.

Seed `5ca7ac1c4ef96162d1d48be9309e2108` selected eight pages before collection. First native batch:
`data/runs/public-pages-5ca7ac1c4ef96162d1d48be9309e2108-2026-10-14T20-41-17-500Z`.
Simulator: `data/runs/public-pages-5ca7ac1c4ef96162d1d48be9309e2108-sim-2026-10-14T20-41-18-808Z`.
Only 2/8 starts aligned; one aligned page had a content-hash difference. Strict main agreement was **15/240 (6.3%)**;
full speech was **0/240**. All six failed starts stayed in the denominator. A recovery-after-Home retry aligned only
1/8 pages, confirming setup instability. Both batches restored the temporary setting off. These results include
collection/environment failure and do not estimate formatter accuracy on identical accessible objects.

An AX-focus start pilot on the preselected GOV.UK visa page then completed 30/30 planned actions with matching URL,
rendered content hash and viewport. Main speech matched **26/30 (86.7%)** after the logo/list calibration. Its remaining
differences were one navigation-heading context receipt and three Tab/Shift+Tab actions (Safari's link-tab preference).
Native pilot: `data/runs/public-pages-5ca7ac1c4ef96162d1d48be9309e2108-2026-10-14T21-03-28-134Z`;
model: `data/runs/public-pages-5ca7ac1c4ef96162d1d48be9309e2108-sim-2026-10-14T21-03-29-462Z`.
This is an operational pilot on an already-inspected page, not a new independent eight-page result. Its full-set
validation file still counts the other seven uncollected pages as failures. The temporary permission was restored off.

`--first-heading` is an alternative diagnostic protocol that avoids injected markers and JavaScript permission. Its
replay requires `--anchors-native-run <native directory>`. It requires the same unique native heading and exact heard
heading name/level in both runs; a heading whose title merely begins with the anchor text is rejected. It excludes
content before the anchor and uses conservative AX-text fingerprints, so it is not interchangeable with marker runs.

`node --import tsx src/generate/index.ts --set page-patterns-v1` creates eight reduced live-page followups: image/SVG/text
logo contrasts, styled one/two-item breadcrumbs, unnamed landmark boundaries, navigation heading context and cookie
regions. These are training questions derived from the live sample. They do not replace the failed live pages or form
a fresh real-world validation set. New page captures retain fingerprint input text locally for diagnosing content differences.
Native followups: `data/runs/page-patterns-v1-2026-10-14T20-54-41-018Z`. The guest stopped with an internal Tart
virtualization error after five cases; `resume-events.jsonl` records the restart and the final three cases were resumed
without modifying or replacing the first five. Main content improved **30/44 (68.2%) → 44/44 (100%)** between
`data/runs/page-patterns-v1-sim-2026-10-14T20-49-16-985Z` and
`data/runs/page-patterns-v1-sim-2026-10-14T20-57-49-723Z`. All 54 planned actions were available. Full speech including
hints remained **2/54 (3.7%)**. This is an in-sample calibration result, with 36 selected native wording fixtures now
retained in the repository; it is not independent real-page accuracy.
No full-replacement or real-page ≥90% claim is supported yet.

Eight factorial list followups (`list-heuristics-v1`) then crossed `ul/ol`, body/navigation context and explicit list
role under `list-style:none`. Native sources: `data/runs/list-heuristics-v1-2026-10-14T21-22-44-095Z`. Main content
improved **38/44 → 44/44** between the `21-22-45-539Z` and `21-27-34-999Z` simulator runs. The correction flattens
only unmarked, implicit, link-only body lists, retaining explicit/navigation list structure and generated markers.
It also removes an unnamed image stop inside a named button, as observed on MDN. This narrow rule is not complete
WebKit list-detection emulation. The original matrix checkpoint after earlier logo/list-position changes was
521/803 spoken matches (64.9%); this is still legacy regression evidence.

### Separate DOM-input fingerprint protocol (experimental)

The first live runs exposed cross-engine `innerText` differences: Wikipedia's adjacent footer links acquired spaces in
Chromium while Safari joined them. IKEA also had genuinely different product counts/content. The existing rendered-text
protocol and its failures are preserved. `--dom-fingerprint` generates a separate case set with `contentProtocol:
"visible-dom-v1"`; do not change old cases or reinterpret old captures with this protocol.

This protocol hashes a canonical DOM snapshot containing structure, sorted attributes, visibility flags, list style,
pseudo-element content and current public control values. It includes open shadow roots. It excludes script/style/
template/noscript contents, harness buttons, hidden form inputs and password values. The exact capture-script hash must
also match. Actual DOM, attribute, state or visibility differences remain failures. Rendered text and its hash are kept
separately, and the validator reports differing rendered-text hashes even when the DOM snapshot agrees. This is a
conservative input-equivalence check, not proof of identical native accessibility trees; closed shadow roots and
cross-origin frame contents are not covered by this snapshot.

The two markers use fixed overlay positions in this protocol so existing page layout cannot move them offscreen; both
browsers receive the same harness. Native AX focus and heard marker speech are still required. Candidate selection,
30 planned actions per page and failed-sample retention are unchanged. The prototype uses already-inspected pages;
any result is protocol development/regression, not a fresh independent holdout.

```sh
node --import tsx src/real-pages.ts --out data/cases/public-dom-<new-id> --width 1024 --height 588 \
  --seed <recorded-seed> --count 8 --dom-fingerprint
```

### Collection audit and model-independent redesign (2026-10-15)

The collection unit is an **observed transition**, not an isolated utterance: measured prior context and action history,
actual native command, environment, raw speech receipts, and observed subsequent state. Keep that representation usable
for rule calibration, classification, retrieval and generative models. No model training or engine replacement is part
of this change. A target utterance count alone is not an acceptance gate.

The local audit snapshot at `2026-10-14T21:47:20Z` is retained in
`data/collection-audit-2026-10-15.json`, including source-run hashes. It predates the new diversity batch:

| Observation | Audit result and implication |
| --- | --- |
| Native workflow actions | 3,001; excludes simulator outputs and startup speech |
| Next / previous / Tab / Shift+Tab | 1,723 / 341 / 329 / 187: **86.0%** of actions |
| Heading-next / heading-previous / Escape | 49 / 5 / 11; rotor, interaction modes and structural table commands have no workflow coverage |
| Main-speech candidates | 2,433 receipts, 951 distinct normalized texts; these are not 2,433 curated independent training examples |
| Repetition | 314 repeated nominal scenario/step/environment/output combinations; four runs of the same 20-case screening set |
| Per-action AX | 1,240/3,001 (41.3%); 30 snapshots report string truncation |
| Environment breadth | One native macOS/Safari/VoiceOver version tuple; provisional setting profiles and mixed-language history |
| Live-page breadth | Six hostnames, several related Mozilla sites; this is a fixed small pool, not a random sample of the web |
| Explicit grouping and contrast IDs | Absent from the audited historical cases; generator names alone do not prove independence |

The audit's English marker filter leaves some Korean marker receipts among its main-speech candidates. `inventory.ts`
now identifies the known English and Korean marker receipts separately. Historical counts are retained rather than
silently rewritten. Run `node --import tsx src/inventory.ts data/runs` for current raw inventory counts. It excludes
simulator records and verifies that referenced AX files exist; it does not certify training eligibility.

An output-independent structural review of 392 distinct local page paths across eight historical fixture sets found
295 coarse skeletons, 73 repeated-skeleton groups and 59 groups spanning multiple sets. The local result is
`data/fixture-similarity-audit-2026-10-15.json`, with page hashes. Skeletons retain role/state attributes and name-source
presence but omit text, styles, scripts and resource destinations. They are **review candidates**, not behavioral
equivalence or an automatic deletion/split rule: language, punctuation, handlers and CSS can be the intended contrast.
Identical speech from different states is also not automatically a duplicate. Preserve repeats for native variability;
down-weight redundant examples only in a derived training view.

The separate versioned evidence catalog has 2,914 third-party reported result records, including 1,624 NVDA records.
Those are not locally captured AX/history transitions and must not be added to the native utterance count as equivalent
training examples. See `../../docs/screenreader-evidence.md` for source versions, output classifications, unknown settings
and attribution. This Mac collector has no native NVDA measurement path.

#### Preserve evidence without rewriting the pipeline

The existing `records.jsonl`, nested command history, `meta.json`, native AX dumper, generated-fixture state oracle,
case fingerprints and strict validator remain in use. Raw `utterances[].text` is unchanged; main/hint separation and
normalization are derived comparison views. New collections add:

- `inputs/`: exact case metadata, local HTML bytes and an optional precollection `split.json`, with file hashes and a
  manifest hash. Exclusive writes reject replacement. Resume prefers these archived inputs and verifies their fingerprint.
  The collector and CLI replayer now load local pages from the archived copy, preventing concurrent fixture edits from
  changing the actual experiment. Generator output refuses replacement, new run directories are exclusive, and both
  native and model records append rather than rewriting the accumulated raw file.
- `sessions.jsonl`: each collector invocation's actual AT/browser/OS facts and receipt-clock origin; case records identify
  the capture session and attempt, including after a resume. A setting profile name does not make unknown preferences known.
- `ax/attempts/<attempt-id>/`: distinct preparation, marker-focus, verified-focus and action snapshots, using exclusive
  writes. A retry cannot replace the previous attempt's trees. Legacy page-level AX files remain readable.
- `beforeAxPath` and `timing` on each new action: link the last measured start/post-action tree and host request,
  acknowledgement and observation-window times. **The previous post-action tree is not a fresh instantaneous pre-action
  measurement**; independently changing pages need a separately measured pre-action snapshot. Host receipts are not
  synthesis latency. AX capture has its own timestamp and buffered receipts can arrive while that read takes place.
- `steps.jsonl`: completed action observations are appended immediately, with their attempt/session IDs. An interrupted
  case's completed actions survive independently of its final case record. A crash during an unfinished action can still
  lose that action; do not fabricate it or promote an incomplete case into a successful workflow.

Native AX keyboard focus is not an independently measured VoiceOver reading cursor. Caret/selection, operating mode,
browser chrome, closed shadow roots, cross-origin frames and unmeasured settings stay unknown when instrumentation is
absent. The model replay still does not persist every raw Chromium AX tree; its bounded DOM state oracle and generated
speech are not a substitute. Persisting paired model-input AX is a subsequent instrumentation task, without replacing
the existing native archive. Old missing trees/input bytes cannot be retroactively claimed as captured.

For a future dataset view, inputs are prior observed trees/state, preceding actions and reader/browser profile; targets
are raw speech and subsequent state. **Do not feed the post-action tree, intended fixture assertion, native expected
text or simulator-generated speech into the input/ground-truth side.** Attach quality flags for alignment, truncation,
deadline, missing evidence, stale prior state, language, source provenance and declared/observed-mode differences.
Keep protected/private values out of derived training exports. Raw native AX stays local and is ignored by Git;
do not assume every attribute has been explicitly scrubbed by the dumper.

#### Freeze groups before native observation

`dataset-split.ts` joins connected `templateGroup`, `contrastGroup` and optional `siteGroup` components, then assigns
complete groups by a recorded seed. Calibration-exposed components are train-only. Missing template/exposure metadata
is rejected instead of being called unseen. Browser/AT/version siblings must carry the same input group IDs; related
subdomains and shared site templates need one explicitly reviewed site group. Near-clone review happens **before**
freezing, and never uses target speech to make favorable partitions. A manifest is created exclusively and pins fixture
bytes. Small group counts need not attain the nominal 70/15/15 ratios; do not change the seed after inspecting outcomes.
Planner v2 hashes input group IDs rather than member IDs, so adding a browser/AT sibling does not move a group. Explicit
frozen assignments are inherited; conflicting train/test group merges or calibration-exposed heldouts are rejected for
review. The first diversity batch's original v1 manifest remains untouched; its pre-observation assignments are frozen
in the v1 generator. A v2 compatibility check retains the same 12/2/6 case partition.

Historical `validation-v2` and already-inspected live pages remain regression/development evidence. For future evaluation,
reserve separate unseen scenario/template groups and unseen site groups, plus a later-time/profile robustness cohort.
Whole action sequences and all contrast variants stay together. Report per-reader/browser/profile, per-family macro,
full-sequence success, speech, state and timing separately; missing and unsupported actions remain failures. Native
repeat variability is measured separately. A repeatedly inspected test becomes regression evidence for later tuning.

```sh
node --import tsx src/generate/index.ts --set diversity-v1
node --import tsx src/dataset-split.ts data/cases/diversity-v1/split.json \
  rawstep-diversity-2026-10-15-v1 data/cases/diversity-v1
node --import tsx src/replay.ts --cases data/cases/diversity-v1
node --import tsx src/collect.ts --cases data/cases/diversity-v1 --vm vo-collector \
  --url ws://127.0.0.1:14382/session --settings observed-en-2026-10-15
node --import tsx src/analyze.ts data/cases/diversity-v1 <native-run> <model-run> <new-analysis-dir> train
```

Do not regenerate existing cases in place. `analyze.ts` requires verified case bytes, operates on one requested
partition, pins raw-run hashes, and refuses an existing analysis directory. Its queue groups only the **first divergence
per case**, preventing one ordering error from appearing as dozens of independent failures. Setup/content, language,
unsupported commands, redaction and behavior remain distinct. Native `records.jsonl` is the observation source;
`steps.jsonl` is an attempt journal, not additional independent training examples.

#### First redesigned experiment

`diversity-v1` contains 10 matched pairs / 20 cases / 76 planned actions. Labels and intended defects are construction
metadata, not assumed native outcomes. Delayed live cases use a 1,100 ms minimum observation window.

| Pair family | One changed condition |
| --- | --- |
| Entry history | The same checkbox entered through VO navigation or Tab |
| Custom button | Enter handler present or missing |
| ARIA-disabled native button | `aria-disabled=false/true`, with the same deliberately unconditional handler |
| Dialog focus return | Return to opener or an unrelated control |
| Focused-element mutation | Remove the element or hide it |
| Label reference | Valid or dangling `aria-labelledby` |
| Hidden focus | `aria-hidden=false/true` around an otherwise focusable button |
| Atomic live update | `aria-atomic=false/true` |
| Busy live update | `aria-busy=false/true`, with the same 700 ms release |
| Previous containing context | Unnamed or named group around the same checkbox |

The input seed assigned 12 cases to train, two to validation and six to test before capture. Test speech is retained but
not printed in collector/replayer progress logs. The complete native run aligned 20/20 cases in 5.9 minutes. Independent
checks verified 76 before/after AX links, 76 timing rows/journal events, 20 distinct attempts, all archived file hashes,
and no truncated trees. A two-case native confirmation repeated the ARIA-disabled contrast.

Native source: `data/runs/diversity-v1-2026-10-14T21-56-05-931Z`.
Model before: `data/runs/diversity-v1-sim-2026-10-14T21-54-17-449Z`.
Model after: `data/runs/diversity-v1-sim-2026-10-14T22-01-34-315Z`.
Partition reports: `data/analyses/diversity-v1-{train-before,train-after,validation-after,test-frozen}/`.

The training contrast exposed a false repair: an enabled native HTML button marked `aria-disabled=true` still receives
physical Space in Safari and executes its broken handler. The mock had prevented native focus/keyboard input. The
correction preserves real browser keyboard behavior for this measured native-button scope and says `dimmed button`;
explicit activation intents and AX-disabled custom controls retain their existing guards pending native evidence.
It does not change the page's ARIA attribute or add a missing handler.

| Partition | Content main speech | Full speech with hints | Bounded state check |
| --- | --- | --- | --- |
| Train before | 32/40 (80.0%) | 8/46 (17.4%) | 42/46 |
| Train after | 34/40 (85.0%) | 9/46 (19.6%) | 44/46 |
| Validation after | 2/6 (33.3%) | 0/8 | 2/8; two state observations missing |
| First frozen-model scenario test | 14/20 (70.0%) | 4/22 (18.2%) | 20/22 |

The test model build was fixed before opening its native results. These tiny synthetic cohorts do not establish
real-site or native NVDA fidelity, and this test is no longer untouched after inspection. Remaining priorities include
focus after removal/hiding, live-region atomicity and focus on hidden content, containing-context/continuation receipts
and dialog timing. A second exploratory 12-case article suite isolates linked-heading nesting, partial links, article
cards/figures, heading jumps and activation; it is training evidence, not another untouched benchmark.
All 12 article cases subsequently aligned, retaining 89 native actions. Their current-build content baseline is only
**5/57 (8.8%)**, with 31/89 all main-speech matches and six unsupported steps. Native source:
`data/runs/article-patterns-v1-2026-10-14T22-04-42-256Z`; current model:
`data/runs/article-patterns-v1-sim-2026-10-14T22-11-18-823Z`; analysis:
`data/analyses/article-patterns-v1-current/`. These failures prioritize linked-heading reading units and article
containers/boundaries ahead of collecting more equivalent static controls. Cascading order failures are not independent
error patterns. A later archive-served native/model confirmation again matched all six planned main-speech steps in the
two ARIA-disabled cases. A zero-action resume verified archived inputs and profile inheritance without changing the
original diversity native record hash.

The 52-case historical regression re-run after this correction remained **219/238 content (92.0%)**, 200/219 spoken
(91.3%), 74/265 full speech (27.9%), and 254/265 bounded state matches (nine native observations missing). Model run:
`data/runs/validation-v2-sim-2026-10-14T22-04-42-493Z`. New failure-oriented cohorts remain harder than this familiar suite.
The first paired pages also carry variant IDs in their document titles. A stricter future paired-fixture version should
use the same title per pair; derived learning views must not expose artificial fixture IDs/markers as predictive shortcuts.
Retain their raw observations and exclude harness-only targets from quality-approved training views.

The separately completed experimental DOM-fingerprint live batch aligned 7/8 starts but returned **0/240** strict main
matches: 210 environment failures and 30 missing actions. The snapshot includes browser-computed styles, which can differ
even when authored content matches, and actual live content also changes. This is an unusable same-input benchmark for
isolating formatter accuracy, not evidence that its conditional speech accuracy is zero. Retain this result and the
earlier rendered-text results. Before another expensive live batch, pin authored inputs/resources or classify the
cross-engine differences under a prospectively defined protocol; do not loosen historical checks to obtain 90%.
Temporary Safari JavaScript permission was restored off after that batch.

#### Completed reading-unit experiments and v5 calibration

The next round followed the first-divergence queue rather than expanding equivalent static controls. The original
article suite isolated link/heading nesting, partial links, article naming/boundaries, figures and activation. Twelve
additional native questions then tested multiple links, explicit heading names, physical Tab, nested/unnamed articles,
headers/footers, named figures, dates and punctuation. Eight reserved compositions combine these structures in news,
product cards, navigation, tables and anchor journeys. Every page in the new round has the same title, preventing a
variant ID in the title from revealing the condition. These remain synthetic reduced patterns, not new live sites.

Use the reviewed inputs `data/cases/article-followup-v2-reviewed` (12 train cases / 81 actions) and
`data/cases/article-transfer-v2-reviewed` (8 test cases / 79 actions). Their shared pre-observation v2 split manifest
freezes the disjoint input groups with seed `article-reading-v2-reviewed`. Draft directories were never collected;
the reviewed transfer set replaces a near-duplicate draft question with a table composition. Do not regenerate
these captured inputs in place. New copies can be generated with `--set article-followup-v2` / `article-transfer-v2`
and a fresh `--out`; generate a new split manifest before collecting another evaluation round.

The v5 native profile treats linked text headings as one reading unit, preserving real anchor focus/activation for
fully linked headings and static focus for partial links. It models observed article/figure entry and exit, preserves
unnamed structural contents, reads isolated `.` as `period`, and repeats simple date-only `time[datetime]` text in this
captured environment. Same-document fragment activation updates the reading cursor only after an actual URL hash
change, without injecting DOM focus. Other datetime formats, mixed interactive/image headings, repeated unchanged
hashes and ambiguous fragment targets remain unvalidated. Browser Tab preferences are not emulated by rewriting
`tabindex` or silently issuing additional Tab presses.

| Cohort | Content main speech | All main speech | Full speech including hints | Bounded state |
| --- | --- | --- | --- | --- |
| Original article calibration, before | 5/57 (8.8%) | 31/89 (34.8%) | Baseline report retained | 60/89 |
| Original article calibration, v5 | 54/57 (94.7%) | 86/89 (96.6%) | 22/89 (24.7%) | 81/89; eight missing |
| New followup calibration, v5 | 46/48 (95.8%) | 76/81 (93.8%) | 18/81 (22.2%) | 77/81 |
| First reserved composition test, v5 | 45/50 (90.0%) | 73/79 (92.4%) | 23/79 (29.1%) | 76/79; one missing |
| Familiar 52-case regression, v5 | 219/238 (92.0%) | 245/265 (92.5%) | 74/265 (27.9%) | 254/265; nine missing |

The build was fixed before opening reserved native results. Spoken content in that test is 45/49 (91.8%). All eight
starts aligned and no capture-quality warnings were emitted there. The result does not establish 90% on arbitrary
sites or full replacement. Those eight compositions are now inspected and must be treated as regression during
future fitting. Root transfer failures concern a heading jump in navigation, a heading in a table and fragment
destination context. Followup failures include Tab behavior and an unnamed article's directional end naming.

The original article activation case contains `Safari is not responding` / `Safari not responding` receipts. Analysis
now emits explicit review warnings for these receipts, speech-window deadlines and missing/truncated AX. It never
removes them from the original score or rewrites raw text. A hash-pinned local annotation quarantines the affected
receipts for learning review. A separately collected two-case repeat matched 8/8 main-speech actions, with no
unresponsive receipt, but 0/8 full-speech matches. It does not replace the original failed baseline.

Reproducible local evidence (all paths below are relative to this package):

- Article native `data/runs/article-patterns-v1-2026-10-14T22-04-42-256Z`; v5 model
  `data/runs/article-patterns-v1-sim-2026-10-14T22-37-15-772Z`; report `data/analyses/article-v5-regression/`.
- Followup native `data/runs/article-followup-v2-2026-10-14T22-26-14-772Z`; v5 model
  `data/runs/article-followup-v2-sim-2026-10-14T22-37-38-579Z`; report `data/analyses/article-followup-v5-calibration/`.
- Transfer native `data/runs/article-transfer-v2-2026-10-14T22-31-21-409Z`; v5 model
  `data/runs/article-transfer-v2-sim-2026-10-14T22-37-58-975Z`; report `data/analyses/article-transfer-v5-first-test/`.
- Separate activation repeat `data/runs/article-patterns-v1-2026-10-14T22-24-37-677Z`; diagnostic
  `data/analyses/article-v5-activation-repeat.json`; original annotation
  `data/annotations/article-v1-native-unresponsive.json`.
- Legacy 52-case native source remains `data/runs/validation-v2-2026-10-14T19-23-21-501Z`; v5 model and planned-step
  reports are in `data/runs/validation-v2-sim-2026-10-14T22-37-15-773Z`. The native source predates byte archives;
  the stricter new analysis tool correctly refuses to certify its historical fixture bytes. The legacy validator
  explicitly labels that limitation rather than retroactively assigning a verified fingerprint.

The 22:43 UTC archive inventory is `data/inventory-reading-v5-2026-10-15.json`: 33 native runs, 760 case records,
724 aligned records, 652 distinct case keys, 3,496 actions, 2,786 marker/hint-filtered content events and 1,099 distinct
normalized content texts. Native post-action AX files exist for 1,735 actions; zero referenced files are missing and
zero incomplete JSONL lines were found. These totals include repeats, failed starts and language/protocol variants;
they are not 2,786 independent quality-approved training examples. Raw archives remain local, while selected public
synthetic receipts and their source hashes are retained in the tracked native evidence fixture.

Next, isolate the three transfer root failures with new controlled contrasts and retain this test as regression.
Separately instrument hint/context history and timing before fitting full-speech behavior. New live-site evaluation
needs a prospectively defined same-input protocol; it must retain the failed historical browser-fingerprint results.
Rotor/group/frame coverage and native NVDA collection remain required work, with no model-specific training assumed.

#### Hint and context experiments in v6

`hints-v1` adds 20 calibration pages covering ordinary/disabled buttons, links, headings, split text, checkbox/switch/
toggle changes, editing, sliders, disclosure, lists, nested groups, articles, tables, dialogs, radio groups, navigation
and figures. `hints-transfer-v1` reserves eight separately authored combinations: account settings, an article/list,
navigation actions, an order table, a support dialog, shipping disclosure, a booking form and an article/figure.
Both sets use the same document title and a pre-observation frozen v2 input-group manifest. Each action retains its
history, native AX, raw speech and host receipt times with a 1,000 ms minimum observation window. Test labels remain
separate from calibration; subsequent tuning after inspecting the test must call it regression.

The experiment asks whether hints depend on role/state, immediate semantic container, directional container boundaries
and whether the cursor actually changed. It distinguishes hint receipt delay from command/guard overhead: the first
75 paired training receipts had a median main-to-hint interval of 571 ms (550–593 ms), versus 764 ms from command
request. The initial 750 ms candidate is retained as development evidence; the candidate chosen before opening test
labels rounds the measured main-to-hint delay to 600 ms. It queues hints during observation and cancels pending hints
when another action arrives. This does not establish native speech synthesis latency or a complete interruption model.

The first guest stopped unexpectedly before completing any case. The collector's uncaught stdin EPIPE was corrected
with a checked stream pipeline; helper uploads now replace the executable only after completing a temporary copy.
The VM/server were restarted, output re-muted, and the same archived inputs resumed with a new capture session.
The original failed run and logs remain local; no observation was fabricated or replaced.

`analyze.ts` now reports hint-only agreement and the first hint divergence per case alongside main-speech root failures.
The validator additionally reports **content full speech**, excluding harness-only marker steps while retaining hints
and their ordering. The existing full-speech rate over all planned actions is retained. Missing, unsupported,
unaligned and environment-failed observations do not become successful empty-hint matches.

Sixteen selected native hint receipts retain raw text, source record hashes and structure/history-derived inputs in
`tests/fixtures/voiceover-evidence/native-hints-2026-10-15.json`. Browser checks cover delayed output, rapid target
changes, repeated endpoints, unchanged state transitions, directional container hints, live updates and cancellation.
Editing hints that interleave with typed echoes, autofill/provider-specific menus, missing label reading stops and
native queue/verbosity behavior remain open work; a correct hint formatter cannot repair a wrong reading cursor.

The completed native calibration retains 20/20 aligned cases and 145 actions. It also exposed an existing gap:
Chromium's `DisclosureTriangle` was formatted as a summary but could not be activated, and its child text was an
extra reading stop. Actual HTML summary activation now uses the guarded DOM click; the observed activation receipt
is just `expanded` / `collapsed`. The browser test verifies real `details.open` changes, the single summary stop,
content traversal and return. No missing custom-widget handler is supplied. Intermediate candidates remain local;
the confirmed build was frozen before opening native transfer labels, with model/build hashes checked explicitly.

| Cohort | Content main speech | Full speech, all planned | Content full speech, no marker steps | Bounded state |
| --- | --- | --- | --- | --- |
| New 20-case calibration, v5 | 91/101 (90.1%) | 26/145 (17.9%) | 10/101 (9.9%) | 135/145; seven missing |
| Same calibration, confirmed v6 | 95/101 (94.1%) | 133/145 (91.7%) | 91/101 (90.1%) | 140/145; two missing |
| First eight-composition test, confirmed v6 | 32/72 (44.4%) | 46/89 (51.7%) | 32/72 (44.4%) | 52/89; 34 missing |

The first transfer run aligned only five of eight cases. Three pages spoke the marker while native AX showed keyboard
focus outside it; the collector correctly sent no workflow keys. Those 31 absent actions remain failures in the first
test. Failed records were skipped during resume, never replaced with later attempts. The transfer labels are now
inspected, so future tuning must call this set regression. Even successfully started cases expose label-after-control
stops, controls inside table cells and dialog Tab ordering; this is not a ≥90% generalization result.

Native calibration: `data/runs/hints-v1-2026-10-14T22-47-38-217Z`. Before model:
`data/runs/hints-v1-sim-2026-10-14T22-47-39-643Z`; confirmed model:
`data/runs/hints-v1-sim-2026-10-14T23-01-51-317Z`. Reports:
`data/analyses/hints-v5-calibration-before/` and `data/analyses/hints-v6-confirmed-calibration/`.
First transfer native: `data/runs/hints-transfer-v1-2026-10-14T22-59-05-810Z`; confirmed model:
`data/runs/hints-transfer-v1-sim-2026-10-14T23-01-52-418Z`; report:
`data/analyses/hints-v6-first-transfer/`. The three cases absent from the first run have a separate repeat under a
prospectively amended setup protocol, not substituted observations in the original score. The confirmed candidate
freeze is `data/analyses/hints-v6-confirmed-freeze.json`; prior candidate freezes and model outputs remain development
evidence. Setup quality flags use step `-1` and do not count as native speech or remove failures.

The amended synthetic-fixture setup uses at most 12 ordinary Tab presses to reach an AX-proven start button, then
VO+Shift+F4 to align the VO cursor, followed by another native focus check. Every setup command and AX attempt is
retained; final workflow keys still require proven native marker focus. It does not inject DOM focus or change
production browser Tab behavior. Session manifests now preserve the exact start protocol alongside environment facts.

The three-case recovery repeat aligned 3/3 and retained all 31 actions: content main speech 25/26 (96.2%), full speech
29/31 (93.5%), content full speech 24/26 (92.3%) and hint-only agreement 30/31. The first case required six setup Tabs
and VO+Shift+F4; the next two needed no recovery. Each final native start AX names the marker, and each first action's
`beforeAxPath` refers to that verified start tree. Native source:
`data/runs/hints-transfer-v1-2026-10-14T23-04-37-886Z`; separate hash-pinned proof and comparison:
`data/analyses/hints-v6-start-recovery-repeat.json`. This selected repeat is not a new untouched test or a replacement
for 46/89 in the original first-test report. A later read-only quality audit adds the three setup flags at
`data/analyses/hints-v6-first-transfer-reviewed/`; it leaves the original report intact.

The post-round inventory `data/inventory-hints-v6-2026-10-15.json` contains 36 native runs, 791 case records, 752 aligned
records, 680 distinct case keys and 3,730 actual actions. It separates 2,960 content events (1,210 distinct normalized
texts) from 3,099 hints and 900 harness marker events. Native AX files exist for 1,969 actions, with zero missing
references or malformed JSONL lines. Repeat and failed-start records remain included; these are raw counts, not
independent quality-approved training examples.

The confirmed v6 build also completed the familiar 52-case / 265-action regression. Main speech remains unchanged:
219/238 content (92.0%), 200/219 spoken (91.3%) and 245/265 all main (92.5%). Full speech improves from 74/265 (27.9%)
to **211/265 (79.6%)**; content full speech is **185/238 (77.7%)**. Bounded state remains 254/265, with nine missing
native observations. Native source: `data/runs/validation-v2-2026-10-14T19-23-21-501Z`; measured model and legacy-labeled
reports: `data/runs/validation-v2-sim-2026-10-14T23-03-36-209Z`. The native source still lacks historical fixture-byte
verification. Remaining full-speech errors are substantial, even on this familiar set.

The exact measured JS build is preserved under `data/analyses/hints-v6-frozen-build/`, with its build hash checked
against the confirmed freeze and its engine source hashes retained. A subsequent caller-only adaptation keeps the
dashboard's reading-stop counter on explicit immediate snapshots (`0` ms), avoiding a new 800 ms speech wait per
counted stop. It does not change the measured engine or task replay settings. Runtime metadata continues to identify
all output as simulated; the corpus recordings remain native observations.

#### Next collection budget

Allocate the next round approximately 50% to reproducible first-divergence contrasts, 25% to uncovered commands/context/
dynamic/defect combinations, 15% to genuinely new scenario and site groups, and 10% to targeted native repeatability.
Start with one-factor pairs, then cover selected role × state × command × preceding-context combinations rather than
enumerating the full Cartesian product. Retain unsupported native observations: implementation coverage is part of the
goal. Stage rotor/group interaction, frame traversal and table navigation only with explicit command/mode instrumentation.

NVDA should reuse these HTML behaviors and dataset identities while recording its own actual gestures, browse/focus mode,
virtual-buffer/review units, Windows accessibility API and browser/version. Do not translate VO object-next into an NVDA
line-reading key and assume equivalent granularity. Same-AT real-versus-simulated comparisons are the primary metrics;
cross-AT differences are profile conditions. A Windows adapter and native NVDA captures remain required work.

This design follows the distinction between modes/focus/review in the
[NVDA user guide](https://download.nvaccess.org/documentation/en/userGuide.html), uses
[NIST's combinatorial-testing approach](https://csrc.nist.gov/projects/automated-combinatorial-testing-for-software)
as a cost-control rationale, and treats duplicate/test overlap as an evaluation concern supported by
[Lee et al., ACL 2022](https://aclanthology.org/2022.acl-long.577/). These references guide the design, not the native
speech labels or a claim that any data quantity guarantees fidelity.

#### Collection throughput and reproducible inputs (2026-10-15)

Three consecutive native cohorts (`reading-units-v1`, `reading-units-transfer-v1`, `reading-returns-v1`) retained
32/32 aligned workflows and 293 actions in approximately 17.1 minutes (9.1 + 5.5 + 2.5 minutes). Of those actions,
229 contained non-marker main speech; every action has both a preceding observed AX reference and a post-action AX
reference. No deadline or case-error flag occurred. This is about 1,030 actions or 800 content-bearing actions per
hour on the current single VM. These are capture checks, not independent-example approval or proof of repeatability.
Silence and marker observations remain in the archive; meaningful silence is also a target, not a reason to discard a
transition. The reserved transfer cohort contributes aggregate capture counts only; its native text was not exposed
for development.

At 23:36 UTC, before the next state cohort, the raw inventory contained 39 native runs, 823 records, 784 aligned
records, 712 distinct case keys, 4,023 actions, 3,206 content events and 1,303 distinct normalized content strings.
2,262 actions referenced an existing post-action AX file, with no missing references or malformed lines. These counts
include repeated, legacy, multilingual, calibration, test and failed-start observations. Distinct text is not the same
as distinct input/context, and the totals are not a quality-approved training set.

For planning only, assume 300–600 usable, varied observation transitions per collection hour after duplicate review,
quality checks and time spent on repeatability. **This acceptance rate has not yet been measured.** Under that
assumption, 10,000 usable transitions require about 17–34 collection hours and 30,000 require about 50–100 hours.
At eight hours per night that is roughly 3–5 or 7–13 nights, before new collector/environment setup and experiment
redesign. All figures include development/validation/test examples together; reserve complete input/site groups before
counting the training subset. These estimates are for the current VoiceOver/Safari environment, not native NVDA,
another locale, all command families, or a promised completion date. Live sites and unstable interactions may cost more.

The reproducible-data machine should extend the existing generator → native collector → immutable archive → derived
quality/split pipeline. Fix fixture bytes, starting state, action sequence and environment; then compare repeated native
observations. Do not substitute deterministic simulator outputs for actual native labels. Initially repeat a small
stratified cohort three times, preserving all receipts and instability flags; do not count repeats as independent
scenarios or silently select the most convenient output. Factor combinations and event histories should cover roles,
states, commands/context, dynamics and defects, with explicit constraints on meaningful combinations. One-factor
contrasts remain grouped together across all readers/browsers; genuinely new templates and sites stay held out.

`reading-state-v1` adds four frozen calibration inputs isolating radio `name` membership and physical Space versus
VO+Space on the same checkbox HTML. It records initial activation, traversal/return and repeated activation, with AX
after every action. The generator test checks byte-identical regenerated inputs and the exact one-factor differences.
That proves input reproducibility; native output repeatability is a separate experiment.

The first repeatability pilot completed all four inputs three times, with 20 planned actions per run and all starts
aligned. All 20 action positions retained identical raw speech receipt sequences (ignoring timestamps), normalized
full/main speech, and bounded native control/focus states across the three runs. No deadline or AX truncation flags
occurred. The source record hashes, matching input/environment fingerprints and per-action checks are preserved in
`data/analyses/reading-state-v1-native-repeatability.json`. This is 20 repeated transitions, not 60 independent examples,
and establishes repeatability only for these controls and this observed environment. It does not prove all protected
VoiceOver preferences are captured, full browser-state equivalence, or determinism on dynamic pages and real sites.

For future model experiments, use one action transition as the sample unit: prior observed state/tree, available action
history and environment as inputs; actual raw speech (including meaningful silence) and separately marked resulting
state as targets. Future/post-action state must not leak into predictor inputs. Freeze validation/test groups before
model fitting, then compare learning curves at increasing training sizes (for example 1k/3k/10k/30k) on the same
untouched groups. Data quantity alone does not establish sufficiency for BERT, another classifier, a generator or
complete screen-reader replacement. No model training is started by these collection changes.


## Evaluation audit: 2026-10-15

The common evaluation policy is shared with the NVDA effort; native navigation mechanics and results remain
reader/browser specific. This audit reuses the existing collector, immutable archives, split planner and comparers.

| Requirement | Existing evidence | Remaining limitation / change |
| --- | --- | --- |
| Separate speech/navigation/state/task metrics | Planned-step main/full speech, hint separation, native AX and model DOM state | Reports now explicitly label speech provisional, navigation/task unmeasured and complete state unavailable; no overall accuracy or 90% achievement claim |
| Capture vs fidelity denominators | Missing, unsupported, unaligned, environment and redaction failures retained | Added planned/native-recorded/same-declared-command/comparable-window funnel and conditional speech alongside all-planned rates; independently verified input equivalence remains null |
| Safari and Chrome profiles | Native browser metadata; separate simulator reference profiles; controlled native-pair comparer | Chrome is experimental; four control calibration cases are not broad/generalization evidence. Same declared settings cannot establish unknown protected VO preferences |
| Input-group isolation | Connected template/site/contrast groups and frozen conflicts | Added exact action-sequence groups and conflict rejection. Semantic near-clones still require review before freeze; existing splits/results are preserved |
| Delayed speech attribution | Raw receipt timestamps, bounded listen windows and per-action journals | Actual request clock now starts after foreground guard; AX start/end and page-load receipts are retained. Pre-request, post-window and deadline evidence marks attribution uncertain, stays in planned failures and is excluded only from the conditional comparison denominator. Quiet is never completion proof |
| Model-independent sources | Archived fixture bytes, actions, pre/post AX references, environment, raw receipts and quality flags | Selection, VO cursor, protected preferences and interrupted in-flight command acknowledgements remain incompletely observed. Post-action state and actual speech are targets, never predictor inputs |
| Public regression suite | Shared minimal synthetic HTML, action cases and native-derived integration fixtures | No complete public cross-reader release yet. Need a frozen representative update cohort, AT-specific command mappings and independent path/state/task oracles |

`state` remains a compatibility field in analysis JSON and is explicitly a **partial DOM-ID oracle**, not State
Accuracy. It now reports focus comparability, compared/native properties, model-only properties and unidentified native
controls. Two null focus IDs and empty control maps cannot match. Missing state evidence stays in the planned denominator.

The four-control calibration audit using model build `5363a30391acde9ab726aba97bfd4aa078d7c0aa6ef50b52efec4ff9a7f91e5d`
found Safari main wording 20/20 and normalized full wording 18/20; Chrome wording/full wording 20/20, reproduced using
an isolated Chrome 155.0.8059.80 browser bundle matching native Chrome. These are inspected calibration fixtures.
For Safari the bounded state oracle has **0/20 joinable observations**, and for Chrome only 4/20 focus-ID agreements
with no joinable control state properties. Each has 20 unidentified-control observations. Earlier 20/20 state results
were empty-oracle agreement and must not be cited as state fidelity. Old reports/raw data are untouched; new evidence
is in `data/analyses/{safari-v7,chrome155-v1}-controls-evaluation-audit/`. Speech attribution and input equivalence for
these historical observations remain unverified.

The input-only sequence audit found that `reading-units-transfer-v1.labelled-reference` uses the identical command
sequence as two training cases. Under the stricter policy it cannot establish independent action-sequence generalization.
The eight-case cohort's raw native answers were not opened by this audit. The original split remains immutable; the new
planner rejects the conflicting frozen train/test merge instead of moving or renaming cases to manufacture a holdout.
Input-only evidence is in `data/analyses/input-sequence-audit-2026-10-15T00-41-15Z/audit.json`.

Next, prioritize independent reading-target and state observations, input-effect equivalence, and frozen compound task
oracles. Use those to evaluate structural corrections on a genuinely separated new cohort. Preserve inspected cases as
regressions and report their results separately. Increasing collection volume cannot repair these measurement gaps.

New capture sessions identify the observation protocol. Resume checks now reject differing settings labels, start or
observation protocols, observed OS/browser/locale/keyboard/VO versions and AT capabilities before appending a session.
Legacy captures without a matching observation protocol require a separate new run. Volatile/private VO settings caches
are preserved raw but are not compared as stable configuration or copied into public fixtures.

A VM restart exposed Chrome's own `Restore pages?` dialog. It is in the Chrome process, so a frontmost-app check alone
cannot establish that workflow keys reach the page. The failed attempt is retained separately, and the guard now also
rejects this observed Chrome recovery window. Genuine in-page dialogs remain part of the test surface. Dismissing the
recovery UI is environment preparation, never a successful scenario action.

The v7 full legacy element regression completed 392 simulator starts against the existing 392 native records (391
jointly aligned). It reports 1,035/1,342 planned main-wording matches (77.1%), 581/825 content matches (70.4%),
563/803 spoken-content matches (70.1%), and 976/1,342 normalized full-speech matches (72.7%). There are 5 missing
planned steps and 6 unsupported steps; neither is removed. Conditional main speech is 1,035/1,331 (77.8%). The
native capture has no historical byte fingerprint and no independent attribution/input-equivalence verification, so
this is a **legacy regression measurement**, not an independent evaluation or validated 90% result. The new report
lives only in `data/runs/elements-v1-sim-2026-10-15T00-21-59-091Z/validation.{json,md}`.

After closing the recovery window, a separate Chrome repeat completed all four control cases / 20 actions in 3.2
minutes. All 20 request/ack/listen/AX timestamps were ordered and post-action AX files existed; all four page-load
speech windows were retained. Its wording/full-wording comparison is 20/20, with 20 bounded attribution windows and
no observed pre-request/post-window receipts. This is still calibration and does not prove causal attribution or
speech completion. Derived results: `data/analyses/chrome155-v1-controls-new-timing/`. The failed pre-recovery attempt
is separately reported as 0/20 planned comparison successes in `data/analyses/chrome155-v1-controls-recovery-failure/`;
it is never replaced by the repeat or removed from capture performance accounting.


## State observability and Chrome v2 calibration

`voiceover-evaluation-v3` keeps the prior speech/failure denominators and adds a bounded control-state oracle that can
join DOM IDs or unique AX role/name identities. It uses a separate CDP session and actual DOM control values/selection,
never simulator-predicted speech or state. Names come from AX, not from a control's current value. Duplicate names are
not disambiguated by order, expected values or speech. Source identity is local to a snapshot, not a stable cross-run ID.

Native AX schema v3 records snapshot-local `AXElementId` values using CFHash buckets with CFEqual collision checks.
A table can expose one editable object through both row and column paths. This was observed for the generated table
input: both occurrences had native object ID 15. Those aliases merge only when the recorded native identity agrees;
differing state observations of that identity mark a non-atomic snapshot and fail comparison. Older captures without
these IDs keep their identity ambiguity. Actual separate same-name controls remain ambiguous.

`AXSelectedTextRange` is retained as location/length and interpreted as a caret only on nonsecure native text fields
and text areas. Static text/web-area ranges do not establish an editable caret or VO cursor. Secure AX values and
selection are explicitly withheld by the native observer. A one-case native smoke verified both withholding flags;
`data/analyses/native-secure-state-smoke-v1/audit.json` pins the source hashes. The fixture's public password remains in
its archived HTML by design; this check covers AX withholding, not arbitrary private-page speech.

The original eight Chrome focus-context cases completed 54 planned actions. The same frozen input cohort was replayed
with Chrome v1 and v2 against the same native records. No case or failure was removed:

| Calibration/regression metric | Chrome v1 | Chrome v2 |
| --- | ---: | ---: |
| All planned main speech | 47/54 (87.0%) | 52/54 (96.3%) |
| Content main speech | 39/46 (84.8%) | 44/46 (95.7%) |
| Normalized full speech including hints (legacy) | 43/54 (79.6%) | 48/54 (88.9%) |
| Full Speech Exact (raw full text) | 10/54 (18.5%) | 11/54 (20.4%) |

A separate preplanned repeat selected only the three editing cases (29 actions) to capture native selection and alias
identity. Native metadata stores that subset before workflow execution; the other five fixtures were not planned in
this repeat. The same native subset yields v1 main speech 22/29 and v2 27/29; normalized full speech 18/29 and 23/29. Both builds
match all 29 bounded keyboard-focus/control-state observations (174 compared properties, including native caret range),
with zero identity ambiguity in this repeat. This identifies a wording/context bug rather than a caret-state mutation.
It does not prove complete State Accuracy or navigation fidelity. The earlier 54-action captures retain their unresolved
aliases; their state results are not silently replaced by this repeat.

Chrome v2 announces the actual collapsed caret when object navigation enters/returns to a nonempty table field and
retains row context after Tab entry. These rules use DOM identity, selection and table geometry, not fixture names or
stored answers. Regression tests replay the actual action prefixes and assert five observed caret/row-context positions;
full corpus comparison still scores every planned action, including the remaining header and editing-hint differences.
Safari v7 behavior remains unchanged pending a controlled browser pair for these new rules.

The candidate JS build was frozen before replay at `5a08b76d6a568d78af5ab23c2ec501ec90f78c3840b125af54791f4f059b14aa`;
source hashes and copied JS are in `data/analyses/browser-profiles-v7-v2-caret-build/`. Native Chrome and the isolated model
renderer are both 155.0.8059.80. Final derived reports, with evaluator source hashes, are in
`data/analyses/chrome155-v2-focus-context-final-evaluator/` and
`data/analyses/chrome155-v2-focus-context-state-final-evaluator/`.

Every case above was inspected for calibration; none is an independent generalization result. Native VO reading cursor,
complete task outcomes, partial/non-Latin selection behavior and generalization to new structures/sites remain unproven.
The eight originally reserved transfer inputs still require the stricter action-sequence isolation review. Independent
Navigation Accuracy and full State Accuracy are not inferred from the rates in this section.

Capture metadata now freezes `plannedCaseIds` and `plannedActions` before execution. Resume cannot expand that plan;
analysis retains every planned missing/failed action and rejects records outside the frozen plan. Legacy captures with
no explicit subset continue to mean the complete input set. Controlled browser comparisons require equal frozen plans.
`validate.ts` accepts an optional **new** output directory for reevaluating a historical model run and refuses to overwrite
existing reports. New analyses fingerprint evaluator sources in addition to fixture bytes and source record/metadata hashes.


`fullSpeechExact` is distinct from the historical `fullSpeech` normalization score. It preserves raw full-text case,
punctuation, whitespace, hints, repetitions and order; receipt texts are joined with one space, so event batching and
audio timing are still not scored. The normalized full-speech score remains for backward comparisons and is explicitly
labelled legacy. Thus the 8-case v2 normalized full result is 48/54, while raw Full Speech Exact is only 11/54; neither
should be presented as general simulator accuracy. The stricter evaluator reports are in
`data/analyses/chrome155-v{1,2}-focus-context-full-exact-v3/` and
`data/analyses/chrome155-v2-focus-context-state-full-exact-v3/`. All historical reports remain intact.

Property coverage is coverage of the selected bounded oracle: value, checked/pressed/tab selection, expansion,
accessibility-disabled state and exposed editable selection ranges. It is not all state available in the raw native AX
tree. List selection models, hidden/removed object identity, configurable cursor tracking and unexposed properties still
need further validation. Native focus never substitutes for the independent VO reading cursor. Read-only direct,
nested-get and transactional AppleScript cursor probes still timed out on this guest; navigation remains unmeasured.


Release-check reports from the committed evaluator sources are
`data/analyses/chrome155-v2-focus-context-release-check/` and
`data/analyses/chrome155-v2-focus-context-state-release-check/`. Earlier intermediate reports retain their original
source hashes. Comparison failure can include missing observation or identity ambiguity; it is not automatically a
confirmed simulator-state error. The known full-text differences and unmeasured native cursor keep replacement and
independent 90% achievement unproven.

## Practical task validation (2026-10-15)

`practical-tasks-v1` adds three new compositions: bulletin registration (checkbox, text entry and save), delivery
reservation (native disclosure, radio arrows and save), and basket checkout (table-contained buttons, quantity changes,
enable/disable transition and confirmation). Before observing outputs, all HTML, commands and final-state targets were
frozen at input SHA `d84109d6a796f04c26c32b0a50bf80b9668e106025246f70e3a310669603a968`, against the frozen Safari v8 /
Chrome v2 JS build `b045908a729093d8af360d842c06d2ade95650aa9e5425929a27385bac77194b`. The input audit found no declared
template/site/contrast-group or exact full-command-sequence overlap with 761 earlier input cases. This is a small
synthetic composition evaluation, not a random live-site benchmark or proof of general 90% fidelity. Its outputs are
now inspected, so future tuning against this cohort is regression work.

| Frozen composition evaluation | Safari 26.6.2 reference / model v8 | Chrome 155.0.8059.80 reference / model v2 |
| --- | ---: | ---: |
| Native task outcomes satisfied | 3/3 | 3/3 |
| Simulator task outcomes satisfied | 3/3 | 3/3 |
| Joint Task Success (both independently satisfy targets) | 3/3 | 3/3 |
| Main Speech Exact, all planned actions | 27/29 (93.1%) | 22/29 (75.9%) |
| Full Speech Exact, literal full text | 12/29 (41.4%) | 9/29 (31.0%) |
| Independently joined AX keyboard focus agreement | 29/29 | 29/29 |
| Bounded complete-state comparisons matching | 21/29 | 21/29 |
| Native actions recorded / planned in successful capture | 29/29 | 29/29 |
| Independently observed VO cursor / Navigation Accuracy | unavailable | unavailable |

Conditional main-speech accuracy equals planned main-speech accuracy in these successful captures: all 29 actions
are comparable in each. It does not include an earlier Chrome setup failure: that attempt remains separately reported
with 0/29 native actions, while the recovered Chrome and Safari captures each have 29/29. Across all three native
attempts, 58/87 planned actions and 6/9 planned case attempts were captured/aligned. There are only three distinct
input tasks, each evaluated in two browser profiles. Do not discard the failed attempt or count repeats as new cases.

The first Chrome attempt remained in browser chrome/default-browser infobar during setup. Local synthetic setup v4
can explicitly AX-focus the unique `Before marker` only after checking the exact expected fixture URL, then reads
actual native AX focus and synchronizes VoiceOver. This fixes a collection-start problem, not simulator navigation.
The default AX dumper stays read-only; focus requires the explicit URL flag. A live negative check rejected a different
URL without changing focus. Both completed browser captures use the same setup v4, English environment and
`baseline-v2-dnd` (guest Do Not Disturb on, guest muted, Tart `--no-audio`). Safari JavaScript from Apple Events stays off.

Failure analysis distinguishes these root causes rather than treating every later step as a new error:

* Both profiles omit outer-region/article context on two Tab transitions. The actions reach the correct controls and
  the tasks finish. This is an existing context-transition rule needing a focused boundary contrast, not a new feature.
* Chrome native summary is exposed as `AXButton` / role description `disclosure triangle`, with different entry/Enter
  receipts from Safari. The task oracle initially left this native outcome unknown because of its canonical role map;
  that observer mapping was corrected and checked independently. The original 2-success/1-unknown report is retained.
  The simulator's Chrome summary wording/notification rule still needs a browser-specific correction.
* Chrome text entry emits repeated TTS text requests in this composition; the input value is nevertheless exactly
  `noa`. The original voice-server log confirms the repetitions upstream of WebSocket transport, with intervening
  cancellation events. Do not deduplicate raw observations or blindly double the simulator's echo. Label/context
  contrasts and voice-request lifecycle observation are needed before a rule is inferred. These text receipts do not
  prove how many repetitions would have been audible.
* Safari's eight nonmatching complete-state rows all have an extra unnamed expanded AX group that cannot currently
  be joined to a model object. Chrome's eight rows all differ on the unfocused, read-only quantity field's selected
  range after programmatic value updates. Quantity, checked/expanded targets, enabled state, confirmation text and
  keyboard focus satisfy the frozen tasks. The full-state counts above retain these gaps; they are not reclassified as
  complete State Accuracy. Native DOM-range versus AX-range observation is needed before changing caret behavior.

The initial desktop cursor/server on/off contrast was not sufficient to establish an AT Driver-only cause. Subsequent
detached-server and browser-context queries timed out with the server both on and off. Independent VO cursor location
remains unmeasured. That prevents a full reading-path Navigation Accuracy claim; it does not prevent the separately
observed task outcomes, keyboard focus, bounded state or speech comparisons above. No further cursor workaround is
required to use these bounded workflow tests.

Current use supported by this experiment is scripted regression of native form controls, disclosure/radio operation,
button actions inside a table and resulting page state. It does not validate arbitrary table-cell navigation, group
interaction, rotor, cross-frame tasks or unknown websites. Unsupported interaction commands still fail explicitly.
Exact native wording assertions, particularly for Chrome, remain limited by the listed speech differences.

The public regression fixture `test/native-practical-task-outcomes.json` keeps shared HTML/commands/targets once,
browser-specific original text receipts separately, selected original final AX node attributes, environment versions
and source hashes. The subset does not claim to be a whole tree or cursor observation. The test executes every task
through the existing public simulator runner and checks the original native and model outcomes independently:

```sh
corepack pnpm --dir packages/vo-corpus exec tsx --test test/practical-tasks.test.ts
corepack pnpm exec tsx packages/vo-corpus/src/generate/index.ts --set practical-tasks-v1 --out data/cases/practical-tasks-update-check
```

For a native update check, collect that newly generated directory separately with `--browser safari` and
`--browser chrome`, retaining the same setup/settings; replay each reference profile and run `src/analyze.ts` with
partition `test` into new report directories. Never replace the frozen original run. `Case.taskOutcome` targets and
post-state text/controls are evaluator-only: they are not passed to the replay policy or supplied as prediction inputs.
The outcome evaluator cannot pass empty targets, ambiguous identities, absent state or an interrupted workflow;
equal native/model failures do not count as task success.

Local source reports are `data/analyses/{safari-v8-practical-tasks-v1-independent,chrome155-v2-practical-tasks-v1-observer-corrected}/`,
with the original Chrome observer result in `chrome155-v2-practical-tasks-v1-independent/`, controlled native browser
comparison in `native-browser-practical-tasks-v1/`, and all-attempt capture/source-log accounting in
`practical-tasks-v1-capture-accounting/`. Inputs and engine were not changed between these profile evaluations.
