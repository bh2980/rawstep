# Screen Readers & Navigation Modes

Each run profile configures **how the user moves** (`actions`) and **which screen reader** speaks the page (`screenReader`).

---

## 1. Navigation Modes (Search Strategies)

Real screen-reader users don't all navigate the same way. Some step through the page item by item; others open the VoiceOver Rotor (`VO+U`) or press single-key shortcuts to jump straight to headings, form controls, or links.

In Rawstep, a profile's `actions` object controls which intents and keys the simulated user can use:

| Strategy Preset | Allowed `intents` | What It Tests |
| :--- | :--- | :--- |
| **Linear (Item by item)** | `next`, `previous`, `activate` | Reading order, missing skip links, and how many items a user has to step through sequentially from the top of the page. |
| **By headings** | `next`, `previous`, `activate`, `heading.next`, `heading.previous`, `headings.list` | Whether headings (`<h1>`–`<h6>`, `role="heading"`) are present, properly nested, and named clearly enough to jump to the right section. |
| **By form controls** | `next`, `previous`, `activate`, `form.next`, `form.previous`, `formControls.rotor` | Whether inputs, selects, checkboxes, and buttons have clear accessible names when browsed via the Form Controls rotor or jumped to directly. |
| **By links** | `next`, `previous`, `activate`, `link.next`, `link.previous`, `links.list` | Whether link text makes sense out of context in a links list (catching vague *"Click here"* or *"Read more"* links). |
| **Custom** | Any combination of intents and `keys` | Custom testing scenarios (e.g., adding `Escape`, `Tab`, `Shift+Tab`, `ArrowDown`, `readCurrent`, or `readFocused`). |

### How Rotor List Intents Work
- **`headings.list`:** Announces every heading on the page along with its heading level in a single output window (modeled on the VoiceOver Headings rotor list). When `runRules.survey` is `"headings"` (the default) and `headings.list` is allowed, the simulated user runs this automatically on step 1. A plan can also use it later (on a new page, for example). The list closes again and the cursor stays where it was.
- **`links.list`:** Announces all links on the page in a single output window. The cursor stays where it was.
- **`formControls.rotor`:** Opens the Form Controls rotor list. While open, `next` and `previous` step through the listed controls, `activate` moves the screen-reader cursor onto the chosen control without pressing it (closing the rotor), and `Escape` closes the rotor without moving.

---

## 2. Screen-Reader Engines (`profile.screenReader`)

Rawstep supports three screen-reader backends:

| `screenReader` Value | Platform | Setup Required | Best For |
| :--- | :--- | :--- | :--- |
| **`"simulation"`** *(default)* | macOS, Linux, Windows | None (runs in headless or headed Chromium) | Fast local development, multi-run suites, and Linux CI pipelines. |
| **`"voiceover"`** | macOS (`darwin`) | macOS VoiceOver + AT Driver server (`ws://localhost:4382/session`) | Verifying real Apple VoiceOver behavior on macOS. |
| **`"nvda"`** | Windows (`win32`) | Windows NVDA + AT Driver server (`ws://localhost:3031/session`) | Verifying real NVDA behavior on Windows. |

How far each has been checked: the simulation is tested on every change on macOS and Linux, and not yet on Windows. `voiceover` is experimental: it has been checked on Rawstep's own test pages and a few public sites, in one macOS virtual machine. `nvda` has not been tested on a real Windows machine yet.

---

## 3. Simulated VoiceOver (`"simulation"`)

