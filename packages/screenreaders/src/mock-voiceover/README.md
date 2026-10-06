# Mock VoiceOver browser simulation

`MockVoiceOverBackend` is a browser-backed development and policy-testing adapter.
It is **simulation evidence**, not native VoiceOver output or a conformance result.
The `english-dom-navigation-evidence-v2` profile makes a deliberately small, reproducible set of
choices inspired by screen-reader object navigation. It does not claim exact macOS,
Safari, VoiceOver wording, or interaction fidelity. Selected navigation wording is
now calibrated against versioned, third-party reported VoiceOver output; see
[the evidence and limits](../../docs/mock-voiceover-evidence.md). This composite
profile is not one specific macOS/Safari version.

The backend implements the generic `Backend` interface: `start`, `execute`,
`observe`, `subscribe`, and `close`. Call `attachSession({ page })` with the task's existing
Playwright Chromium page. `start` can precede attachment; the CDP accessibility
session starts on the first observation or action. The backend detaches its own CDP
session on close and does not own or close the caller's browser.

The public `rawstep/mock-voiceover` module also exports `runMockVoiceOverTask` for
runner-managed tasks. Its policy boundary is the normal screen-reader observation:
simulated speech strings and their provenance. DOM nodes, selectors, the complete
accessibility tree, browser screenshots, and verifier feedback are not supplied to
the policy.

## State and navigation

The current Chromium `Accessibility.getFullAXTree` supplies names, roles, values,
descriptions, and states. It is refreshed for each action and observation. Ignored
wrappers are traversed for exposed descendants; hidden or ignored objects are not
spoken. Static text, headings, disabled controls, transparent controls, and offscreen
objects remain browsable when Chromium exposes them. There is no viewport,
opacity, or tab-order filter. Redundant text descendants of named controls and
headings are suppressed. Unnamed structural wrappers are omitted.

The flat accessibility cursor is separate from DOM focus. Next/previous do not
focus page elements. Cursor identity uses Chromium backend DOM node IDs so an
insertion does not silently retarget the cursor. If its node disappears, the next
surviving object from the previous order is selected, or the preceding survivor,
or the first new object. Replacing a DOM text node also replaces its identity.

Actual DOM focus is read separately, including open shadow roots. A change in
focus moves the cursor to that exposed object; unchanged focus does not repeatedly
pull it back while reading static text. ARIA active-descendant changes are not
misreported as DOM focus changes. The runner's focused-editability gate also
descends open shadow roots; iframe focus and cross-frame traversal remain outside
this profile.

## Supported actions

- Intents: `next`, `previous`, `readCurrent`, `readFocused`, `activate`
- Browser keys: `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`
- Named task inputs: `typeText` and `replaceText`, through the runner's input gate

`activate` uses a guarded DOM `.click()` for supported exposed control roles and
`.focus()` for editable control roles. The receipt labels the method
`dom-click-untrusted` or `dom-focus`: this is an AXPress approximation, not a trusted
user gesture. DOM listeners, native HTML default actions, and application code
produce the resulting state. A custom checkbox lacking a click handler stays
unchanged; the backend never toggles ARIA attributes or repairs missing behavior.
Disabled objects can be read but cannot be activated. Clicking a control does not
artificially focus it.

Input requires a focused, enabled, writable HTML text input, textarea, or actual
contenteditable. Each character checks cancellation and confirms that the same
editable retains focus. If a page redirects focus during entry, remaining text is
not sent to the new target. Replacement uses actual select-all/backspace keys,
then character input. Password values are discarded before speech formatting or
semantic diagnostic emission. The runner's normal task-input redaction still
applies to other input values and echoed page content.

A typed semantic formatter produces deterministic English speech, such as
`Agree, checked, checkbox` or `Settings, dialog, modal`. Only the current or
explicitly requested focused object is spoken. Current-object semantic changes can
produce new output on observation. This is not a live-region announcement model. The same current-state summary after
activation is still a heuristic: native activation announcements can differ from
navigation announcements or produce no speech.
Each output includes `evidenceProvenance: 'simulation'` and the profile name;
sanitized semantic details can appear in diagnostic output metadata.

## Unsupported behavior

Group interaction, rotor navigation, quick navigation, VoiceOver verbosity and
preferences, speech queues, earcons, live-region timing, browser chrome, operating-
system dialogs, and cross-frame traversal are not simulated. Unsupported intents
and keys fail explicitly. The backend traverses only the attached Chromium main
document. Native VoiceOver checks on macOS are still required to establish native
behavior.

## Verification

`tests/mock-voiceover-browser.integration.test.ts` exercises the adapter against real Chromium,
including static text, independent focus, dynamic node changes, native and broken
custom widgets, dialog focus, real keyboard actions, secure-field privacy, input
focus changes, and cancellation. Set `RAWSTEP_TEST_BROWSER_PATH` to an approved
compatible Chromium executable when the normal Playwright browser is unavailable.
These tests prove the simulator's declared browser behavior, not VoiceOver parity.
