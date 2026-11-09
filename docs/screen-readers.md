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
- **`headings.list`:** Announces every heading on the page along with its heading level in a single output window (modeled on the VoiceOver Headings rotor list). When `runRules.survey` is `"headings"` (the default) and `headings.list` is allowed, the simulated user runs this automatically on step 1.
- **`links.list`:** Announces all links on the page in a single output window.
- **`formControls.rotor`:** Opens the Form Controls rotor list. While open, `next` and `previous` step through the listed controls, `activate` moves the screen-reader cursor onto the chosen control without pressing it (closing the rotor), and `Escape` closes the rotor without moving.

---

## 2. Screen-Reader Engines (`profile.screenReader`)

Rawstep supports three screen-reader backends:

| `screenReader` Value | Platform | Setup Required | Best For |
| :--- | :--- | :--- | :--- |
| **`"simulation"`** *(default)* | macOS, Linux, Windows | None (runs in headless or headed Chromium) | Fast local development, multi-run suites, and Linux CI pipelines. |
| **`"voiceover"`** | macOS (`darwin`) | macOS VoiceOver + AT Driver server (`ws://localhost:4382/session`) | Verifying real Apple VoiceOver behavior on macOS. |
| **`"nvda"`** | Windows (`win32`) | Windows NVDA + AT Driver server (`ws://localhost:3031/session`) | Verifying real NVDA behavior on Windows. |

---

## 3. Simulated VoiceOver (`"simulation"`)

`MockVoiceOverBackend` (`@rawstep/screenreaders/mock-voiceover`) is Rawstep's built-in, cross-platform screen-reader simulator:
- Reads Chromium's live Accessibility Tree via Chrome DevTools Protocol (`Accessibility.getFullAXTree`) and maintains an independent virtual cursor alongside DOM focus.
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

Run `doctor` to test the WebSocket connection to your configured AT Driver server:

```bash
npx rawstep doctor
```

### Getting Into the Page on VoiceOver

VoiceOver's cursor stays on the browser's own controls when a page loads, and nothing in the page can be reached until it goes in. The engine does this itself, at the start of a run and on every new document:

1. If the page moved focus into itself on load (`autofocus` or a `focus()` call), VoiceOver is already inside and nothing is pressed.
2. Otherwise it presses VoiceOver's next-item key until VoiceOver names the web content (up to 8 times), then goes in (VO+Shift+Down) and checks that VoiceOver said so.

It is not one of the user's moves: it adds nothing to the move count, and the walk over the browser's controls stays out of what the planner hears, though the raw trace keeps it (`screen-reader.page-entry` records each entry). It does take time from the run's `timeoutMs`: about 4 seconds at the start and 7 on each later page. If VoiceOver cannot get in, the run ends on an error at the `page-entry` stage, which says nothing about the page. NVDA has no such step.
