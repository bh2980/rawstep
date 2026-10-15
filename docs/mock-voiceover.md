# Simulated VoiceOver

`formatVoiceOverSpeech` generates English VoiceOver-style wording from the target, state, command and prior context supplied by Rawstep. It performs no navigation and launches no browser. Safari and Chrome reference profiles remain separate. The existing `mockVoiceOver` browser adapter uses this same formatter for target announcements; it also provides Chromium navigation and page interaction for integration tests.

**This is a small VoiceOver-inspired approximation, not Apple VoiceOver. Its generated output cannot establish native screen-reader behavior, speech fidelity, or accessibility conformance.** Real VoiceOver and NVDA testing still requires the native machine backend (an assistive-technology environment with `backend` `voiceover` or `nvda`) and the appropriate host.

## Generate speech from an externally selected target

```js
import { formatVoiceOverSpeech } from 'rawstep/mock-voiceover';

const input = {
  referenceBrowser: 'safari', // or 'chrome'; does not select or launch a browser
  command: 'next_focusable_item', // the action Rawstep has already performed
  target: {
    identity: 'save', // stable within the current document
    semantic: {
      role: 'button', name: 'Save', protected: false, disabled: false,
      readonly: false, required: false, multiline: false, modal: false,
    },
    containers: [{ id: 'settings', name: 'Preferences', role: 'region', items: 2 }],
  },
};
const entry = formatVoiceOverSpeech(input);
console.log(entry.speech); // Save button Preferences region
const within = formatVoiceOverSpeech(input, entry.context);
console.log(within.speech); // Save button
```

Pass each returned `context` into the next call for the same session. Reset it on a new document, and keep histories
separate across browsers and sessions. Context IDs are caller-owned stable identifiers; `containers` are ordered
outer to inner. Preserve a Native-exposed landmark even when its name is empty. Tab/Shift+Tab entry and reentry
append the nearest landmark role; movement within it does not repeat that suffix. Safari contentinfo wording is
“content information”; the observed Chrome profile says “footer”. See [the Native landmark study](./voiceover-landmark-speech.md).
Table coordinates in `target.cell` are zero-based. The optional `axId` identifies a target's own
container when it is itself a structural boundary, so that boundary is not also treated as its ancestor.

`semantic` contains the currently observed element state. `checkedStateChanged` distinguishes a checked-control
transition from reading an already checked control. `focused` and `edit` describe independently observed keyboard focus and selection;
`focusEntry: true` requests the existing focus-entry selection wording when such an entry was observed; they are not inferred from the previous speech. Commands
use the existing formatter names: `next_item`/`previous_item`, `next_focusable_item`/`previous_focusable_item`,
`next_heading`, `read_current`, and the other adapter command labels. These labels describe context, not an
executable command API or a declaration that every VoiceOver command is supported.

Unknown command labels throw `RangeError` before formatting or updating speech history. Misspellings and raw
VoiceOver chords such as `VO+U` must not produce a plausible object announcement. Recognized contexts are
`next_item`, `previous_item`, `next_focusable_item`, `previous_focusable_item`, `next_heading`, `previous_heading`,
`next_form_control`, `read_current`, `read_focused`, `activate_button`, `activate_form_control`, `enter`, `escape`
and `enter_text`. The existing adapter also supplies arrow keys, `Home`, `End`, `Shift+Home`, `Shift+End`,
`Backspace`, `Delete` and `ControlOrMeta+A` as object-reading contexts when no separate event rule handles them.
Those compatibility contexts do not model edit echoes, activation receipts or a rotor. In particular, `read_current`
is not an established mapping for Native VO+F3; see the [command calibration](./voiceover-target-conditioned-evaluation.md).

`semantic.description` is inline description content. `semantic.help` is a help/usage-hint prefix;
`semantic.hasMoreContent` independently supplies the observed additional-content-menu instruction. These fields
must come from the caller's observed semantic source; an arbitrary description is not evidence of additional
content. See [the controlled Native description-source study](./voiceover-description-sources.md) for scope and raw-receipt gaps.

The `VoiceOverSpeechResult` return value contains `speech`, an optional `usageHint` candidate and the next serializable
`context`. Every result explicitly has `status: 'approximation'`, `evidenceProvenance: 'simulation'` and
`nativeParityEstablished: false`. A previously matched regression pattern does not certify an arbitrary caller's
target, state, history or browser environment. These fields do not measure input coverage or assign confidence.
The function does not mutate its input or prior context. It does not schedule, cancel or attribute speech; callers
must not interpret a returned hint as proof of native timing or queue behavior. Live-region event ordering,
character-edit echoes and activation results are not fully covered by this target formatter.
Use the separate activation API below for its explicitly modeled state events. Unknown native context must be reported by the calling test as unmeasured;
passing missing context as an empty history is not proof of a correct prediction.

For a verified checkbox change, `activate_form_control` describes physical Space and `activate_button` describes VO activation.
Chrome VO activation returns only `checked`/`unchecked` and preserves previous structural speech history; Safari
returns the measured object-change wording. Both measured commands omit a new checkbox hint candidate. Reading
the same control still returns a hint. See [the controlled checkbox contrasts](./voiceover-checkbox-speech-contrasts.md)
for Native evidence, first/return histories and the remaining timing/VO-entry limits.

