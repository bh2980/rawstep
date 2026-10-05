# Simulated VoiceOver

`mockVoiceOver` is an explicit browser-backed simulator for experimenting with policies, runner integration, and ordinary page behavior without a Mac. It launches real Chromium, reads that browser's current accessibility tree, maintains a separate navigation cursor, and lets the page's own handlers change its state. It does not replay fixture answers or hard-code a task outcome.

**This is a small VoiceOver-inspired approximation, not Apple VoiceOver. Its generated output cannot establish native screen-reader behavior, speech fidelity, or accessibility conformance.** Real VoiceOver and NVDA testing still requires the native machine backend (`machine.backend` `voiceover` or `nvda`) and the appropriate host.

## Run the bundled browser fixture

Install Node.js 22+ and a Playwright-compatible Chromium as described in the [README](../README.md). No macOS or screen-reader service is required, and the machine backend `simulation` (the default in `rawstep.config.json`) needs no AT Driver. A model with the `decision` role must be configured in `rawstep.config.json` (via `npx rawstep ui`; see [SystemOne](./systemone.md) and [config](./config.md)), and a decision model needs its API key in `.env.local`.

```sh
npx rawstep run examples/v2/mock-task.json --mode screenreader --model MODEL
npx rawstep report .rawstep/runs/RUN_DIR
```

The [fixture](../fixtures/mock-voiceover-system.html) starts with a Save button. Its actual click handler changes the button name and status, then changes the document title after two activations. The independent verifier checks that title. The simulator does not know the goal or supply the completion state.

Task fixture paths resolve relative to the task file. Each run writes to a new directory under `.rawstep/runs/`. Set `machine.browserExecutablePath` to use an existing compatible Chromium and `machine.headless` to false to show it. The simulation backend does not use the `atEndpoint`.

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
  policy: new ScriptedPolicy([
    { action: { kind: 'intent', intent: 'activate' } },
    { action: { kind: 'intent', intent: 'activate' } },
    { stop: 'success' },
  ]),
});
```

Your page must supply the actions and completion state used by its task; the snippet's title rule is only an example. `runMockVoiceOverTask` and `MockVoiceOverRunOptions` are also available from the root export. The `rawstep/mock-voiceover` module additionally exports `MockVoiceOverBackend`, `MOCK_VOICEOVER_PROFILE`, `MOCK_VOICEOVER_LIMITATIONS`, and the typed `formatSimulatedSpeech` formatter. `MOCK_VOICEOVER_WARNING` describes the approximation at startup.

The wrapper accepts normal runner options including `policy`, `allowedActions`, budgets from the task, `signal`, `diagnosticScreenshots`, and `browserExecutablePath` (these library options are not exposed as CLI flags); it supplies the simulator backend and defaults `headless` to `true`. A `warn` callback can redirect the startup warning. Advanced injected browser sessions must provide a real compatible Chromium page. Policies receive the same model-neutral screen-reader-shaped observation contract, with `provenance: 'simulation'`, rather than a screenshot or privileged DOM selector. A policy can be scripted, local, remote, or model-backed; no provider is selected by Rawstep.

## Supported profile

The current `english-dom-navigation-evidence-v2` profile uses Chromium's CDP `Accessibility.getFullAXTree` for the main document. It visits a flattened subset of exposed objects, filters ignored and structural objects, and suppresses repeated text below named controls. It uses Chromium names and states rather than claiming to reproduce Safari's or macOS's accessibility tree.

| Feature | Implemented behavior | Boundary |
| --- | --- | --- |
| `next`, `previous` | Move the simulated cursor through exposed objects, including non-focusable text; announce the boundary without wrapping | No native grouping, rotor, heading shortcuts, or Quick Nav semantics |
| Cursor and focus | Cursor movement alone does not set DOM focus; a changed actual focus can move the cursor | Does not reproduce all configurable VoiceOver cursor-tracking behavior |
| `readCurrent` | Describe the object at the simulated cursor using deterministic English wording | No speech synthesis or native utterance capture |
| `readFocused` | Describe the exposed object with actual keyboard focus | Cursor and focus may refer to different objects |
| `activate` | Guarded DOM `.click()` on supported controls, or `.focus()` on an editable field | AXPress approximation; clicks are untrusted and may differ from native activation |
| `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape` | Deliver actual browser keyboard actions | Native browser or page behavior determines the result |
| `typeText`, `replaceText` | Enter a named task input only into an actually focused editable field; verify focus while typing | Merely browsing to a field is insufficient; disabled and read-only fields reject input |
| Names and state | Read exposed names, values, roles, heading levels, checked/pressed/expanded/selected, disabled, read-only, required, multiline, and modal states | A small typed formatter, not VoiceOver's context-dependent wording |
| Dynamic pages | Refresh browser semantics between operations; keep stable object identity where available | No reconstruction of missing ARIA or missing widget handlers |
| Password fields | Discard password values before formatting or emitting semantic diagnostics | Other page text can still contain private information |

Disabled controls remain available for cursor reading when exposed by Chromium, but activation and text entry reject them. An ARIA role alone does not implement a widget: missing click or keyboard handlers remain missing. DOM changes and navigation come from the actual page and remain subject to runner navigation and action restrictions.

Out of scope: native macOS/Safari AX parity, group interaction, rotor, Quick Nav, live-region announcement scheduling, earcons, speech queues and interruption, native pronunciation and verbosity settings, cross-frame navigation, browser chrome, and operating-system dialogs. An observation refresh is not a native speech-completion signal. The browser and its version can change the accessible objects or their names, even though the formatter is deterministic for the same semantic input.

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
