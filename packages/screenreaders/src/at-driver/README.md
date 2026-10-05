# AT Driver adapter

This is a native WebSocket client, not a replacement speech simulator. The runner-facing backend is structurally generic; this directory owns the AT Driver wire format and the explicitly selected VoiceOver/NVDA key profiles. Node's built-in WebSocket is used by default; `webSocketFactory` supplies an EventTarget-compatible fake for tests.

## Wire protocol and lifecycle

The [AT Driver draft](https://w3c.github.io/at-driver/) defines `session.new`, `interaction.userIntent` with `name: "pressKeys"`, and asynchronous `interaction.capturedOutput` events whose text is `params.data`. The draft and the inspected servers **do not define `session.end`**. `close()` ends the session by closing its WebSocket and cleans up pending commands/listeners. No unsupported session, reading, typing, or speech-completion methods are sent.

Each command receives a monotonically increasing numeric ID. Only a response with that exact ID settles its promise. Requests and connection establishment have separate timeouts. Uncorrelatable errors and malformed frames fail the connection; late/duplicate responses are retained as orphan-response evidence. A backend action timeout closes the connection, because that command could otherwise execute after the next policy step.

The transport's `command` event, journaled as `backend.command` in a run trace, records an attempted command **before physical dispatch**. Another subscriber can cancel after that event is logged but before the WebSocket send. A command event alone therefore proves neither dispatch nor a native effect. The separately recorded `response` event carries the server's ACK or error; speech and verification evidence remain separate from that acknowledgement.

`start`, `execute`, and `observe` accept an optional `{ signal }` operation option; the transport's `connect` and `request` do too. Cancellation rejects with the signal's reason and removes pending timers and abort listeners. Every text keypress checks the signal, and each request checks again after its command observers run, immediately before the physical WebSocket send. A trace observer must abort the operation's signal synchronously when recording fails; observer exceptions alone remain isolated from response correlation. Cancelling an action closes the session, since cancellation cannot retract a command already sent. `close()` remains available after cancellation.

Output is subscribed before `session.new` and before actions. It is preserved verbatim, including duplicate or empty text, in local receipt order, with local timestamps and the raw envelope. Unknown events and error frames are retained in the event stream. There is no speech normalization or synthesizing a DOM label as speech.

## Observation boundaries

An ACK only says the command was accepted/executed. It does not mean the screen reader has finished speaking. `observe()` waits for a configurable quiet interval (default 500 ms) and a maximum deadline (default 3 seconds, measured after `observe()` begins), resetting quiet time whenever output arrives. Empty silence is not proof of completion. Every observation says `speechComplete: "unknown"` and `attribution: "temporal-only"`.

An output's optional `windowId` records only which collection window was open when it arrived. Output events never receive a command ID. Speech arriving between windows is buffered, delivered in the next observation with its original timestamp, and left without a window ID. This preserves delayed/live-region speech without claiming that the next action caused it. A window can include multiple commands (for example, text entry); `commandIds` records attempted commands, including failed ones. `collectionStartedAt` identifies when quiet/deadline waiting began.

## Explicit platform profiles

- VoiceOver maps `next/previous` to Control+Option+Right/Left, `activate` to Control+Option+Space, `interact/stopInteracting` to Control+Option+Shift+Down/Up, and heading/form navigation to Apple's documented Control+Option+Command shortcuts
- NVDA maps `next/previous` to Down/Up **in browse mode**, `activate` to Enter, heading navigation to H/Shift+H, and next form field to F. These are not claimed to have identical granularity to VoiceOver. NVDA's toggle between browse/focus modes is deliberately not advertised as an idempotent `interact` or `stopInteracting`
- Only an enumerated keyboard subset is exposed, not arbitrary application shortcuts
- Text entry is sequential `pressKeys`, with the entire input validated before any keypress. Replace-text uses the profile's select-all modifier, Backspace, then those presses. No clipboard, DOM typing, or focus-repair fallback is used
- VoiceOver text currently supports printable ASCII on a US layout, including Bocoup's documented implementation-specific punctuation key names. The inspected PAC NVDA parser only supports ASCII letters/digits/spaces, shifted digits, semicolon/colon and equals/plus. Other characters (including a period on that NVDA implementation) fail explicitly before modifying the field. Unicode text is not claimed to work
- Default key bindings and a US keyboard layout are assumptions, not discovered settings. Versions are taken from negotiated capabilities; missing versions, locale, keyboard layout and native settings are explicitly `unknown`

The runner remains responsible for task input authorization and an editable-focus gate before calling text actions. The native browser and AT must run on the same desktop with the intended browser foregrounded. An editable DOM field alone cannot prove operating-system foreground focus.

## Inspected implementations and sources

- [Bocoup macOS server](https://github.com/bocoup/macos-at-driver-server): macOS 13+, installed automation voice, VoiceOver configured to use "Bocoup Automation Voice". Its current server default is `ws://localhost:4382/session`; use the URL of the server actually running
  - [Session response](https://github.com/bocoup/macos-at-driver-server/blob/main/lib/modules/session.js)
  - [Command server and `/session` path](https://github.com/bocoup/macos-at-driver-server/blob/main/lib/create-command-server.js)
  - [Port default](https://github.com/bocoup/macos-at-driver-server/blob/main/lib/commands/serve.js)
  - [Key parser](https://github.com/bocoup/macos-at-driver-server/blob/main/lib/helpers/parseCodePoints.js)
- [PAC NVDA automation server](https://github.com/Prime-Access-Consulting/nvda-at-automation): Windows, NVDA add-on, Capture Speech synthesizer and Go server. Current configuration uses `ws://localhost:3031/session`
  - [Server commands and route](https://github.com/Prime-Access-Consulting/nvda-at-automation/blob/main/Server/server/server.go)
  - [Key parser](https://github.com/Prime-Access-Consulting/nvda-at-automation/blob/main/NVDAPlugin/globalPlugins/CommandSocket/keyboard_input.py)
  - [Response types](https://github.com/Prime-Access-Consulting/nvda-at-automation/blob/main/Server/response/response.go) (currently serializes an empty interaction result as `null`; accepted by this adapter)
- [Apple navigation commands](https://support.apple.com/guide/voiceover/navigation-commands-cpvokys04/mac), [interaction commands](https://support.apple.com/guide/voiceover/interaction-commands-cpvokys07/mac), [search commands](https://support.apple.com/guide/voiceover/search-commands-cpvokys08/mac)
- [NVDA user guide](https://download.nvaccess.org/documentation/en/userGuide.html#BrowseMode)

Fake-transport tests verify protocol and collection semantics. They do not certify native VoiceOver/NVDA/browser behavior. Native smoke testing must be run on the corresponding OS; no native run was possible in the Linux development environment.