Run the browser-free executable example after installing Rawstep:

```sh
node node_modules/rawstep/examples/v2/voiceover-speech.test.mjs
```

The context-return Native fixtures are calibration/regression evidence: Safari 36/36 and Chrome 32/36 main-speech
comparisons match when the observed target and shared HTML context are supplied. Four Chrome inferred-article
naming mismatches remain recorded. These results do not establish independent generalization or whole-engine
accuracy. See [the context audit](./voiceover-speech-context-audit.md) for the data limitations.

The [new context composition evaluation](./voiceover-speech-context-evaluation.md) records 60/60 Main Speech matches
per browser on a frozen, initially unseen synthetic cohort, with literal full-speech failures and input-quality scope
reported separately. It is now inspected regression evidence.

The [description/state transfer evaluation](./voiceover-speech-transfer-evaluation.md) exposed a 15/21 first-evaluation
main result in each browser. Corrections reach 21/21 on those inspected regression inputs; this does not replace
the first evaluation. [The sample coverage audit](./voiceover-sample-coverage.md) separates archive volume from
verified independent examples and records the Safari/forward-reading imbalance.

The [button state study](./voiceover-button-state-speech.md) separates reading from activation receipts.
Toggle roles take precedence over expanded wording. Native state conversion preserves both browser subroles and mixed states.

### Format an activation already performed by Rawstep

```js
import {formatVoiceOverActivation} from 'rawstep/mock-voiceover';
const beforeTarget = {
  identity: 'options',
  semantic: {
    role: 'button', tagName: 'button', name: 'Options', pressed: false,
    protected: false, disabled: false, readonly: false, required: false,
    multiline: false, modal: false,
  },
};
const target = {...beforeTarget, semantic: {...beforeTarget.semantic, pressed: true}};
const result = formatVoiceOverActivation({
  beforeTarget, target, command: 'activate_form_control', referenceBrowser: 'chrome',
});
if (result.status === 'unsupported') throw new Error(result.reason);
console.log(result.utterances); // ['selected Options toggle button']; Safari returns []
```

Supply independently observed before/after targets, not expected speech. `activate_form_control` means physical
Space; `activate_button` means VO activation. The function models physical Space on a stable native HTML button
with stable non-state semantics, and isolated boolean checkbox transitions for either command. Button VO activation,
changed identity/name/other semantics, appearing/disappearing state attributes, protected/disabled controls, unknown
before state and transitions **to** mixed pressed state return `status: 'unsupported'` with a reason and no utterances.
A mixed initial pressed state followed by a boolean state is supported. The existing target formatter remains available
for an explicit object reading; it is not an activation-event fallback.

`status: 'modeled'` means an implemented guarded event rule returns ordered receipt candidates; it is not a Native
match verdict. Both activation result branches have `evidenceProvenance: 'simulation'` and
`nativeParityEstablished: false`. `[]` represents a modeled silent activation and differs from
unsupported evidence. Chrome pressed changes can precede the two object receipts from expansion; repeated strings
are preserved. This is neither a speech queue nor a completion guarantee. A button activation preserves structural
reading context; feed the returned context into the next call. The existing browser adapter delegates measured Space
events to this same function while retaining its legacy approximations for other actions. Keep the two browser profiles
and their histories separate. Live-region announcements, navigation, event interruption and timing remain outside
this API. The [activation evaluation](./voiceover-activation-evaluation.md) reports calibration, frozen first evaluation and corrected regression separately.

### Evidence boundaries for test callers

| Area | Current evidence | What the caller must still establish |
| --- | --- | --- |
| Button/link/heading/checkbox reading and descriptions/help | Selected Native input/output pairs and new composition evaluations | Correct supplied role, state, description/help source and previous context; arbitrary combinations are not certified |
| Landmark, named group and article context | Entry/return rules and controlled composition transfer | Complete exposed ancestor path and stable IDs; the Chromium projection is a separate check |
| Nonmodal dialog context | Standalone/parent contrasts and a 40-action actual-input task regression per browser | Direct exposed children/name inputs; modal, nested and mixed-command behavior remain uncalibrated |
| State-change receipts | Activation API explicitly reports `modeled` or `unsupported` for its measured scope | Independently observed before/after state; a modeled silence is distinct from unsupported |
| Editing, live updates, nested documents and speech timing | Partial legacy adapter rules or unmeasured behavior | Do not treat a generated object summary as a validated event sequence |

Command recognition is not an evidence/coverage checker. The object formatter marks its role/state fallbacks as
approximations; it never certifies a call as Native-verified. Until those combinations are independently
validated, keep them outside a test's declared supported scope or mark the comparison unmeasured. Passing an
empty history for unknown previous context cannot establish a valid speech match. Speech-only results and
Rawstep input-projection/interaction results must be reported separately.

For evaluator code that owns a `MockVoiceOverBackend`, call `getSpeechInputObservation()` after `observe()`.
It returns a copied `mock-speech-inputs-v1` record with the completed observation's `windowId`, capture time and
the actual formatter inputs plus their previous speech contexts. Reading events distinguish emitted announcements
from suppressed duplicates; activation events retain `modeled`/`unsupported`. Compare the window IDs before joining
this diagnostic to outputs. It does not perform an action or infer Native reading position. The record is absent from
policy observations/events, excludes protected edit values and is cleared on close. Other fixture/user text can still
be present, so keep evaluator archives outside policy inputs and apply the usual data-handling policy. These are
Rawstep inputs, not independent evidence that the corresponding Native target/state/context is equal.

