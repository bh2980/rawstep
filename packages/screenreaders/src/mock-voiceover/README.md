# Simulated VoiceOver: internals

This page is for people who change the simulated screen reader, or who need to know exactly how far to trust what it says. It answers: where does the simulated cursor stop, how is a stop turned into speech, which real VoiceOver reports back which rules, how much of the corpus is used, and what is assumed.

The simulation is `MockVoiceOverBackend` (`backend.ts`), with the wording formatter in `semantics.ts` and the run wrapper in `run.ts`. In a run profile it is `screenReader: "simulation"`. Everything it says is labelled `evidenceProvenance: "simulation"`. **It is not VoiceOver, and a run on it is not native screen reader evidence.** For real VoiceOver or NVDA, see the [AT Driver notes](../at-driver/README.md). Licenses and attribution for the reported speech this page refers to are in [THIRD-PARTY-NOTICES.md](../../../../THIRD-PARTY-NOTICES.md).

## What it is

The backend reads Chromium's accessibility tree (`Accessibility.getFullAXTree` over CDP) of the page's main document, turns it into a flat list of stops in page order, keeps a cursor on that list, and speaks the stop the cursor lands on. The page's own handlers do the rest: it never replays an answer and never knows the goal.

- Profile name: `english-dom-navigation-evidence-v2` (`MOCK_VOICEOVER_PROFILE`). It is a composite. Its wording comes from reports for different macOS and Safari versions, so it is not any one VoiceOver version.
- The backend implements the generic `Backend` interface: `start`, `execute`, `observe`, `subscribe`, `close`. `attachSession({ page })` hands it the task's Playwright page. It detaches its own CDP session on close and does not close the caller's browser.
- `runMockVoiceOverTask(task, options)` (also exported from `rawstep` and `rawstep/mock-voiceover`) runs a task on it. It prints `MOCK_VOICEOVER_WARNING` to stderr unless `warn` is given, and defaults `headless` to `true`. Rawstep's own runs call it with the warning silenced.
- What the planner receives is only the observation: speech strings, their provenance and the page title. It never sees DOM nodes, the accessibility tree, screenshots or verifier results. The cursor's screen position is recorded for people reading a run (the dashboard draws it on the screenshot) and is never given to the planner.

Library use, with a fixed action list instead of a planner:

```ts
import { resolveTask, ScriptedPolicy, runMockVoiceOverTask } from 'rawstep';

const task = resolveTask({
  url: './page.html',
  goal: 'Activate Save twice.',
  maxSteps: 4,
  verify: { all: [{ titleIncludes: 'Completed' }] },
}, process.cwd());

const trace = await runMockVoiceOverTask(task, {
  outDir: './runs/simulated',
  policy: new ScriptedPolicy([
    { action: { kind: 'intent', intent: 'activate' } },
    { action: { kind: 'intent', intent: 'activate' } },
    { stop: 'success' },
  ]),
});
```

## Where the cursor stops

The tree is rebuilt before every action and every observation. A node becomes a stop when all of these hold:

