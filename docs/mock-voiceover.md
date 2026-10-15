# Simulated VoiceOver

`mockVoiceOver` is an explicit browser-backed simulator for experimenting with policies, runner integration, and ordinary page behavior without a Mac. It launches real Chromium, reads that browser's current accessibility tree, maintains a separate navigation cursor, and lets the page's own handlers change its state. It does not replay fixture answers or hard-code a task outcome.

**This is a small VoiceOver-inspired approximation, not Apple VoiceOver. Its generated output cannot establish native screen-reader behavior, speech fidelity, or accessibility conformance.** Real VoiceOver and NVDA testing still requires the native machine backend (an assistive-technology environment with `backend` `voiceover` or `nvda`) and the appropriate host.

## Run the bundled browser fixture

Install Node.js 22+ and a Playwright-compatible Chromium as described in the [README](../README.md). No macOS or screen-reader service is required, and a profile with `screenReader: "simulation"` (the default in `rawstep.config.json`) needs no AT Driver. A run profile with a screen reader executor must be configured in `rawstep.config.json` (via `npx rawstep ui`: a connection, then the model in the profile's executor; see [SystemOne](./systemone.md) and [config](./config.md)), and the connection's API key goes in `.env.local`.

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

## Browser reference profiles and evaluation limits

`referenceBrowser: 'safari'` (default) selects `english-dom-navigation-evidence-v8`.
`referenceBrowser: 'chrome'` selects the experimental `english-chrome-navigation-evidence-v2`.
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

Normalized main speech, raw Full Speech Exact, navigation, state and task outcomes must be evaluated separately. Historical normalized full-speech scores are retained as a distinct legacy measure. Native AX keyboard focus does
not establish the native VO reading cursor. The corpus state oracle joins DOM IDs or independently unique AX role/name identities. Snapshot-local native AX
equality IDs distinguish aliases from different controls with the same name. Optional native text selection is observed
separately from the VO cursor; ambiguous identities and unexposed properties remain unmeasured. Empty evidence cannot
count as success. Reports expose these gaps and retain collection
failures in planned denominators. No validated overall 90% accuracy or native replacement is currently established.
See the [collector evaluation audit](../packages/vo-corpus/README.md#evaluation-audit-2026-10-15).

## Supported profile

The current `english-dom-navigation-evidence-v8` profile uses Chromium's CDP accessibility tree and DOM metadata for the main document. It projects group/landmark boundaries, lists, tables, linked-heading reading units and article/figure boundaries. It preserves associated label text in DOM order, including the separately observed trailing label stops. Selected wording, editing and state-change receipts use local macOS/Safari 26.6.2 observations; see [the calibration scope](mock-voiceover-evidence.md). It uses Chromium rather than reproducing Safari's accessibility engine.

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