Browser outputs preserve the same distinction in `raw.wordingEvidence`: ordinary reading, hints, live/editing
approximations and legacy activation fallbacks have `status: 'approximation'`; receipts emitted by the guarded
activation API have `status: 'modeled'`. Both retain `nativeParityEstablished: false`. Alternative corpus formatters
keep their own existing evidence objects. No status supplies a conformance verdict or an accuracy score.
For an unsupported activation, the evaluator-only input observation now also retains its `reason`. The legacy browser
adapter may still emit approximate fallback speech; it does not promote that fallback to a modeled activation.
An empty speech array alone therefore cannot distinguish modeled silence from unsupported behavior. Pure API callers
must branch on the activation result's `status`, as in the example above; the trace diagnostic is for evaluator code.

The [dialog task study](./voiceover-dialog-transfer.md) records the first actual-input task result separately from
the later parent-context calibration/correction. Safari v20 / Chrome v14 use nearest-context Tab wording and ordinary
hints for named dialogs inside another exposed focus context. The standalone summary is retained. The corrected
40/40 task replay is inspected regression, while its initial independent Main score remains 34/40 in each browser.

The [new-site input audit](./voiceover-public-target-v3.md) separates the original comparison defect from observed-input
regression: missing list-link set fields are now detected and constructed from complete Native AX, while ambiguous
image-link outlines and failed preparations remain in the full denominator. These limited samples do not establish
overall real-site accuracy.

The [four-site first evaluation](./voiceover-public-target-v4.md) preserves Safari Main 7/7 and Chrome 9/10,
against 16 planned returns each. A separate all-input audit marks the Chrome compound link/heading input unmeasured;
it does not increase the 7/16 and 9/16 all-planned match counts. Literal Full failures and missing previous context
remain explicit. Native-supplied inputs do not establish Rawstep Chromium input equivalence on those sites.

The [new article/form dialog compositions](./voiceover-dialog-compositions.md) retain the first predictions and a
stricter input audit: 36/39 Safari and 39/39 Chrome planned actions have equivalent original inputs. Safari's three
missing title-help inputs motivated source contrasts and the v21 / Chrome v15 projection correction. Actual Rawstep
input/receipt regressions are separate from AX-supplied pure-formatter regressions and from the first independent score.
Combined ARIA/title help is calibrated for native HTML buttons; unknown roles/contexts remain outside that claim.

The [help/form contrast and reserved-task study](./voiceover-hint-source-context.md) records Safari/Chrome source
and role differences for equal title help, transparent unnamed-form Tab context and literal help-receipt spaces.
The reserved tasks retain first 19/24 gated matches per profile and a separate 24/24 verification-scope audit of the
same predictions. Actual-input regressions and independent first results remain distinct; image-map link context
and the current final build's new-site generalization remain unverified.

## List focus wording and dynamic-list evaluation

Safari v22 / Chrome v16 distinguish a link reached by Tab/Shift+Tab from an object-reading command.
A measured Tab entry appends the nearest exposed list and its direct item count; subsequent moves within that
list omit the repeated context. Leaving and returning announces the count again. Object-reading link ordinals
remain separate. Supply `containers` outer to inner, retain the Native-exposed list, and give `items` its actual
direct exposed-item count. Markers and a link within one item do not count as two items. List context on
non-link controls, named/nested lists and mixed object/Tab histories need separate validation.

For conventional `ul`/`ol` list items, the Chromium adapter counts direct list items. Markerless implicit body
lists are omitted in the measured Safari projection and retained in Chrome; explicit list roles and navigation
contexts have separate controls. Arbitrary direct children and custom list semantics are not established by this
study. Pure formatter callers supply the selected browser's exposed context themselves.

The immutable [first list contrasts](../tests/fixtures/voiceover-evidence/native-list-profiles-calibration-2026-10-16.json)
and [geometry contrasts](../tests/fixtures/voiceover-evidence/native-list-profile-geometry-2026-10-16.json) retain
baseline Safari v21 / Chrome v15 predictions. These are original gate results; the old gate did not yet verify
focus-link list counts. Initial list contrasts had Safari Main/Full 19/27 comparable
(19/36 planned); Chrome's 24 link targets were geometrically ambiguous and no complete speech window was
normally comparable. Those original ambiguities remain unmeasured. A three-page train contrast added only
inline-block anchor padding to distinguish link and child-text geometry. Its first Main/Full scores were Safari
10/14 (10/18 planned) and Chrome 4/8 (4/18 planned), with input-projection errors recorded separately.
After correction, actual Rawstep input and literal Full regressions match all 18 geometry actions per browser.
These are inspected regressions, not independent generalization scores.