`MockVoiceOverBackend` (`@rawstep/screenreaders/mock-voiceover`) is Rawstep's built-in, cross-platform screen-reader simulator:
- Reads Chromium's live Accessibility Tree via Chrome DevTools Protocol (`Accessibility.getFullAXTree`) and keeps a cursor of its own. Keyboard focus follows that cursor onto any item that can take focus, as VoiceOver does by default, and a focus change made by the page moves the cursor.
- Formats spoken announcements with hand-written English wording rules (`formatSimulatedSpeech`). Some are checked against thirteen cases of VoiceOver output that people reported to [Accessibility Supported (`a11ysupport.io`)](https://github.com/accessibilitysupported/a11ysupport.io); the rest are choices made in Rawstep. A separate evidence module holds 2,914 third-party reported-result records (from Accessibility Supported and published [W3C ARIA-AT](https://github.com/w3c-cg/aria-at) reports; results, not transcripts) to measure how much is covered and where the gaps are. Runs do not use it.
- Announces roles, accessible names, heading levels, landmarks, dialog boundaries, live regions (`aria-live`, `role="alert"`, `role="status"`), and states (`expanded`, `collapsed`, `checked`, `disabled`, `required`).
- Stamps every trace with `evidenceProvenance: "simulation"` so simulated runs are never confused with native OS screen-reader runs.

---

## 4. Native VoiceOver & NVDA via W3C AT Driver

To run tasks against a real operating-system screen reader, set `"screenReader": "voiceover"` (on macOS) or `"screenReader": "nvda"` (on Windows) in your run profile.

Rawstep communicates with native screen readers over the [W3C AT Driver](https://github.com/w3c/at-driver) WebSocket protocol (`AtDriverBackend`):
- **Default WebSocket endpoints (`machine.atEndpoints`):**
  - `voiceover`: `ws://localhost:4382/session` ([Bocoup macOS AT Driver server](https://github.com/bocoup/macos-at-driver-server))
  - `nvda`: `ws://localhost:3031/session` ([PAC NVDA AT Automation server](https://github.com/Prime-Access-Consulting/nvda-at-automation))
- **Visible Browser Window:** Native screen readers read visible OS windows, so Rawstep always opens a visible browser for `voiceover` and `nvda` runs, whatever `machine.headless` says.

### Auto-Starting the AT Driver Server (`RAWSTEP_AT_DRIVER_COMMAND`)

Instead of starting the AT Driver WebSocket server manually before every run, you can set `RAWSTEP_AT_DRIVER_COMMAND` in `.env.local` (or in the Dashboard under **Settings › This computer**):

```bash
# Example in .env.local
RAWSTEP_AT_DRIVER_COMMAND="npx your-at-driver-server --port 4382"
```

When a run uses `voiceover` or `nvda` and the WebSocket port is not yet listening, Rawstep automatically spawns `RAWSTEP_AT_DRIVER_COMMAND`, waits until the WebSocket accepts connections, and stops the server process group when the run finishes.

### Verifying Native Screen-Reader Connectivity

Run `doctor` to test the WebSocket connection to your configured AT Driver server and, for VoiceOver, that Rawstep can read where VoiceOver's cursor is (see the next section):

```bash
npx rawstep doctor
```

### Getting Into the Page on VoiceOver

VoiceOver's cursor can stay on the browser's own controls when a page loads, and nothing in the page can be reached until it goes in. At the start of a run and on every new document, the engine checks where VoiceOver's cursor is. It reads the position from the screen, not from what VoiceOver says, so this works in any speech language.

1. If the cursor is already in the page (the page moved focus into itself, or VoiceOver went in by itself), nothing is pressed.
2. If the cursor is on the web content as a whole, it goes in (VO+Shift+Down).
3. Otherwise it presses VoiceOver's next-item key until the cursor is on the web content (up to 8 times), then goes in. After going in it checks that the cursor is in the page.

It is not one of the user's moves: it adds nothing to the move count, and the walk over the browser's controls stays out of what the planner hears, though the raw trace keeps it (`screen-reader.page-entry` records each entry, with `reason` when nothing was pressed). It does take a few seconds of the run's `timeoutMs` on each new page. If VoiceOver cannot get in, the run ends on an error at the `page-entry` stage, which says nothing about the page. NVDA has no such step.

To read the cursor's position, and to run VoiceOver's `find previous heading/control/link` commands for `heading.previous`, `form.previous` and `link.previous` (their keys do not arrive through the AT Driver server with Shift held), the Mac that runs Rawstep needs:

- **VoiceOver Utility › General › "Allow VoiceOver to be controlled with AppleScript"** turned on.
- **System Settings › Privacy & Security › Automation:** the app that runs Rawstep (your terminal, your editor, or the CI agent; over SSH it is `sshd-keygen-wrapper`) allowed to control **VoiceOver** and **System Events**. macOS asks the first time with a prompt on screen, and the run waits for it: unanswered, the run ends on an error at the `page-entry` stage.

`rawstep doctor` reads the cursor once, looks at the front window through System Events, and reports `VoiceOver cursor`. Run it once from the same app before your first run, so the prompts come up while you are watching. Rawstep never starts VoiceOver to ask: when VoiceOver is off, the check fails instead.

### Text VoiceOver Cannot Type

The engine types text through the AT Driver server one key at a time, which covers printable ASCII on a US layout. On VoiceOver, text with any other character (Korean, for example) is pasted: the engine puts it on the Mac's clipboard and presses Command+V, the way a person pastes a word they were given. The clipboard keeps that text after the run, sensitive inputs included; the trace records only that a paste happened and its length. NVDA does not paste, so such text fails there.

### Caution: VoiceOver's Setting for Newly Loaded Pages

**VoiceOver Utility › Web › General › "When loading a new web page:"** decides what VoiceOver does when a page loads: *Automatically speak the web page*, *Speak web page summary* or *Do Nothing*. With *Automatically speak the web page*, VoiceOver reads the page aloud on its own, and its cursor moves along as it reads. The run then starts wherever the cursor is when Rawstep makes its first move. That depends on timing (how fast the machine is), not on a person, so two runs of the same task can start in different places and spend different numbers of moves. Rawstep does not move the cursor back: that would no longer be where a user with this setting starts.

Choose this setting for the users you want to model. When you compare runs, use a setting that does not read the page aloud (*Speak web page summary* or *Do Nothing*), and keep it the same across the runs you compare.
