# Native Orca adapter (experimental)

`OrcaBackend` connects the common screen-reader runner to a real local Orca process.
It is a Linux-native adapter using a private NDJSON pipe. It is **not a W3C AT
Driver implementation**, and is not the browser-backed VoiceOver simulator.

## What counts as evidence

The Python runtime runs Orca itself. It intercepts the real
`speechd.SSIPClient.speak`, `char`, and `key` calls used by Orca, calls the original
method unchanged, and forwards text only after that submission succeeds. For
`speak`, it decodes Orca's SSML transport. It never reads a DOM/AX tree and invents
an utterance from it. The runtime restores its hooks during cleanup.

Metadata identifies `backend: "orca-native"`, `profile: "orca"`, and capture as:

```json
{
  "source": "orca-speech",
  "kind": "speech-pipeline-text",
  "stage": "speech-dispatcher-submission",
  "audioVerified": false
}
```

These are genuine Orca speech-pipeline submissions, **not recorded audio**. A
successful startup checks the native stack and capture hook; it does not prove
that the task page produced speech, that audio was heard, or that a website is
accessible. A transport fixture passing tests is not native evidence.

## Requirements and scope

- Linux with **Orca 48.x**. Other versions fail closed until their internal
  integration is validated
- A real X11 display and existing session D-Bus shared by the browser and bridge
- AT-SPI, Python GI bindings, GTK/GDK, X11/XTest, and Python Speech Dispatcher
- An **already-running Speech Dispatcher**. The bridge disables automatic speech
  server spawning and does not create or install desktop services
- A visible browser and its exact X11 target window ID. The configured window, or
  a descendant, must have native X11 input focus at startup and before each chord
- A dedicated test desktop with no unrelated windows, notifications, or private
  content. Focus checks constrain keyboard input; they are not a proof that every
  speech event was caused by the page
- Default Orca desktop bindings and a US keyboard layout for these mappings

The bridge requires `DISPLAY`, `DBUS_SESSION_BUS_ADDRESS`, and either the adapter's
`targetWindowId` option or `RAWSTEP_ORCA_TARGET_WINDOW_ID`. An environment variable
claiming a display is dedicated cannot replace exact target binding. The bridge
does not focus an arbitrary current browser, and does not use browser CDP to
simulate screen-reader keys.

The bridge additionally checks the target's browser WM_CLASS and local process
executable. Metadata retains the verified window ID, class, and process ID under
`target`. These checks identify a supported browser window, not its association
with a Playwright connection: the trusted caller must pair it with the same
browser session returned by `browserSessionFactory`.

The default interpreter is `/usr/bin/python3`, to use the distro's GI/Orca modules.
An explicit `bridgeCommand` may select another compatible interpreter. It is
spawned directly, without a shell. Review a custom executable before using it.

Read-only prerequisites check, from the package root:

```sh
/usr/bin/python3 packages/screenreaders/native/orca_doctor.py
```

This prints machine-readable checks and returns a nonzero status when required
prerequisites are absent. Even a successful diagnostic says
`prerequisites-present-not-live-verified`; it is not a real speech test. A sandbox
denying X11 or D-Bus access is a blocker, not permission to bypass the restriction.

## Programmatic use

```ts
import { OrcaBackend, runTask } from 'rawstep';

// Set only after verifying this is the X11 window of this browser session.
existingBrowserSession.nativeTargetWindowId = browserWindowId;
const backend = new OrcaBackend({
  targetWindowId: browserWindowId, // Existing, verified X11 ID, integer > 1
  quietMs: 500,
  maxWaitMs: 3000,
});

const trace = await runTask(task, {
  backend,
  policy,
  outDir,
  headless: false,
  // The target browser must already exist, be on the shared X11 display,
  // have native focus, and be the browser associated with this task.
  browserSessionFactory: async () => existingBrowserSession,
});
```

The common runner starts a backend before it creates its default browser. Since
Orca requires an exact pre-existing focused target, callers must precreate and
pair the browser via `browserSessionFactory`, or use a higher-level runner that
explicitly performs that pairing. Merely providing an ID for an unrelated
existing browser is not sufficient. The common runner closes the returned browser
session at the end of the run.

The paired session must expose `nativeTargetWindowId` equal to the bridge's
verified target. The common runner rejects missing or mismatched IDs before policy
actions; this is a trusted caller assertion, not automatic Playwright-to-X11
discovery.

`OrcaBackend` also supports `startupTimeoutMs` (default 15000), `commandTimeoutMs`
(5000), `closeTimeoutMs` (1000), and a `bridgeCommand` executable/argument tuple.
These are positive finite timer intervals. A backend instance is single-use;
create a fresh instance for a new session.

## Actions and observations

- `next` / `previous`: Down / Up, caret or line movement in browse mode
- `activate`: Return
- `heading.next` / `heading.previous`: H / Shift+H
- `form.next`: F
- Keys: Tab, Shift+Tab, Enter, Shift+Enter, Escape, Space, Backspace, Delete,
  arrows, Home, End, PageUp, PageDown, and Mod+A (Control+A)