Two task bodies and their complete command histories were reserved before calibration Native was inspected.
Their effective measurement pages add the same train-derived anchor padding; raw source pages remain preserved
and unobserved. Source/effective counterparts share test groups and are not separate independent examples.
No template/site/contrast group or complete-sequence collision was found against external prior cases. Primitive
roles and measurement CSS are shared, so this is limited composition transfer, not representative web sampling.
The corrected model build `743f8c2ff2e3ab15363d366951b14cf7926ebe83fe0123ffd5ba29cefe249e2c`, actual inputs,
histories and predictions were sealed before Native started in either browser. Full hashes and the effective/source
reservation are retained in the [first task fixture](../tests/fixtures/voiceover-evidence/native-list-profiles-transfer-2026-10-16.json).

| Reserved tasks, per browser | Safari | Chrome |
| --- | ---: | ---: |
| Planned / Native observed | 28 / 28 | 28 / 28 |
| First comparable Main / literal Full | 22/22 / 22/22 | 24/24 / 24/24 |
| First matches / all planned | 22/28 | 24/28 |
| Post-inspection input audit: Main / literal Full | 24/24 / 24/24 | 24/24 / 24/24 |
| Audited matches / all planned | 24/28 (85.7%) | 24/28 (85.7%) |
| Independently joined reading targets | 26/28; 2 unmeasured | 26/28; 2 unmeasured |
| Keyboard focus | 28/28 | 28/28 |
| Observed state fields | 50/56; 6 unmeasured | 50/56; 6 unmeasured |
| Boolean state / appearance transitions | 2/2 / 2/2 | 2/2 / 2/2 |
| Final task outcomes | 2/2 | 2/2 |

The [separate input audit](../packages/vo-corpus/test/list-profiles-transfer-input-audit.json) preserves first scores.
It corrects two Safari false input rejections: a named article consumes its own name, so its unused projected
entry-child name need not equal Native. Chrome's inferred-name fallback and unnamed articles still require that
child name. Speech rules, model predictions and observations are unchanged by this audit.

In both tasks/browsers, revealing the third list item moves the control down 46px. The stable post-action VoiceOver
outline remains at its observed pre-action rectangle and matches no current AX object. These four target windows
and their following unknown histories remain unmeasured despite matching words and keyboard focus. This observation
does not identify the private logical cursor or prove an AT Driver cause. Six state-field windows concern the
initially absent third link; its absence is measured separately, not invented as a disabled-state value. Two tasks
and two boolean transitions do not establish whole-engine Navigation/State Accuracy or 90% real-web parity.

The [acquisition audit](../packages/vo-corpus/test/list-profiles-acquisition-audit.json) retains every attempt:
200 planned actions, 188 in case records and 191 completed journal windows. The first Safari attempt was interrupted
after the effective Tab setting skipped links despite a defaults readback of 1; 24 case-record actions and 27 journal
windows remain archived against its 36 planned actions. Journal windows do not prove the number of dispatched keys.
The actual Safari checkbox was then enabled and read back for paired runs. It and the temporary defaults key have
been restored to the prior off/absent state. Both browsers used the same effective HTML and commands with English
VoiceOver; `baseline-v2-dnd-tablinks-probe-v1` records this controlled collection setting. The differing model builds
and calibration/transfer populations must not be pooled into one accuracy percentage. Bounded receipt windows still
do not establish native queue timing, completion or interruption fidelity.

To regenerate update pages, use the existing corpus generator sets `list-profiles-v1`, `list-profile-geometry-v1`
and `list-profiles-measured-transfer-v1`, each with a new output directory. These inspected pages are now regression
material. Replay the public evidence without a Native server:

```sh
npm run build
npm run test:integration -- tests/mock-voiceover-list-focus.integration.test.ts tests/mock-voiceover-list-transfer.integration.test.ts
node --import tsx --test packages/vo-corpus/test/list-profiles.test.ts packages/vo-corpus/test/speech-input.test.ts
```

The task regression preserves all 28 literal receipt comparisons as diagnostics while only 24 retain comparable
Native inputs/history in the audited score. Matching the other four strings does not promote them to successes.

## Checkbox state events inside tables

A confirmed checkbox state change uses its measured value-change receipt without the ordinary row/header/column
reading prefix. Ordinary cell reading retains those structural words. This rule uses the existing role, change flag,
command and cell context; it adds no movement operation and no element-name or fixture lookup. Other stored speech
history behavior is unchanged. Physical Space still uses the guarded activation API; the existing adapter's VO activation
path retains its reading diagnostic with `checkedStateChanged`. Both call the corrected shared formatter.

[Three controlled contexts](../tests/fixtures/voiceover-evidence/native-table-state-calibration-2026-10-16.json)
put the same checkbox and full Tab/Space/VO-activation/return sequence in flat content, a table and a named region
around a table. The original frozen Safari v22 / Chrome v16 model matches 20/24 and 22/24 Main and literal Full
windows. All 24 targets/used inputs per browser and all 12 boolean transitions are independently observed. The six
wording failures share one cause: cell-reading prefixes leak into the first checked receipt after entry or return.
The controls' final checked state is a fixture-health check, not three successful user tasks. Corrected inspected
regressions match all 24 actual-input/receipt windows per browser.

Two new table/form tasks were reserved before that Native calibration: a three-column tour plan where a checkbox
enables a reservation button, and a permission table with row headers, a named group inside a cell and reverse returns.
The original generator/case fingerprints, model JavaScript and actual Rawstep inputs/history/predictions were fixed
before Native ran in either browser. Declared template/site/contrast groups and full sequences had no external prior
collision; shared primitives are not global structural independence. The first transfer build is
`46de2faf2ff7d887f162d5dfaa579698277c1e8438f1effebbbfd53600accd68` (Safari v23 / Chrome v17), from the collection
worktree with earlier pending evaluator diagnostics; hashes do not claim a pristine commit build.
The [immutable first transfer](../tests/fixtures/voiceover-evidence/native-table-state-transfer-2026-10-16.json) reports:

