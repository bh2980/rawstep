# Core Concepts

Rawstep separates **what to do** (a Task) from **who is doing it and how** (a Run Profile), and records both whether the goal was reached and what friction occurred along the way.

---

## 1. Simulated User vs. Independent Verifier

In Rawstep, the AI model acting as the user and the verifier checking whether the task succeeded live on opposite sides of a strict boundary:

| Role | What It Sees | What It Can Do |
| :--- | :--- | :--- |
| **Simulated User (Planner + Runner)** | Only the task's `goal`, optional `context`, named `input` keys, and the **spoken announcements** emitted by the screen reader at each step. Never sees HTML source, CSS selectors, screenshots, or `verify.all` rules. | Emit allowed screen-reader intents (`next`, `previous`, `heading.next`, `activate`, rotor lists, etc.), allowed keys, or type declared task inputs. |
| **Independent Verifier (`verify.all`)** | Live browser state: URL, document title, visible text, network requests/responses, isolated page observer events (focus moves, dialogs, live regions, attribute changes), and sandboxed verification scripts. | Check whether every rule in `task.verify.all` holds after each step. |

Because the simulated user never sees the DOM and cannot verify its own success:
- If a button changes the screen visually without announcing anything over speech or `aria-live`, the simulated user does not know whether pressing it worked.
- If the simulated user thinks it finished and stops, but `task.verify.all` has not passed, Rawstep marks the run as **`mistaken`** rather than successful.

---

## 2. Tasks (`tasks/*.json`)

A **Task** describes *what* the user is trying to accomplish on a page:
- **`url` & `goal`:** Where the user starts and what they want to do, written in plain language without leaking page implementation details.
- **`context` *(optional)*:** Background information a real user would already know before starting (e.g., *"You are looking for a medium-sized blue jacket"*).
- **`input` & `inputOptions` *(optional)*:** Named values the user may type (such as `email`, `password`, or `searchQuery`). Inputs are treated as **sensitive by default**—their values are hidden from the planner prompt and redacted from saved traces and speech echoes unless marked `"sensitive": false`.
- **`verify.all`:** One or more independent rules that prove the goal was actually achieved in the browser.
- **`variantOf` & `minimalSteps` *(optional, in `rawstep.config.json`)*:**
  - `minimalSteps`: The minimum number of moves a human needs to complete the task, used as a reference point in reports.
  - `variantOf`: Points to a baseline task ID when testing a copy of a page with a specific accessibility defect, so reports show the exact extra moves caused by that defect.

---

## 3. Run Profiles (`profiles` in `rawstep.config.json`)

A **Run Profile** defines *who* the simulated user is and *under what conditions* the run executes. Running the same task across different profiles lets you compare how page structure affects different navigation habits.

Each profile bundles five settings under a single name:

1. **Planner (`planner`):** Which AI connection and model writes the navigation plan—or a pre-written `planFile` (`plans/{task}.json`) for deterministic, zero-cost runs.
2. **Allowed Actions / Search Strategy (`actions`):** How the simulated user moves through the page:
   - **Linear (Item by item):** Basic sequential reading (`next`, `previous`, `activate`).
   - **By headings:** Adds heading jumps and the headings rotor list (`heading.next`, `heading.previous`, `headings.list`).
   - **By form controls:** Adds form control jumps and the form controls rotor (`form.next`, `form.previous`, `formControls.rotor`).
   - **By links:** Adds link jumps and the links list (`link.next`, `link.previous`, `links.list`).
   - **Custom:** Any custom combination of screen-reader intents, keyboard keys, and text entry permissions (`typeText`, `replaceText`, `inputKeys`).
3. **Screen Reader (`screenReader`):**
   - `'simulation'` *(default)*: Built-in Chromium accessibility-tree simulator calibrated to English VoiceOver phrasing.
   - `'voiceover'`: Real macOS VoiceOver over W3C AT Driver.
   - `'nvda'`: Real Windows NVDA over W3C AT Driver.