- Named input text: printable ASCII, injected using X11 key events
- Replacement: validates the **entire** string before Control+A, Backspace, then
  text. Unsupported characters cause no partial destructive replacement

There is no `interact` / `stopInteracting` mapping: Orca's focus-mode toggle is not
an idempotent equivalent of VoiceOver interaction. Structural navigation requires
browse mode; form navigation may switch to focus mode. See the official
[structural navigation commands](https://gnome.pages.gitlab.gnome.org/orca/help/commands_structural_navigation.html)
and [form navigation guidance](https://help.gnome.org/orca/howto_forms.html).

The adapter opens a receipt-time collection window before startup/action dispatch,
so speech arriving before a command ACK is retained. `observe()` waits for a quiet
interval after the ACK and latest output, bounded by `maxWaitMs` measured from the
start of collection. `speechComplete` is always `"unknown"`, and attribution is
always `"temporal-only"`. A quiet interval or native key ACK does not establish
speech completion or causal attribution. Late output can appear in a later window.

## Lifecycle and privacy

Requests are serialized. Concurrent execution/observation is rejected. A cancelled
or failed physical command closes the session; remaining keys are never replayed.
Keys already dispatched cannot be undone. Startup failure and observation
cancellation also close the owned process.

Shutdown first sends `session.stop`, then ends stdin. If the process does not exit
within the configured bound, the adapter terminates its newly created process
group, escalating to SIGKILL after a further bound. It does not find or kill an
unrelated Orca, Speech Dispatcher, or desktop process.

The Python bridge uses temporary Orca preferences/cache and in-memory GSettings.
It restores the session accessibility state on normal cleanup. Forced process
termination cannot guarantee every native cleanup handler ran, so use a disposable
test session and tear down its desktop after a failed run.

Native stderr is drained and discarded: toolkit diagnostics can include unrelated
desktop content or secrets. The adapter never records its inherited environment,
process arguments, or stderr. Raw speech and key attempts are still sensitive.
The common runner's named-input privacy taint redacts command payloads, speech
echoes, and later evidence after text entry unless the caller explicitly opts in
to sensitive input values. Direct backend subscribers receive raw live events
and must apply their own privacy controls. Do not point the test at a personal
desktop or send its trace to a remote analyzer without reviewing it.

## Local protocol v1

One UTF-8 JSON object per newline. stdout is reserved for protocol; the adapter
rejects malformed, oversized, unsupported, or mismatched response frames rather
than silently treating them as speech.

Request:

```json
{"id":1,"method":"session.start","params":{"protocol":"rawstep-orca-native-v1","sessionId":"generated-uuid","targetWindowId":12345}}
```

Successful startup:

```json
{"type":"response","id":1,"result":{"protocol":"rawstep-orca-native-v1","sessionId":"generated-uuid","atName":"Orca","atVersion":"48.6","platformName":"linux","speechSource":"orca-speech","captureStage":"speech-dispatcher-submission","audioVerified":false,"targetWindowId":12345,"targetClass":"Chromium","targetProcessId":4321}}
```

Input and ACK:

```json
{"id":2,"method":"input.pressKeys","params":{"sessionId":"generated-uuid","keys":["Shift_L","Tab"]}}
{"type":"response","id":2,"result":{}}
```

Speech event, independent of an ACK:

```json
{"type":"speech","sessionId":"generated-uuid","source":"orca-speech","text":"Next button","captureStage":"speech-dispatcher-submission","audioVerified":false}
```

Failure and shutdown:

```json
{"type":"response","id":2,"error":{"code":"TARGET_NOT_FOCUSED","message":"The configured browser window does not have X11 input focus."}}
{"id":3,"method":"session.stop","params":{"sessionId":"generated-uuid"}}
{"type":"response","id":3,"result":{}}
```

Session IDs isolate runs. Speech from another session is ignored without retaining
its payload. IDs correlate command responses, not speech. Event sequence numbers
and timestamps are assigned by the Node adapter at receipt time. Bounded buffers
fail the run explicitly on overflow rather than silently truncating evidence.

## Verification status

`tests/orca.test.ts` exercises profile mappings, NDJSON framing, startup and
speech provenance, pre/post-ACK collection, session filtering, concurrency,
cancellation, cleanup, and runner redaction using deterministic child processes.
The full-runner journal-failure regression makes trace persistence fail at the
native command event and verifies that no input request reaches the child, no
later policy action runs, and the trace records a persistence failure. Late ACKs,
delayed speech after cancellation, and target-focus-loss errors cannot resume a
closed session or dispatch the remaining text.
It also starts the actual Python bridge without DISPLAY and verifies a closed
failure with no native-success metadata or speech. Python tests exercise native
protocol validation and speech hooks in isolation.

These checks do not replace a live test on a supported Linux desktop. A native
release claim requires an actual Orca-generated task utterance, real X11 keyboard
dispatch to the paired browser, and independent task verification on that host.