| First independent composition result | Safari | Chrome |
| --- | ---: | ---: |
| Planned / Native observed / comparable | 30 / 30 / 30 | 30 / 30 / 30 |
| Main Speech Exact | 30/30 | 30/30 |
| Literal Full Speech Exact | 27/30 | 27/30 |
| Independent outline/AX target joins | 30/30 | 30/30 |
| Keyboard focus | 30/30 | 30/30 |
| Declared state fields / boolean transitions | 74/74 / 9/9 | 74/74 / 9/9 |
| Final task outcomes | 2/2 | 2/2 |

State fields are repeated snapshots, not 74 distinct state transitions. Checked-change flags on the legacy VO path
additionally require a proven same pre-action target and matching frozen-model/Native before/after boolean states.
No unknown state, failed setup or ambiguous target was excluded from these 30 planned windows. These are two small
authored tasks, now inspected regression material. Outline/AX target joins are narrower than general logical-cursor
Navigation Accuracy; the result does not prove complete VoiceOver or real-web parity. Mixed object/Tab row-history,
text editing, multiple column headers and native queue/completion/timing remain outside this evaluation.

The three Full failures per browser have correct main speech but incorrectly add “inside of a cell” when a named
group intervenes. Their first predictions and scores remain unchanged. Separate one-factor grouping controls address
that counterexample before changing hint rules.