4. **Page Environment (`page`):** Browser viewport and media emulation (`default`, `narrow`, `text-200`, `spacing`, `reflow-text`, `forced-colors`, `contrast`, `dark`, `reduced-motion`, or a custom object).
5. **Run Rules (`runRules`):** Limits and replanning triggers (`maxPlannerCalls`, `reviewEvery`, `stepActionLimit`, `failureLimit`, `noChangeLimit`, `confirmationGrace`, `repetitionGuard`, `survey`).

---

## 4. The Five Run Endings (`RunEnding`)

Rawstep does not reduce runs to a simplistic pass/fail boolean. Every finished run is classified into one of four endings (`runEnding` in `@rawstep/reports`):

| Ending (`RunEnding`) | CLI / Dashboard Description | What It Means |
| :--- | :--- | :--- |
| **`reached`** | `reached the goal` | All independent completion rules in `task.verify.all` passed. |
| **`gave-up`** | `gave up` | After exploring and replanning, the planner concluded that nothing heard on the page offers a remaining way to complete the goal (`user-gave-up`), and stores its reason. |
| **`mistaken`** | `said it was done, but the goal was not reached` | The simulated user believed the goal was complete based on what it heard, but `task.verify.all` did not pass (`verification-failed`). Often points to misleading announcements or silent submission failures. |
| **`unmeasured`** | `not measured` | The run was stopped by a harness limit or environment block before the user could finish or give up—for example hitting `maxPlannerCalls`, `maxSteps`, `timeoutMs`, or `repetitionGuard`, the planner timing out or being unsure, the profile allowing no action the plan needs, a network/bot block, or the page environment not being applied. An `unmeasured` run is **not** counted as a user failure; in CLI runs it exits with code `3`. |

---

## 5. Move Counts, Stuck Places & Friction Hints

Even when a run ends as **`reached`**, Rawstep looks closely at what it took to get there:

- **Moves:** How many screen-reader actions it took to reach the goal. If a task takes 6 moves when jumping by headings (`by-headings`) but 28 moves when reading item by item (`linear`), or if a UI change pushes the median move count from 8 to 22, Rawstep highlights the difference.
- **Confirmation Grace (`confirmationGrace`):** When `verify.all` passes on an action (for example, clicking "Save"), Rawstep checks whether the page actually announced anything confirming the change. The check is a literal match of the wording of the rules against the speech. If it was not announced, the run continues for up to `confirmationGrace` (default `5`) extra moves to see whether the user comes upon it. The run ends as `reached` either way, and moves count only up to where the rules passed.
- **Not confirmed (`goalConfirmed: false`):** A note beside `reached`, never a result of its own. It means nothing shows the user knew: the wording was not heard within the grace and the user did not say they were done, or the run stopped for another reason (a limit or the repetition guard). A success message that shows on screen but is not read out is a common cause; a page that confirms in other words can get the note too, so have a look. Rules with no wording to compare (only `urlIncludes` or `script`) end at once with no note. The completion rules are what you call done: if the user has to hear it, add `activatedAnnouncementIncludes` to them, and a run that does not hear it does not pass.
- **Stuck Places (`expectation-broken`):** When the user activates a control or types into a field expecting a specific change (recorded in the plan's `cue` and `assumptions`), and nothing happens or the expectation fails, Rawstep records the element and the broken expectation as a stuck place.
- **Friction Hints (`hints.json`):** Rawstep extracts 16 specific hint types grouped by source:
  - **Page hints (`source: 'page'`):** Issues observed directly in browser/AT behavior (`excess-keystrokes`, `focus-lost`, `focus-left-page`, `focus-not-visible`, `modal-focus-outside`, `missing-announcement`, `live-interruptions`).
  - **Run hints (`source: 'run'`):** Run-wide patterns (`slow-run`, `goal-met-at-start`, `replan`, `task-limit`, `wanted-to-give-up`, `goal-word-stretch`).
  - **Model hints (`source: 'model'`):** Navigation reversals and broken expectations (`backtracking`, `early-stop`, `expectation-broken`).

See **[Results, Traces & Hints Reference](./reference/results.md)** for the full catalog of all 16 friction hints and their exact triggers.
