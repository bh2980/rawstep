# Screen readers

This page is for people choosing which screen reader a run goes through, or setting up a real VoiceOver or NVDA. It covers the simulation and the native screen readers, how to connect an AT Driver server, which actions each one supports, and what each cannot do.

For why a simulated run is not native screen reader evidence, see [Concepts](./concepts.md).

## The three choices

A run profile's `screenReader` picks one:

| `screenReader` | What it is | Where it runs |
| --- | --- | --- |
| `simulation` (default) | Rawstep's simulated VoiceOver. It reads Chromium's accessibility tree and speaks English VoiceOver-like wording. No screen reader is installed or heard. | Anywhere Chromium runs. Headless unless `machine.headless` is `false`. |
| `voiceover` | The real VoiceOver, driven through an AT Driver server. | macOS only. |
| `nvda` | The real NVDA, driven through an AT Driver server. | Windows only. |

In the dashboard this is the profile's 어디서 듣나요 (Where does the user listen) section, field 보조기술 (Assistive technology): 모의 VoiceOver (Simulated VoiceOver), VoiceOver or NVDA.

Every run says which one it used. The CLI prints `screen reader simulation` (or `voiceover`, `nvda`) with the run's conditions. In the trace, each speech observation carries `provenance: "simulation"` or `"native"`. The dashboard marks simulated runs 모의 VoiceOver 실행 (실제 네이티브 발화 아님) (Simulated VoiceOver run, not native speech).

In every case the completion check (`verify`) reads the page in the browser. That is the oracle, used only to measure; the planner hears only the speech.

## The simulation

The simulation needs no setup. It walks a flat cursor over Chromium's accessibility tree and formats each stop as VoiceOver would say it, for example `Add to cart, button`. Some wording rules are matched to recorded real VoiceOver output; the rest are approximations. It is a composite profile, not any one macOS or Safari version.

How it decides the stops, the speech format, the recorded VoiceOver evidence it was checked against and its full list of assumptions are in the [simulator README](../packages/screenreaders/src/mock-voiceover/README.md). Licenses for the bundled evidence are in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).

## Native VoiceOver and NVDA