Native AX schema v6 now preserves cell row/column ranges and bounded column/row-header reference IDs, with observed,
unsupported, no-value, read-error and truncated data kept distinct. The [AX-only smoke](../tests/fixtures/voiceover-evidence/native-table-ax-metadata-2026-10-16.json)
uses previously inspected pages and establishes attribute construction, not speech or reading-position accuracy.
The [Apple header-reference API](https://developer.apple.com/documentation/applicationservices/kaxcolumnheaderuielementsattribute?language=objc)
returns accessibility objects; references are joined by snapshot-local AX equality IDs to complete source nodes.
No header is recovered from a spoken string. Missing ranges, dimensions, truncated/conflicting references and multiple
headers stay unmeasured. Tab inputs can carry existing `hintInCell` membership without invented cell coordinates;
non-focus inputs that consume cell fields require independent row/column/header/span observations. Old AX snapshots
are not filled with new fields. Collector protocol v9 keeps new-schema attempts separate from older resume protocols.

The [separate grouping calibration](../tests/fixtures/voiceover-evidence/native-table-group-hints-2026-10-16.json)
keeps the checkbox, table, title and full four-key focus history constant across direct placement, an ordinary `div`,
an unnamed explicit group and a named explicit group. Both browsers keep the cell location hint in the first three;
only the nearest named group suppresses it. All 16 targets/used inputs per browser are observed, with first Main 16/16
and literal Full 14/16. A pre-Native protocol clarification in the immutable acquisition metadata corrects the reused
plan's generic state-event question: these cases contain focus commands only. Four final-state checks are fixture
health, not successful user tasks.

Safari v24 / Chrome v18 apply that measured named-group rule to checkbox hints while preserving cell geometry and
ordinary row/column reading. Other roles or intervening container kinds need separate Native evidence. Actual-input
regressions are separate from first evaluation: calibration 24/24, task compositions 30/30 and grouping controls 16/16
literal Full windows per browser now match. The initially unseen task score remains Main 30/30, Full 27/30; subsequent
hint correction makes it inspected regression rather than a new independent 100% result. Neither rule reads the
fixture name, URL, goal or expected utterance.

The [acquisition audit](../packages/vo-corpus/test/table-acquisition-audit.json) retains all six Native collection
attempts: 140 planned actions, 140 case-record actions and 140 journal windows, with separate environment tuples,
source hashes and model/cohort boundaries. No Safari preference was changed for these checkbox/button studies.
The two-browser AX-only smoke is separate and has no VoiceOver test action or speech comparison. Regenerate the
inspected update pages with the existing corpus sets `table-state-speech-v1`, `table-state-transfer-v1` and
`table-group-hints-v1`, each into a new output directory. For browser-free formatter and actual-input browser regressions:

```sh
npm run build
npm test -- tests/mock-voiceover-table-state.test.ts tests/mock-voiceover-table-group-hints.test.ts
npm run test:integration -- tests/mock-voiceover-table-state.integration.test.ts
node --import tsx --test packages/vo-corpus/test/table-state-speech.test.ts packages/vo-corpus/test/table-group-hints.test.ts packages/vo-corpus/test/table-context.test.ts packages/vo-corpus/test/speech-input.test.ts
```

## Run a deterministic regression test

After installing Rawstep and a compatible Chromium, run:

```sh
node node_modules/rawstep/examples/v2/voiceover-regression.test.mjs
```

From this repository, `npm run test:voiceover` builds and runs both the browser-free speech example and the keyboard
workflow example. It needs no LLM, API key, native screen-reader server or model configuration. The four keyboard
tests assert simulated object/live announcements and run the workflow in both reference profiles. They inject a
disabled-control regression to prove that an unmet page outcome fails even when the scripted policy reports success.
Both the working and deliberately broken expectations must pass for this test command to
succeed. This tests the example workflow and verifier sensitivity, not universal VoiceOver fidelity or a WCAG rule.
Use the [test source](../examples/v2/voiceover-regression.test.mjs) as a starting point for your own page and fixed
commands. `runMockVoiceOverTask` returns a trace; assert its outcome so unsuccessful runs fail your CI process.

## Run the bundled browser fixture

Install Node.js 22.12+ and a Playwright-compatible Chromium as described in the [README](../README.md). No macOS or screen-reader service is required, and a profile with `screenReader: "simulation"` (the default in `rawstep.config.json`) needs no AT Driver. A run profile with a screen reader executor must be configured in `rawstep.config.json` (via `npx rawstep ui`: a connection, then the model in the profile's executor; see [SystemOne](./systemone.md) and [config](./config.md)), and the connection's API key goes in `.env.local`.

```sh
npx rawstep run examples/v2/mock-task.json --mode screenreader --profile PROFILE
npx rawstep report .rawstep/runs/RUN_DIR
```

The [fixture](../fixtures/mock-voiceover-system.html) starts with a Save button. Its actual click handler changes the button name and status, then changes the document title after two activations. The independent verifier checks that title. The simulator does not know the goal or supply the completion state.

Task fixture paths resolve relative to the task file. Each run writes to a new directory under `.rawstep/runs/`. Set `machine.browserExecutablePath` to use an existing compatible Chromium and `machine.headless` to false to show it. The simulation backend (the default assistive technology) does not use `machine.atEndpoints`. Screen reader runs save a reference screenshot per step (`diagnostics/step-<n>.png`) for people to look at; the model never sees them.

## Package API

```js
import { resolveTask, ScriptedPolicy } from 'rawstep';
import { runMockVoiceOverTask } from 'rawstep/mock-voiceover';

const task = resolveTask({
  url: './page.html',
  goal: 'Activate Save twice.',
  maxSteps: 4,
  verify: { all: [{ titleIncludes: 'Completed' }] },
}, process.cwd());

const trace = await runMockVoiceOverTask(task, {
  outDir: './runs/simulated',
  referenceBrowser: 'safari', // or experimental 'chrome'; both execute in Chromium
  policy: new ScriptedPolicy([
    { action: { kind: 'intent', intent: 'activate' } },
    { action: { kind: 'intent', intent: 'activate' } },
    { stop: 'success' },
  ]),
});
```

Your page must supply the actions and completion state used by its task; the snippet's title rule is only an example. `runMockVoiceOverTask` and `MockVoiceOverRunOptions` are also available from the root export. The `rawstep/mock-voiceover` module additionally exports `MockVoiceOverBackend`, `MOCK_VOICEOVER_PROFILE`, `MOCK_VOICEOVER_LIMITATIONS`, and the typed `formatSimulatedSpeech` formatter. `MOCK_VOICEOVER_WARNING` describes the approximation at startup.

The wrapper accepts normal runner options including `policy`, `allowedActions`, budgets from the task, `signal`, `diagnosticScreenshots`, and `browserExecutablePath` (these library options are not exposed as CLI flags); it supplies the simulator backend and defaults `headless` to `true`. A `warn` callback can redirect the startup warning. Advanced injected browser sessions must provide a real compatible Chromium page. Policies receive the same model-neutral screen-reader-shaped observation contract, with `provenance: 'simulation'`, rather than a screenshot or privileged DOM selector. A policy can be scripted, local, remote, or model-backed; no provider is selected by Rawstep.

For article containers, `entryChildName` is the name of the immediate **exposed AX child** along the path to the
reading target. Pass an empty string for an unnamed structural child; do not replace it with the descendant button's
label. The formatter uses it only when the reference profile has no Native article name. `inferredName` marks the
Chromium adapter's heading-derived name, which Chrome VoiceOver does not use as an explicit article name. Omitting
`entryChildName` retains the older role-only approximation when a fallback is needed. These inputs describe observed
structure, not a prior utterance. The browser adapter extracts them from the AX path; the formatter never moves focus.

Dialog `items` counts directly exposed AX children, including exposed unnamed groups. Supply `firstChildName`
when the Native dialog name is empty; the formatter composes its summary without using a previous utterance. Safari
and Chrome dialog words/hints remain separate. The [dialog report](./voiceover-dialog-speech.md) distinguishes given-target
speech from Safari's native `<dialog open>` focus/reading-target difference. Modal opening/closing, alert/nested dialogs
and interaction-mode-dependent hints remain uncalibrated.

## Browser reference profiles and evaluation limits

`referenceBrowser: 'safari'` (default) selects `english-dom-navigation-evidence-v21`.
`referenceBrowser: 'chrome'` selects the experimental `english-chrome-navigation-evidence-v19`.
The option selects observed VoiceOver conventions; the renderer remains Chromium. `browserExecutablePath` can pin a
compatible Chromium/Chrome build. Corpus runs record the actual renderer version separately from the native reference
browser. `MOCK_VOICEOVER_CHROME_PROFILE` and `MockVoiceOverReferenceBrowser` are public exports.

Confirmed browser differences currently specialized: associated label reading stops, anonymous native-radio
position announcements, and VO-activation versus physical-Space checkbox/radio receipts. Other shared behavior still
needs independent Chrome validation. The inspected native controls are regression/calibration evidence, not a claim
that the Chrome profile reproduces all VoiceOver behavior. Chrome v2 additionally uses independently observed
selection ranges to announce beginning/end/interior Latin-word caret context when object navigation enters or returns
to a nonempty table field. Tab entry into such a field establishes row context for the following object movement.
Safari counterparts require paired validation before sharing these new rules. Partial selections, interior non-Latin
word boundaries, table-header repetition and editing hints remain incomplete.

Safari v10 / Chrome v4 use observed space separators between generated speech parts, retaining punctuation inside names, descriptions and values. The low-level `formatSimulatedSpeech` default comma separators remain available. See [the correction and remaining gaps](./voiceover-speech-separators.md).

Safari v9 / Chrome v3 correct Tab/Shift+Tab context transitions using paired native contrasts: announce the nearest
group, named landmark, table or article on entry, and announce its ancestor again when leaving the inner context.
Safari uses the inspected heading-derived article name. Safari v18 / Chrome v12 additionally preserve the immediate
exposed AX child name when an article's own Native name is empty. An unnamed intermediate AX group remains empty;
its descendant's label is not substituted. The [article calibration](./voiceover-article-entry-speech.md) resolves the
earlier apparent history difference without fixture text or layout-specific formatting rules.

Normalized main speech, raw Full Speech Exact, navigation, state and task outcomes must be evaluated separately. Historical normalized full-speech scores are retained as a distinct legacy measure. Native AX keyboard focus does
not establish the native VO reading cursor. The corpus state oracle joins DOM IDs or independently unique AX role/name identities. Snapshot-local native AX
equality IDs distinguish aliases from different controls with the same name. Optional native text selection is observed
separately from the VO cursor; ambiguous identities and unexposed properties remain unmeasured. Empty evidence cannot
count as success. Reports expose these gaps and retain collection
failures in planned denominators. No validated overall 90% accuracy or native replacement is currently established.
See the [collector evaluation audit](../packages/vo-corpus/README.md#evaluation-audit-2026-10-15).

## Supported profile

The current `english-dom-navigation-evidence-v25` profile uses Chromium's CDP accessibility tree and DOM metadata for the main document. It projects group/landmark boundaries, lists, tables, linked-heading reading units and article/figure boundaries. It preserves associated label text in DOM order, including the separately observed trailing label stops. Selected wording, editing and state-change receipts use local macOS/Safari 26.6.2 observations; see [the calibration scope](mock-voiceover-evidence.md). It uses Chromium rather than reproducing Safari's accessibility engine.

Safari v8 treats an outer listbox as one object: next/previous skip its internal options. A single selected ARIA option
is summarized with its position; the inspected native HTML select omits that summary. This is based on four inspected
legacy navigation/Tab workflows, not an independent evaluation. Explicit listbox interaction, multiple-selection
summaries and Chrome counterparts are pending the separate `listbox-interaction-v1` native experiment. Internal AX
options remain available to the existing combobox active-descendant observer; the widget's DOM is not rewritten.

The native profile also synthesizes selected English usage hints from role, state, enclosing container and navigation
direction. It queues a hint 600 ms after the object's main receipt, polls it while observing, cancels pending hints on
a new action, and suppresses a hint when the same object is re-announced. The default post-action minimum observation
window is now 800 ms. Set `observationMinWaitMs: 0` for immediate snapshots; a short window may end before the hint,
which remains pending until another observation or action. Longer explicit windows still poll live changes. These are
receipt-time approximations, not an audio or native speech queue model. Editing/autofill hints, verbosity preferences,
complete interaction/exit semantics and rapid-input timing need further native validation. Corpus-based alternative
wording profiles retain their own behavior and do not inherit these native-profile hints.

| Feature | Implemented behavior | Boundary |
| --- | --- | --- |
| `next`, `previous` | Move the simulated cursor without wrapping; next at a terminal enabled plain button repeats it, other boundaries keep fallback wording | Terminal-button behavior is inferred from local final-button observations; other endpoints and native grouping remain uncalibrated |
| Cursor and focus | Object navigation focuses actual focusable DOM objects; static stops preserve keyboard focus; changed keyboard focus can move the cursor | Calibrated to the observed native profile, not all configurable tracking preferences |
| `readCurrent` | Describe the object at the simulated cursor using deterministic English wording | No speech synthesis or native utterance capture |
| `readFocused` | Describe the exposed object with actual keyboard focus | Cursor and focus may refer to different objects |
| `activate` | Guarded DOM `.click()` on supported controls, or `.focus()` on an editable field | AXPress approximation; clicks are untrusted and may differ from native activation |
| Keyboard | Tab/Shift+Tab, Enter/Space/Escape, arrows, Home/End, Shift+Home/End, Backspace/Delete, ControlOrMeta+A | Chromium determines actual key behavior; Safari link-Tab and focus-return selection differences remain |
| `typeText`, `replaceText` | Enter a named task input only into an actually focused editable field; verify focus while typing | Merely browsing to a field is insufficient; disabled and read-only fields reject input |
| Names and context | Roles, states, list markers/positions, nested-list levels, group/landmark ends, table row/column context, dialog entry, tab/radio/menu positions | Partial projection; complex grids, spanning/header relationships and WebKit heuristics need broader native validation |
| Editing and suggestions | Single-character/word echo, selection replacement, caret/deletion receipts, listbox active-descendant announcements without moving DOM focus | Multi-character input and native autofill remain partial; ordinary task input privacy stays enabled |
| Delayed live updates | `observationMinWaitMs` polls semantics during the minimum observation window and preserves successive observed updates | Can miss changes shorter than the polling interval; no native timing/queue/interruption model |
| Dynamic pages | Refresh browser semantics between operations; keep stable object identity where available | No reconstruction of missing ARIA or missing widget handlers |
| Password fields | Discard password values before formatting or emitting semantic diagnostics | Other page text can still contain private information |

Disabled controls remain available for cursor reading when exposed by Chromium, but activation and text entry reject them. An ARIA role alone does not implement a widget: missing click or keyboard handlers remain missing. DOM changes and navigation come from the actual page and remain subject to runner navigation and action restrictions.

Out of scope: complete macOS/Safari AX parity, group interaction commands, rotor, Quick Nav modes, native live-region scheduling, earcons, speech queues and interruption, native pronunciation and verbosity settings, cross-frame navigation, browser chrome, and operating-system dialogs. Selected repeated state receipts are observations from one profile, not a queue model. An observation refresh is not a native speech-completion signal. Browser versions can change accessible objects and names.

## Evidence and privacy

Traces use schema 2.2 (screenshots as `blobs/`) and carry explicit simulation provenance; older schemas are not read. Simulated observations use `simulation.observation`; generated output uses `simulation.output` and `backend.output` with source `simulation`. Native output retains source `screen-reader`. Environment `observationProvenance: 'simulation'` labels even a run that fails before its first observation.

Analysis and reports count readable and redacted simulated output separately from native screen-reader output and screenshots. Observation aggregates and transport acknowledgments do not become additional output evidence. Reports display a simulation warning, preserve independent verifier evidence, and never change the recorded run outcome. A simulated run cannot provide a native conformance verdict.

Task input values are redacted before persistence. The default text-entry privacy boundary conservatively redacts subsequent simulated payloads and withholds subsequent diagnostic screenshots, just as for the native runner. Simulated semantic diagnostics participate in redaction. The programmatic `includeSensitiveInputValues` option is an explicit opt-out; it is not exposed by the CLI or the dashboard. Screenshots and arbitrary page content can contain personal data. Custom policies and analyzers may send their inputs externally; inspect their code and the evidence before using them.

## Verification boundary

Browser integration tests cover actual page transitions and focus, as well as isolated formatter and CLI/report contracts. Such tests establish the implemented profile only. They do not verify real VoiceOver. Use the native path and human testing before drawing conclusions about a user's experience with a native screen reader.

## Native behavior references

These references explain the concepts behind the limited profile; they are not evidence that Chromium simulation matches Apple's implementation.

- Apple describes the VoiceOver cursor and keyboard focus as separate locations with configurable tracking; native defaults synchronize them when possible. This simulator implements only its documented cursor/focus rule, not all tracking preferences. See [cursor tracking and wrapping](https://support.apple.com/guide/voiceover/cursor-tracking-and-wrapping-vo15534/mac).
- Apple distinguishes DOM-order web navigation from grouping related items. The flattened profile is inspired by sequential navigation and does not implement native group interaction. See [DOM and group modes](https://support.apple.com/guide/voiceover/by-dom-or-group-mode-vo2711/mac).
- Native VoiceOver uses VO-Space for the current item's default action and has explicit commands for entering and leaving groups. The guarded browser click/focus implementation is only an activation approximation. See [keyboard commands and interaction](https://support.apple.com/guide/voiceover/control-your-mac-with-keyboard-commands-vo2681/mac).
- Apple's navigation system also includes the rotor, Quick Nav, and other features outside this profile. See [advanced navigation](https://support.apple.com/guide/voiceover/intro-to-advanced-navigation-vo27974/mac).

## Collected VoiceOver evidence

Selected navigation wording is calibrated against recorded third-party VoiceOver
results, with versions, actions, source hashes, attribution and unknown settings
retained. See [evidence, changes and coverage limits](mock-voiceover-evidence.md).
This is a composite simulation profile; activation speech, timing and native
macOS/Safari behavior are not established by these lexical regression tests.

## Linked-heading wording and caller inputs

Safari v26 / Chrome v20 preserve the measured distinction between a link wrapping a heading and a heading wrapping
one link. Supply `headingLinkOrder` or `headingParts` with the heading level; Chrome's latter projection additionally
uses independently observed `semantic.nativeDisclosureLevel` (macOS zero-based). Keep the activation-link identity
separate from the physical outer heading. The [linked-heading study](./voiceover-linked-heading-speech.md) records
object next/previous scope, literal hint-role differences, the frozen h3/h4 reverse-entry results and the separate
post-inspection style-wrapper input audit. Tab, heading jumps, h1/zero disclosure, mixed parts and compound help/state
combinations are outside that measured scope. The formatter remains an approximation, not a coverage certificate.
