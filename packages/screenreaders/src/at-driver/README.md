# AT Driver adapter

This page is for people who change how Rawstep drives a real VoiceOver or NVDA, or who want to know what a native run can and cannot tell them. It answers: which keys each action presses, how the rotor routines work, and what has not been confirmed on a real screen reader. To set up a server and run on one, see [Screen readers](../../../../docs/screen-readers.md).

The adapter is a native WebSocket client for the [AT Driver draft](https://w3c.github.io/at-driver/). It does not simulate speech: it presses keys through a server and keeps whatever the screen reader says. The runner sees it as a generic backend; this directory owns the wire format and the two key profiles, VoiceOver and NVDA. The backend reports `evidenceProvenance: 'native'`.

| File | Owns |
|---|---|
| `transport.ts` | The WebSocket client: command IDs, timeouts, correlating responses, events |
| `profiles.ts` | The VoiceOver and NVDA key maps, text entry, the rotor routines |
| `index.ts` | `AtDriverBackend`: runs actions, collects speech into observations |

Node's built-in WebSocket is used by default. `webSocketFactory` supplies a fake for tests.

## Wire protocol and lifecycle

The draft defines `session.new`, `interaction.userIntent` with `name: "pressKeys"`, and asynchronous `interaction.capturedOutput` events whose text is `params.data`. These are the only methods Rawstep sends. The draft and the servers inspected below do not define `session.end`, so `close()` ends the session by closing the socket.

- Each command gets a rising numeric ID. Only a response with that exact ID settles it. Late or duplicate responses are kept as `orphanResponse` events and never settle another command.
- Timeouts: connect 10 s, each command 10 s, close 1 s (all options of `AtDriverClientOptions`).
- A malformed frame, an error frame with no ID, or a closed socket fails the connection. A backend action that times out, fails to send or gets a protocol error closes the session, because that key press could still take effect after the next step.
- The transport emits a `command` event before the physical send (`backend.command` in a run trace). Another subscriber can cancel between the two, so a command event alone proves neither that the key was sent nor that anything happened. The separate `response` event carries the server's acknowledgement or error.
- `start`, `execute` and `observe` take `{ signal }`. Cancelling rejects with the signal's reason, removes pending timers and closes the session, because a key press already sent cannot be taken back. A trace observer must abort the signal synchronously if recording fails.
- `session.new` asks for `atName` VoiceOver or NVDA. The server must answer with the same name or the start fails with `capability mismatch`. Versions come only from the negotiated capabilities. Platform version, locale, keyboard layout and screen reader settings are recorded as `unknown`.

## Speech and observation

Output is subscribed before `session.new` and before every action, and kept exactly as received: duplicates and empty text included, in local receipt order, with a local timestamp and the raw envelope. Nothing is normalized, and no DOM label is ever turned into speech.

A server acknowledgement says the key press was accepted. It does not say the screen reader has finished speaking. So `observe()` waits for a quiet interval (default 500 ms with no new output, `quietMs`) up to a maximum (default 3 s after `observe()` begins, `maxWaitMs`), and restarts the quiet time whenever output arrives. Silence is not proof that speech is complete. Every observation says `speechComplete: "unknown"` and `attribution: "temporal-only"`.

An output's `windowId` records only which collection window was open when it arrived, never which command caused it. Speech that arrives between windows is kept for the next observation with its original time and no window ID. That keeps late speech and live-region speech without claiming the next action caused it.

## Before a run starts

`AtDriverBackend.preflight` stops the run early, unless a paired browser session factory is supplied, when:

- the host does not match the profile: macOS for VoiceOver, Windows for NVDA;
- the endpoint is not a loopback address (a remote server needs a paired browser session);
- the run is headless. A native run needs a visible browser, and the browser must be in the foreground on the same desktop as the screen reader. A page's focused field cannot prove the operating system's foreground focus.

The usual server addresses are `ws://localhost:4382/session` (VoiceOver, [Bocoup macOS server](https://github.com/bocoup/macos-at-driver-server)) and `ws://localhost:3031/session` (NVDA, [PAC NVDA server](https://github.com/Prime-Access-Consulting/nvda-at-automation)). They are the defaults when `machine.atEndpoints.<voiceover|nvda>` is empty (`AT_DRIVER_DEFAULTS` in `@rawstep/project/config`). `@rawstep/project/atdriver` starts a server for a run when none answers and the `RAWSTEP_AT_DRIVER_COMMAND` command is set (waits up to 30 s for the port, stops what it started), and `doctor` opens a session and negotiates the profile (5 s limit).

## Key mapping

Rawstep sends actions by meaning (an intent, a named key, text). A profile turns each into key presses. The screen reader modifier for VoiceOver is Control+Option (written VO below).

| Action | VoiceOver | NVDA |
|---|---|---|
| `next` | VO+Right | Down (browse mode: next line) |
| `previous` | VO+Left | Up (browse mode: previous line) |
| `activate` | VO+Space | Enter |
| `interact` | VO+Shift+Down | not offered |
| `stopInteracting` | VO+Shift+Up | not offered |
| `heading.next`, `heading.previous` | VO+Command+H, VO+Command+Shift+H | H, Shift+H |
| `form.next`, `form.previous` | VO+Command+J, VO+Command+Shift+J | F, Shift+F |
| `link.next`, `link.previous` | VO+Command+L, VO+Command+Shift+L | K, Shift+K |
| `headings.list` | rotor routine, below | not offered |
| `links.list` | rotor routine, below | not offered |
| `formControls.rotor` | rotor routine, below | not offered |

`readCurrent` and `readFocused` exist only in the simulation. An intent a profile does not list fails with `unsupported action` before any key is pressed.

Named keys are the same for both: `Tab`, `Enter`, `Escape`, `Space`, `Backspace`, `Delete`, the four arrows, `Home`, `End`, `PageUp`, `PageDown`, `Shift+Tab`, `Shift+Enter` and `Mod+A` (Command+A on VoiceOver, Control+A on NVDA). Any other key is refused. Keys are sent as WebDriver key code points (`AT_DRIVER_KEYS`).

Differences to keep in mind:

- NVDA's `next` and `previous` move by line in browse mode. They are not claimed to have the same granularity as VoiceOver's object-by-object moves.
- NVDA's switch between browse mode and focus mode is not offered as `interact` or `stopInteracting`, because pressing the toggle is not an idempotent "enter" or "leave".
- NVDA's `F` goes to the next form field. VoiceOver's `form.next` is the next form control. They are the nearest equivalents, not the same set.

### Text entry

`typeText` presses one key per character. The whole text is checked before the first press, and a character with no mapping fails the action without touching the field. `replaceText` first presses select-all (`Mod+A`) and Backspace, then types. There is no clipboard, no DOM typing and no focus repair. The runner decides whether a named input may be typed and checks that an editable field has focus before calling these.

| Characters | VoiceOver | NVDA |
|---|---|---|
| `a-z`, `0-9`, space | yes | yes |
| `A-Z` | Shift+letter | Shift+letter |
| `! @ # $ % ^ & * ( )` | Shift+digit | Shift+digit |
| `; :` and `= +` | yes | yes |
| Other ASCII punctuation: `-` `[` `]` `'` `\` `,` `/` `.` and backtick, and their shifted forms `_` `{` `}` `"` `\|` `<` `>` `?` `~` | yes, using the Bocoup server's key names | no |
| anything else, including non-ASCII | no | no |

So a period fails on NVDA with this server, and Unicode text is not supported on either. A US keyboard layout is assumed.

## Rotor routines

VoiceOver's rotor (VO+U) is read by listening, because Rawstep only gets speech back. A routine presses a key, waits for the speech to go quiet, reads the last thing spoken, and decides the next key from it. Everything spoken along the way stays in the observation, so the planner hears what a user would hear. NVDA has no routines.

**Finding a list.** Press VO+U to open the rotor and listen. While the last thing spoken does not name the wanted list, press Right and listen again, up to 12 times. The list name is matched against English or Korean speech:

| Routine | Matches | Notes |
|---|---|---|
| `headings.list` | "headings" anywhere, or "머리말" | |
| `links.list` | "links" or "링크" at the start of the speech | Anchored, so a heading called "Quick links" does not match |
| `formControls.rotor` | "form controls", "폼 컨트롤" or "양식 컨트롤" anywhere | |

**`headings.list` and `links.list` read the list and close it.**

1. Find the list as above. If it is not found, skip to step 3.
2. Press Down and listen, item after item (up to 100 headings or 300 links). Stop when the speech goes silent. At the end of a list the rotor either stays on the last item or wraps to the first, and two items can share a name, so a repeat alone does not end the list. When an item repeats the last one, or repeats the first, press once more. If that press also repeats (the last item again, or the second item after the first) or goes silent, the list is done. Otherwise both items count and reading continues.
3. Always press Escape and wait for the speech to settle, even after an error.

The action counts as one step in a run. The cursor on the page does not move.

**`formControls.rotor` opens the list and leaves it open.**

1. Find the list as above. If it is not found, press Escape to close the rotor and stop.
2. While it is open, `next` presses Down, `previous` presses Up, and `activate` presses Return, which goes to the item without pressing it and closes the rotor. The key `Escape` only closes it.
3. Any other action closes the rotor first (Escape, then wait for quiet) and then runs.

If an action fails part way, the rotor is closed before the next action.

## What is not confirmed on a real screen reader

The fake-transport tests in `tests/at-driver.test.ts` and `tests/at-driver-workflow.test.ts` check the protocol, cancellation and collection rules against a fake server. They do not check how VoiceOver, NVDA or a browser behave. No recorded live check is kept in this repository. Things to treat as unconfirmed until you have seen them on your machine:

- **The three rotor routines have not been checked on a live VoiceOver** (as the profile's own assumptions say). That includes: that VO+U opens the rotor on the list you expect, that Right steps through the lists in the order the routine relies on, what the end of a list sounds like (stays on the last item or wraps), and that Return in the rotor goes to the item without pressing it.
- **The Korean list names** ("머리말", "링크", "폼 컨트롤", "양식 컨트롤") and **where the form controls list starts** are guesses from the routine's design.
- **Default key bindings and a US keyboard layout** are assumed. Neither is read from the machine; the run records layout and settings as `unknown`. A changed VoiceOver modifier, Quick Nav or a different layout will change what the keys do.
- **NVDA keys assume browse mode.** The adapter does not detect or switch the mode.
- **Which screen reader and browser versions** the key map suits is not established. Versions are only what the server reports.
- **Speech end** is never known. A short quiet interval can end an observation before late speech arrives, and a long one makes a run slower.
- **Text** is limited to the characters above, one key press each. How the screen reader announces typed characters (typing echo) is whatever it is set to.
- **Command acknowledgement is not an effect.** A key press can be accepted and still do nothing, for example if the browser is not frontmost.

A hint from a native run points at a place worth a look. It does not establish how a real user would fare.

## Sources

- [Bocoup macOS server](https://github.com/bocoup/macos-at-driver-server): macOS 13 or later, the "Bocoup Automation Voice" installed and selected in VoiceOver. Its server default is `ws://localhost:4382/session`; use the address of the server you actually run.
  - [Session response](https://github.com/bocoup/macos-at-driver-server/blob/main/lib/modules/session.js)
  - [Command server and `/session` path](https://github.com/bocoup/macos-at-driver-server/blob/main/lib/create-command-server.js)
  - [Port default](https://github.com/bocoup/macos-at-driver-server/blob/main/lib/commands/serve.js)
  - [Key parser](https://github.com/bocoup/macos-at-driver-server/blob/main/lib/helpers/parseCodePoints.js)
- [PAC NVDA automation server](https://github.com/Prime-Access-Consulting/nvda-at-automation): Windows, an NVDA add-on with the Capture Speech synthesizer, and a Go server. Default `ws://localhost:3031/session`.
  - [Server commands and route](https://github.com/Prime-Access-Consulting/nvda-at-automation/blob/main/Server/server/server.go)
  - [Key parser](https://github.com/Prime-Access-Consulting/nvda-at-automation/blob/main/NVDAPlugin/globalPlugins/CommandSocket/keyboard_input.py)
  - [Response types](https://github.com/Prime-Access-Consulting/nvda-at-automation/blob/main/Server/response/response.go): an empty interaction result is serialized as `null`, which the adapter accepts (the Bocoup server sends `{}`).
- Apple: [navigation commands](https://support.apple.com/guide/voiceover/navigation-commands-cpvokys04/mac), [interaction commands](https://support.apple.com/guide/voiceover/interaction-commands-cpvokys07/mac), [search commands](https://support.apple.com/guide/voiceover/search-commands-cpvokys08/mac).
- [NVDA user guide: browse mode](https://download.nvaccess.org/documentation/en/userGuide.html#BrowseMode).