A native run opens the page in a visible Chromium or Chrome window (never headless), and Rawstep sends each action to an [AT Driver](https://w3c.github.io/at-driver/) server as key presses. The server presses the keys for the real screen reader and sends back what it said. Rawstep, the browser, the AT Driver server and the screen reader all run on the same computer.

Rawstep uses these servers:

| Screen reader | Server | Default address |
| --- | --- | --- |
| VoiceOver | [bocoup/macos-at-driver-server](https://github.com/bocoup/macos-at-driver-server) | `ws://localhost:4382/session` |
| NVDA | [Prime-Access-Consulting/nvda-at-automation](https://github.com/Prime-Access-Consulting/nvda-at-automation) | `ws://localhost:3031/session` |

Install and configure the server with its own instructions. Rawstep does not install it, does not turn the screen reader on and does not grant OS permissions. Those are yours to set up.

### Set up a native run

1. Install the AT Driver server for your screen reader and turn the screen reader on.
2. Set the run profile's `screenReader` to `voiceover` or `nvda`.
3. If the server listens somewhere other than its default address, set `machine.atEndpoints` in `rawstep.config.json`. Empty means the default address:

   ```json
   "machine": {
     "atEndpoints": { "voiceover": "ws://localhost:4382/session", "nvda": "" }
   }
   ```

   The address must be `ws://` or `wss://` on this computer (`localhost`, `127.0.0.1` or `[::1]`), with no user name or password. In the dashboard: 설정 (Settings) › 이 컴퓨터 (This computer) › 스크린리더 드라이버 (AT Driver) (Screen reader driver).
4. Optionally, let Rawstep start the server for you (next section).
5. Check the connection:

   ```sh
   npx rawstep doctor
   ```

6. Run a task with that profile:

   ```sh
   npx rawstep run <task> --profile <profile>
   ```

### Let Rawstep start the server

Without a start command, the server must already be running when a run starts. Otherwise the run fails with "No AT Driver server answers at … Start it yourself, or set the command Rawstep should start it with."

To have Rawstep start it, put the shell command in `.env.local` in the project folder (or in the process environment):

```sh
RAWSTEP_AT_DRIVER_COMMAND="<the command that starts your AT Driver server>"
```

The dashboard field AT Driver 서버 실행 명령 (AT Driver server start command), under 설정 (Settings) › 이 컴퓨터 (This computer), writes the same value. The command is never stored in `rawstep.config.json`, because it runs a program on this computer.

Before a native run, Rawstep checks whether anything accepts connections at the address. If something does, Rawstep uses it as it is. If not, it runs the command, waits up to 30 seconds for the address to answer, and stops the command when the run ends. If the command exits first or nothing answers in time, the run fails and the message includes the command's last output.

CLI runs start the command in the folder you ran `rawstep` from, while the dashboard's 연결 확인 (Check connection) button starts it in the project folder. Use absolute paths in the command so both work.

### What doctor checks

`npx rawstep doctor` checks each native screen reader that any profile uses. It opens an AT Driver session at the address, with a 5-second limit, and closes it again:

```text
ok    Screen reader: voiceover AT Driver answered at ws://localhost:4382/session. This checks the protocol connection only; verify real speech on the target host
```

If no profile uses a native screen reader:

```text
skip  Screen reader: only the simulation is configured; no native screen reader to check
```

A failure prints `FAIL  Screen reader: <backend> AT Driver at <address>: <error>. Start the AT Driver server and the screen reader, then run doctor again`, and doctor exits with code 1. Doctor does not start the server with `RAWSTEP_AT_DRIVER_COMMAND`; start it first. The dashboard's 연결 확인 (Check connection) button does use the command.

A passing check means only that the server answered and agreed to drive the requested screen reader. It does not prove that speech comes through.

### Before a native run starts, Rawstep refuses when

- `voiceover` is not on macOS ("Run VoiceOver on macOS.") or `nvda` is not on Windows ("Run NVDA on Windows.");
- the AT Driver address is not a loopback `ws://` or `wss://` address;
- the profile allows an action the screen reader does not support (below): "This assistive technology does not support: …";
- the server answers but does not agree to drive the requested screen reader ("Server did not negotiate the requested VoiceOver profile").

## Supported actions

A run profile lists the actions the simulated user may take. Each screen reader supports a different set. If a profile allows an action the chosen screen reader lacks, the run is refused before it starts. The dashboard shows support per screen reader next to each action.

The sources are `capabilities` in [`mock-voiceover/backend.ts`](../packages/screenreaders/src/mock-voiceover/backend.ts) and `getAtDriverProfile` in [`at-driver/profiles.ts`](../packages/screenreaders/src/at-driver/profiles.ts). Which keys each intent presses is in the [AT Driver README](../packages/screenreaders/src/at-driver/README.md).

### Screen reader actions (intents)

| Intent | What the user does | simulation | voiceover | nvda |
| --- | --- | :-: | :-: | :-: |
| `next`, `previous` | Move to the next or previous item | yes | yes | yes (by browse-mode line) |
| `activate` | Activate the current item | yes | yes | yes |
| `heading.next`, `heading.previous` | Jump to the next or previous heading | yes | yes | yes |
| `form.next`, `form.previous` | Jump to the next or previous form control | yes | yes | yes |
| `link.next`, `link.previous` | Jump to the next or previous link | yes | yes | yes |
| `headings.list` | List the page's headings (rotor) | yes | yes | no |
| `links.list` | List the page's links (rotor) | yes | yes | no |
| `formControls.rotor` | Open the rotor's form controls list, then move through it with `next`/`previous` and go to an item with `activate` | yes | yes | no |
| `readCurrent` | Read the current item again | yes | no | no |
| `readFocused` | Read the focused element | yes | no | no |
| `interact`, `stopInteracting` | Interact with an item, stop interacting | no | yes | no |

### Keys

| Key | simulation | voiceover | nvda |
| --- | :-: | :-: | :-: |
| `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape` | yes | yes | yes |
| `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End` | yes | yes | yes |
| `Backspace`, `Delete`, `PageUp`, `PageDown`, `Shift+Enter`, `Mod+A` | no | yes | yes |

### Typing inputs

| Action | simulation | voiceover | nvda |
| --- | :-: | :-: | :-: |
| Type an input into the focused field (`typeText`) | yes | yes, printable ASCII only | yes, ASCII letters, digits, space, `!@#$%^&*()`, `;`, `:`, `=`, `+` only |
| Clear the field and type (`replaceText`) | yes | yes, same limits | yes, same limits |

On a native screen reader, text with any other character (accented letters, Korean, emoji, and on NVDA most punctuation) fails that action before any key is pressed.

### What this means for the ways of finding things

The dashboard's 찾는 방법 (Way of finding things) presets combine `next`, `previous` and `activate` with one way of jumping. 한 칸씩 (Item by item) runs on all three. 제목으로 (By headings), 폼 컨트롤로 (By form controls) and 링크로 (By links) each include a rotor list intent, so they run on the simulation and VoiceOver but are refused on NVDA. For NVDA, use a custom action set without `headings.list`, `links.list` and `formControls.rotor`.

## Known limits

### Simulation

- It is not native VoiceOver. No native speech is captured or checked. A simulated run is not native screen reader evidence and not an accessibility conformance result.
- The wording is English only. Wording other than the rules matched to recorded VoiceOver output, and most state-change announcements, are approximations.
- Pressing uses a guarded DOM click (or focus, for a text field). These clicks are untrusted events, and the simulation does not repair missing widget behavior.
- The cursor is independent of keyboard focus. It moves to a focused element only when focus actually changes.
- Live regions: new text is spoken once, after the speech of the action that caused it, without its role and without timing or interruption. Empty live regions are not stops.
- The rotor's form controls list cannot be filtered by typing, so finding an item can take more moves than in VoiceOver.
- `headings.list` and `links.list` read the whole list in one announcement; the cursor does not move.
- A new page is announced by its title only. Real VoiceOver adds its own page-load wording.
- Only the main document is read: no iframes, no browser window controls, no OS dialogs.
- Arrow, Home and End keys go to the page as key presses, as in VoiceOver with Quick Nav off.

The full list, with the evidence behind each rule, is in the [simulator README](../packages/screenreaders/src/mock-voiceover/README.md).

### Native VoiceOver and NVDA

- Speech is matched to an action by time only. After each action Rawstep collects whatever the server reports until nothing has been said for 500 ms, or for at most 3 seconds. Speech that comes late is counted with the next action. There is no signal that the screen reader finished speaking.
- Rawstep assumes a US keyboard layout and the screen reader's default key bindings; VoiceOver's modifier is assumed to be Control+Option. The actual layout, OS version, locale and screen reader settings are recorded as `unknown`.
- On NVDA, `next` and `previous` move by line in browse mode, not by object as in VoiceOver. Navigation needs NVDA to be in browse mode. There is no `interact`, and no rotor lists.
- VoiceOver's `headings.list`, `links.list` and `formControls.rotor` find the list by listening for its name in English or Korean speech. These routines are not yet checked against a live VoiceOver.
- Typing is limited to the characters in the table above.
- The page opens in Chromium or Chrome, not Safari.
- Rawstep brings the page to the front when a run starts. It does not check that it stays in front during the run.
- An action that times out, or a cancelled run, closes the AT Driver session, because a key press already sent cannot be taken back.

The adapter's assumptions, rotor routines and what is not confirmed on real VoiceOver are in the [AT Driver README](../packages/screenreaders/src/at-driver/README.md).

## See also

- [Concepts](./concepts.md): simulation versus real VoiceOver, and what a run measures.
- [Planning](./planning.md): how Rawstep uses these actions to carry out a plan.
- [Config reference](./reference/config.md): `profiles[].screenReader`, `profiles[].actions` and `machine`.
- [CLI reference](./reference/cli.md): `doctor` and `run`.