- Chromium does not mark it ignored, and its role is not one of the skipped roles below.
- It has something to say: the formatted speech is not empty.
- It is not an unnamed container.
- It is not text that repeats what the previous stop just said, or the name of a group it sits in (a group's legend right after "Categories, group", a checkbox label right after the checkbox).
- It is not static text inside a named control or heading (a button's text node is part of the button, not a second stop). The roles that swallow their text: button, link, checkbox, radio, switch, textbox, searchbox, combobox, spinbutton, slider, heading, menuitem (and its checkbox and radio forms), tab, option.

| Is a stop | Is not a stop |
|---|---|
| Static text with content | `RootWebArea`, `WebArea`, `none`, `presentation`, `generic` |
| Headings, links, buttons, form controls, images, tabs, menu items, dialogs | Separators (`separator`), `LineBreak`, `InlineTextBox` |
| Disabled controls (spoken as disabled) | List markers (bullets, "1.") |
| Offscreen and fully transparent objects | `strong` and `emphasis` (their text is read, never the role) |
| Named groups, lists, list items, landmarks (`navigation`, `main`, `banner`, `contentinfo`, `complementary`, `form`) | The same containers with no name |
| | Live regions (`status`, `alert`, `log`, `marquee`, `timer`) with nothing in them |
| | Anything Chromium reports as ignored or hidden |

There is no viewport, opacity or tab-order filter: if Chromium exposes it, it is a stop. Ignored wrappers are walked through, so their exposed children still count.

**Cursor and focus are separate.** `next` and `previous` move the cursor along the list and do not focus anything on the page. They do not wrap: past the end the speech is `End of content`, before the start `Start of content`, and the cursor stays. The cursor jumps to the focused object only when DOM focus changes (including into an open shadow root); focus that stays put does not pull it back while you read on. `aria-activedescendant` changes are not treated as focus changes. A stop is identified by its Chromium backend DOM node id, so an insertion elsewhere does not retarget the cursor. If the cursor's node disappears, it moves to the next surviving stop from the old order, else the one before, else the first.

**First look.** The first observation speaks the page title, then the first stop. A new document later (the root changes) is announced by its title alone.

### Actions

| Action | What happens |
|---|---|
| `next`, `previous` | Move one stop, then speak it. |
| `heading.next`, `heading.previous` | Move to the next or previous heading. Past the last or first: `No more headings`, `No previous heading`. |
| `form.next`, `form.previous` | Same for form controls: button, checkbox, radio, switch, textbox, searchbox, combobox, spinbutton, slider, listbox. `No more form controls`, `No previous form control`. |
| `link.next`, `link.previous` | Same for links. `No more links`, `No previous link`. |
| `readCurrent` | Speak the stop the cursor is on again. |
| `readFocused` | Speak the object that has DOM focus, or `No focused accessible object`. |
| `headings.list` | One announcement of every heading with its level: `Headings, 3 items: Checkout, level 1; ...`. The cursor does not move. With none: `Headings, no items`. |
| `links.list` | One announcement of every link name: `Links, 2 items: Home; Cart`. The cursor does not move. With none: `Links, no items`. |
| `formControls.rotor` | Opens the rotor on form controls (buttons included) at the first one in page order. Two utterances: `Form controls, N items`, then the first item. While open: `next` and `previous` move one item and speak it (they stop at the ends, they do not wrap); `activate` moves the cursor to that item without pressing it and closes the rotor; `Escape` closes it and speaks the current stop; any other action closes it first. With none: `Form controls, no items`. Typing to filter the list is not modelled. |
| `activate` | Clicks or focuses the object under the cursor (see below), then speaks the current stop. |
| `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`, arrow keys, `Home`, `End` | Sent to the page as real key presses. The cursor follows any focus change, then the current stop is spoken. Arrow, `Home` and `End` reach the page as with Quick Nav off, so menus, tabs and radio groups that move focus with them are announced at the new focus. `Enter` or `Space` on a disabled focused object fails. |
| `typeText`, `replaceText` | Types a named task input character by character into the focused field. See below. |

Which of these a planner may use is set by the run profile's allowed actions; the backend supports all of them. An action it does not list fails before anything happens.

**`activate`.** On button, link, checkbox, radio, switch, menuitem (and its checkbox and radio forms) and tab it calls the element's DOM `.click()`. On textbox, searchbox, spinbutton and combobox it calls `.focus()`. On any other role it fails. Disabled, inert and `aria-disabled="true"` objects fail. The receipt says which one it did: `dom-click-untrusted` or `dom-focus`. It is a stand-in for VoiceOver's press, not a trusted user gesture. Whatever the page's handlers do is what happens; a custom checkbox with no click handler stays unchanged, and the backend never repairs it.

**Text entry.** It needs a focused, enabled, writable `input` (text, search, email, url, tel, password, number), `textarea` or contenteditable. Before each character it checks that the same field still has focus, so a page that moves focus mid-entry gets no more text. `replaceText` presses select-all and Backspace first. Password values are discarded before speech: the field is spoken as `Password, secure text field`.

**Live regions.** Roles `status`, `alert`, `log`, `marquee`, `timer`, and anything with `aria-live` set to `polite` or `assertive`. Text that appears or changes after the first look is spoken once, after the speech of the action that caused it. Text the page loaded with is not announced. There is no queue, timing or interruption, and `assertive` is treated like `polite`.

**Changes with no action.** An observation also speaks the current stop if its speech changed since the last one (a button whose label the page changed, for example), but only when it differs from the last announcement.

**Not supported** (fails or does nothing): group interaction (VO+Shift+Down into a group), Quick Nav mode (arrow keys moving the cursor) and its settings, quick navigation by anything other than headings, form controls and links, rotor lists other than headings, links and form controls, speech queues and earcons, browser chrome, operating-system dialogs, iframes and cross-frame traversal. Only the attached page's main document is read.

## Speech format

`formatSimulatedSpeech(node)` in `semantics.ts` joins parts with a comma and a space. The input is a sanitized node (role, name, value, description and state flags) taken from the accessibility tree. Order, from first to last:

1. `link` for a link (the role comes before the name), then the name.
2. For a password field: `secure text field` and nothing else. Its value is never read.
3. Otherwise: the value if it differs from the name (for a multi-line textbox the value comes after the role), the checkbox state, the toggle state of a button (`selected` or `mixed`; a button that is not pressed adds nothing), `expanded` or `collapsed` for a button, `required` for a textbox, then the role word.
4. `level N` for a heading.
5. Remaining states: `checked`, `unchecked` or `mixed` (non-checkbox), `pressed` or `not pressed`, `expanded` or `collapsed`, `selected` or `not selected`, `disabled`, `read only`, `required`, `multi-line`, `modal`.
6. The description, last.

Role words: `edit text` (textbox), `search text field`, `radio button`, `combo box`, `spin button`, `list item`, `menu item`, `menu item checkbox`, `menu item radio button`, `alert dialog`, `image`, and `heading`, `checkbox`, `button`, `dialog`, `switch` as they are. A pressed-capable button is a `toggle button`. Other ARIA roles are said as their own name (`tab`, `slider`, `navigation`). Static text has no role word. Chromium's internal roles (`LabelText` and the like) are never spoken.

Captured from `formatSimulatedSpeech`:

| Node | Speech |
|---|---|
| button "Add to cart" | `Add to cart, button` |
| link "Home" | `link, Home` |
| heading "Checkout", level 2 | `Checkout, heading, level 2` |
| checkbox "Agree", checked | `Agree, checked, checkbox` |
| checkbox "Agree", not checked | `Agree, unchecked, checkbox` |
| textbox "Email", required | `Email, required, edit text` |
| textbox "Email", value "a@b.c" | `Email, a@b.c, edit text` |
| password "Password" | `Password, secure text field` |
| button "Menu", collapsed | `Menu, collapsed, button` |
| button "Bold", pressed | `Bold, selected, toggle button` |
| button "Bold", not pressed | `Bold, toggle button` |
| radio "Small", checked | `Small, radio button, checked` |
| combobox "Country", value "Korea" | `Country, Korea, combo box` |
| dialog "Settings", modal | `Settings, dialog, modal` |
| button "Pay", disabled | `Pay, button, disabled` |
| tab "Details", selected | `Details, tab, selected` |
| slider "Volume", value 30 | `Volume, 30, slider` |
| navigation "Main" | `Main, navigation` |

What it does not say: where a stop sits in a list ("2 of 5"), which landmark or group the cursor entered, that a link was visited, that a field is invalid, that a control opens a popup, key hints, or any verbosity-dependent wording.

Each spoken output also carries `evidenceProvenance: 'simulation'`, the profile name and the sanitized semantic details as diagnostic metadata.

## Evidence behind the rules

Some wording rules were checked against what people reported hearing from real VoiceOver. The rest are choices made here.

### Backed by reported VoiceOver output

Thirteen reports from [Accessibility Supported](https://github.com/accessibilitysupported/a11ysupport.io), pinned at commit `6730ad42e83dd780f63555ab3f14f1c26ea0fae5`, are kept as regression cases in `tests/fixtures/voiceover-evidence/a11ysupport-navigation.json` and run by `tests/mock-voiceover-evidence.test.ts`. Each case has the source URL, the JSON pointer, the SHA-256 of the source file, the recorded environment and command, the reported speech word for word, and a semantic input written by hand. That semantic input is not a captured accessibility tree.

| What | Reported speech | macOS / Safari | Tested | Command |
|---|---|---|---|---|
| Toggle button, not pressed | `action, toggle button` | 15.5 / 18.5 | 2025-07-25 | next item |
| Toggle button, pressed | `action, selected, toggle button` | 15.5 / 18.5 | 2025-07-25 | next item |
| Toggle button, mixed | `action, mixed, toggle button` | 15.5 / 18.5 | 2025-07-25 | next item |
| Plain button | `action, button` | 15.5 / 18.5 | 2025-07-25 | next item |
| Plain button | `apply, button` | 10.14.5 / 12.1.1 | 2019-08-10 | next item |
| Checkbox, unchecked | `yes, unchecked, checkbox` | 10.15 / 13.0.3 | 2019-12-06 | next item |
| Checkbox, checked | `Tomato, checked, checkbox` | 10.14.5 / 12.1.1 | 2019-05-24 | next item |
| Link | `link, sample` | 10.14.5 / 12.1.1 | 2019-07-24 | next item |
| Disclosure button, collapsed | `show more, collapsed, button` | 10.15.4 / 13.1 | 2020-03-30 | next focusable item |
| Disclosure button, expanded | `show more, expanded, button` | 10.15.4 / 13.1 | 2020-03-30 | next focusable item |
| Optional text field | `Fruit, edit text.` | 10.14.5 / 12.1.1 | 2019-07-01 | next focusable item |
| Required text field | `Veggie, required, edit text.` | 10.14.5 / 12.1.1 | 2019-07-01 | next focusable item |
| Textarea with a value | `tell us about yourself, edit text, buffalo buffalo buffalo` | 10.15.2 / 13.0.4 | 2020-01-03 | next form field |

These show the wording rules for toggle buttons (no `not pressed`), checkboxes (state before the role), disclosure buttons, links (role first), text fields (`edit text`, `required` before the role) and the textarea (name, role, value, no `multi-line`). The comparison ignores case, whitespace, commas and full stops, and keeps every word and its order. That all thirteen match says the formatter reproduces these thirteen. It is not a fidelity score.

The simulation uses one wording for a control whatever the command. The thirteen VoiceOver cases use different commands for different controls, so they cannot show whether VoiceOver words the same control differently by command. The NVDA cases do: the order of role and name differs between next item and Tab. The cases also come from tests dated between 2019 and 2025, so the profile is a composite.

### Not backed by reports (chosen here)

These behaviours are inferences or conveniences, and are listed again in the assumptions below:

- Live-region text is spoken once after the action that caused it. Reports exist for `role="status"` support in VoiceOver and Safari (Accessibility Supported, 2020); skipping an empty region is inferred.
- List markers are not stops, because WebKit does not expose them as separate objects (inferred). `strong` and `emphasis` are read as text.
- A new page is announced by its title alone. Real VoiceOver adds its own page-load wording.
- Wording of boundary messages (`End of content`, `No more headings`), the rotor announcements (`Headings, 3 items: ...`, `Form controls, N items`) and the order of the extra states (`disabled`, `read only`, `modal`, description) has no observed-output fixture.
- What the speech is after `activate`, typing and live changes. Reports show that activation speech is action-specific: a checkbox may say its new state first, a toggle may say a short state word or nothing. The simulation always speaks the current stop's summary.

## Corpus data and coverage

The evidence module (`rawstep/evidence`, source in `evidence/`) holds a read-only summary of the reported speech, a strict wording reference, and a research formatter. **Rawstep runs do not use any of it.** A run on the simulation uses `formatSimulatedSpeech` only. The corpus exists to make the usable evidence and its gaps measurable.

### What was collected

2,914 reported-result records from third-party sources, normalized from the pinned Accessibility Supported commit and, for VoiceOver, from published ARIA-AT reports:

| Screen reader | Source | Records |
|---|---|---|
| VoiceOver (macOS) | Accessibility Supported, Safari | 544 |
| VoiceOver (macOS) | Accessibility Supported, Chrome | 4 |
| VoiceOver (macOS) | ARIA-AT published reports | 742 |
| NVDA | Accessibility Supported, Chrome | 530 |
| NVDA | Accessibility Supported, Edge | 523 |
| NVDA | Accessibility Supported, Firefox | 557 |
| NVDA | Accessibility Supported, Internet Explorer | 14 |

These are result records, not unique sentences, independent repetitions or votes. Many carry quality flags kept from normalization, for example reported prose rather than a transcript (246), unreviewed status (238), placeholder instead of literal speech (47), a multi-control reading unit (32), a reported "no output" description (22), contradicting the declared state (4). Of the 2,914, 2,235 are eligible candidates for a wording rule. Candidate does not mean approved. The full compact catalog is `EVIDENCE_CATALOG` and `EVIDENCE_GROUPS` in `evidence/data.ts`; the larger source corpus is kept outside this repository. Settings that sources do not report (Quick Nav, verbosity, voice, punctuation, keyboard layout) stay `unknown`; they are never filled with assumed defaults. A source's declared setup target is not recorded native cursor or focus.

### The 25 regression cases

`evidence/data.ts` holds 25 cases (also in `tests/fixtures/screenreader-evidence/observed-cases.json`, tested by `tests/evidence-corpus.test.ts` and `tests/evidence-coverage.test.ts`):

- 13 VoiceOver cases, the table above.
- 12 NVDA cases: plain button on next item and Tab (2025.3.1 / Chrome 143), toggle button in three states on next item and Tab (2025.1.1 / Chrome 137), link on next item and Tab and optional and required text field on Tab (2021.1 / Chrome 92).

`formatEvidenceSpeech` is a strict reference. It needs an exact versioned profile, the command, the element kind, explicit state flags and an isolated English control. Anything else returns `unsupported` instead of a guess. A match means "this wording rule reproduces this report", with `nativeParityEstablished: false`. NVDA wording is not used by the simulator, which is a VoiceOver profile.

`summarizeEvidenceCoverage()` lists a fixed backlog of 44 state and action cells. With no filter, 17 are covered by a case and 27 are not:

| Not covered | Cells |
|---|---|
| Navigation | static text and heading on next item, heading on next heading, disabled button, filled text field, select (focus, option, choosing an option) |
| Activation | link, button, toggle button, checkbox, disclosure |
| Radio | next item, Tab, arrow selection |
| Other checkbox | mixed on next item, unchecked on Tab |
| Text entry | text field, read-only field, password field, textarea |
| Dynamic | dialog open and close, status update, alert update, removing the focused node |

A passing case says nothing about reading order, cursor movement, focus, application behaviour, real OS settings or accessibility conformance.

### Learned wording and its honest result

A research step tried to learn wording templates from the whole corpus and score them on fixture families it had not trained on. It is deployed as 8 rules (`listCorpusRules()`), each learned from at least two training families, and `summarizeCorpusEvaluation()` returns the frozen scores:

| Design | Records | Predicted | Exact matches | Unsupported |
|---|---|---|---|---|
| Original strict fixed split | 230 | 0 | 0 | 230 |
| Fixed holdout, after merging near-identical fixtures | 509 | 4 | 4 | 505 |
| Leave one unseen family out | 2,606 | 18 | 8 | 2,588 |

The first result, no predictions, is kept as it came out. The other two were designed after looking at it and are labelled exploratory, not a confirmatory test. In the leave-one-out run 8 of 18 predictions matched exactly (44.4% of predictions, 0.31% of all records), covering 0.69% of records. Accuracy of the original split is undefined, since nothing was predicted. There is no basis in this data for a claim of general VoiceOver or NVDA emulation.

`createCorpusMockBackend` and `runCorpusMockTask` connect these rules to the same Chromium mechanics. Only `next` and `Tab` are exposed, activation and typing are refused, and unknown roles, extra states, ancestor groups, unseen fixture families, async changes and unknown version tuples abstain with an `UnsupportedCorpusPatternError` instead of falling back to plausible text. Exploratory generalization needs an explicit `allowExploratoryGeneralization: true` in `formatCorpusSpeech`. Neither is used by Rawstep runs.

### Reproducing the corpus data

The source checkout is a separate clone of Accessibility Supported at the pinned commit; the scripts read it with `git show` and never run its code or use assertion text as speech. All commands take `--evidence-root` (a folder you choose, for the normalized corpus) and, where noted, `--repo` (this repository).

```sh
python scripts/collect-screenreader-evidence.py --source PINNED_CHECKOUT --at nvda --out CORPUS/nvda
python scripts/collect-screenreader-evidence.py --source PINNED_CHECKOUT --at vo_macos --out CORPUS/a11ysupport/normalized-v2
python scripts/build-evidence-catalog.py --evidence-root CORPUS --repo .
node scripts/extract-evidence-patterns.mjs --evidence-root CORPUS --source PINNED_CHECKOUT --out CORPUS/pattern-analysis/features-family-v2.json
python scripts/evaluate-evidence-consensus.py --evidence-root CORPUS --repo .
python scripts/build-learned-evidence.py --evidence-root CORPUS --repo .
```

- `build-evidence-catalog.py` also reads the retained ARIA-AT data and the earlier VoiceOver regression cases from `CORPUS`. It writes `evidence/data.ts` and `tests/fixtures/screenreader-evidence/observed-cases.json`.
- `extract-evidence-patterns.mjs` parses static HTML only and checks each fixture's SHA-256.
- `evaluate-evidence-consensus.py` reads the original strict result from `CORPUS/pattern-analysis/strict-fixed-split/evaluation.json` (written by `learn-evidence-patterns.py` from `features.json`) and writes the consensus rules and the scores.
- `build-learned-evidence.py` writes `evidence/learned-data.ts` from the training rules only.

Do not hand-edit `data.ts` or `learned-data.ts`, and never correct recorded speech: a typo in a source transcript stays a typo. These scripts install and run no screen reader and no model.

## Assumptions

Everything the simulation takes for granted, in one list. Each one is a place where a real run can differ.

1. **The Chromium accessibility tree stands in for what Safari gives VoiceOver.** Names, roles and states can differ between browsers and versions, even though the formatter is deterministic for the same input.
2. **Navigation is a flat list in page order.** Real VoiceOver can also group related items and lets the user move into and out of groups. Only the item-by-item order is modelled.
3. **English only.** Wording, boundary messages and rotor announcements are English. A page in another language is spoken with English role words.
4. **Settings are unknown.** Verbosity, voice, punctuation, Quick Nav, typing echo and keyboard layout are not modelled. The source reports leave them unknown, and the simulation does not fill them in.
5. **The wording is a composite across macOS and Safari versions.** One next-item wording is used for every command.
6. **One string is one announcement.** There is no speech queue, interruption, speaking rate, timing, pause or earcon. What is "heard" is the list of strings, in order.
7. **The cursor follows focus only when focus changes.** Real VoiceOver's cursor-tracking preferences can differ.
8. **Activation is a DOM click or focus call.** It is untrusted, and it is not VoiceOver's press. A page that depends on a trusted gesture, pointer events or native default actions can behave differently.
9. **Activation speech is the current stop's summary.** Native activation can say a changed state first, a short word, or nothing.
10. **Live-region text is spoken once, after the action, in order,** with no role word, no timing and no difference between polite and assertive. An empty live region is not a stop.
11. **List markers, separators and `strong`/`emphasis` roles are not spoken** (inferred from how WebKit exposes them).
12. **Loading a page speaks its title and nothing else.**
13. **The headings and links lists are one announcement,** where real VoiceOver reads a list item by item as the user moves. The form controls rotor starts at the first form control in page order, not at the one nearest the cursor, and cannot be filtered by typing.
14. **Arrow keys, `Home` and `End` go to the page.** This matches VoiceOver with Quick Nav off. With Quick Nav on they would move the cursor.
15. **Context is not announced.** Landmarks, group names on entering, list position, visited links, invalid fields and popup hints are left out.
16. **Only Chromium decides what is hidden.** An object Chromium leaves in the tree is a stop, even if it is offscreen or transparent, because a screen reader reads those too.
17. **Values and descriptions come last.** A description is appended to the end, a value follows the name. Real timing and placement of hints vary.
18. **Password values are never spoken,** and other typed values are spoken as the field's value after entry. Task inputs are redacted in the saved trace by the runner, as for any screen reader.
19. **Only the main document is read.** Iframes, browser chrome and operating-system dialogs are outside it.
20. **The reported speech is manual and uneven.** Source transcripts can contain typos and omissions, dates range from 2018 to 2026, and a pinned example page can be newer than a historical result. The data is used as recorded.

If you add a rule, add the reported speech that backs it to the table above, or add the assumption to this list.

## Tests

- `tests/mock-voiceover-evidence.test.ts`: the 13 VoiceOver wording cases, simulation provenance, the secure-field rule and that internal roles are never spoken.
- `tests/mock-voiceover-browser.integration.test.ts`: the backend against real Chromium: static text, independent focus, dynamic node changes, native and broken custom widgets, dialog focus, real key presses, secure fields, input focus changes and cancellation.
- `tests/mock-runner.integration.test.ts`, `tests/observer-browser.integration.test.ts`: runs through the runner on the simulation.
- `tests/evidence-corpus.test.ts`, `tests/evidence-coverage.test.ts`, `tests/evidence-corpus-browser.integration.test.ts`: the corpus, coverage summary and abstaining mock.

These tests establish what the simulation does. They do not establish that it matches VoiceOver. To run the integration tests without Playwright's Chromium, set `RAWSTEP_TEST_BROWSER_PATH`; see [CONTRIBUTING](../../../../CONTRIBUTING.md#chromium).
