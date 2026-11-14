# Results, Traces & Hints Reference

Every run or suite execution saves structured artifacts under `.rawstep/experiments/<batch-id>/`. This reference documents the directory layout, `summary.json`, `trace.json`, and all 16 Friction Hint kinds (`hints.json`).

---

## 1. `.rawstep/` Storage Layout

```text
.rawstep/
└── experiments/
    └── <batch-id>/                   # One batch folder (named by a UUID) per `rawstep run` or `rawstep suite`
        ├── experiment.json           # The batch's run history: request, and each run's state, conditions and outcome
        ├── summary.json              # BatchSummary (Schema 1.0) across all tasks & profiles in this batch
        └── <run-id>/                 # One folder per individual run (named by the run's UUID)
            ├── trace.jsonl           # Append-only crash-safe event stream
            ├── trace.json            # Finalized RunTrace (Schema 4.0)
            ├── diagnostics/          # Diagnostic PNGs: step-<N>.png after each step, start.png of the full page at start
            ├── plan.json             # Final PlanDocument with phases, tasks, criteria, assumptions, and revisions (planner-driven runs)
            ├── plan.md               # Human-readable Markdown rendering of plan.json
            ├── hints.json            # Extracted HintReport (Schema 4.0)
            ├── analysis.json         # Post-run deterministic or LLM analysis report
            ├── report.json           # Combined summary data for report.html
            └── report.html           # Standalone single-file HTML report
```

---

## 2. Batch Summary (`summary.json`)

Written at `.rawstep/experiments/<batch-id>/summary.json` (and optionally copied via `--save-summary <file>`, which is what you commit as a baseline). Consumed by `rawstep compare` and `--baseline`. The shape is `{ schemaVersion: "1.0", batch: { id, createdAt, note? }, cells }`.

Each cell in `cells` groups runs by `(taskId, profileId)` and records:
- **`taskId`, `taskName`, `profileId`, `profileName`:** Which task under which profile the cell is.
- **`runs`:** How many runs the cell has.
- **`endings`:** `{ reached, gave-up, mistaken, unmeasured, error }`, the number of runs that ended each way (`error` counts a run that broke, which says nothing about the page).
- **`reachedMoves`:** `number[]`. Moves of each run that ended as `reached`, in run order, counted up to where the goal check passed (`goalStep`; the run's `steps` when it stopped there).
- **`unconfirmed`:** `number`, left out when zero. How many of those runs had nothing to show the user knew (`goalConfirmed: false`).
- **`stuck`:** `{ role, name?, runs }[]`, elements where pressing did not respond as the user expected (`expectation-broken`), with how many of the cell's runs they came up in.
- **`pageFindings`:** `{ kind, role, name?, runs }[]`, recurring `page`-source friction hints grouped by hint kind and element.

---

## 3. Run Endings (`RunEnding`)

Computed by `runEnding(outcome)` (`rawstep/hints`, also exported from the root `rawstep`). It takes the trace's `outcome`, reads who stopped the run from it (`outcome.policyStopSource`), and returns `{ ending, by? }`. `by` is set only for `unmeasured`.

A run that **broke** has no ending: `runEnding` returns `undefined` when there is no outcome, the run was cancelled (`status: "aborted"`), or it ended on `reason: "error"` or `"trace-persistence-error"`. `runBroke(outcome)` is that test on its own. Such a run says nothing about the user or the page and is counted apart (`error` in a batch summary), never among the four endings.

Counts of the form "reached N of M" use the **measured** runs as M: the ones that ended as `reached`, `gave-up` or `mistaken` (`measuredRuns`, and `isMeasured` for one ending). A run that was not measured is listed beside the rate, not in it. The CLI, the batch summary, the comparison and the dashboard all count this way.

| `ending` | `outcome.status` / `reason` / stop source | Description |
| :--- | :--- | :--- |
| **`reached`** | `status: "success"` | Independent verification (`task.verify.all`) passed. A run with `goalConfirmed: false` beside it had nothing to show the user knew; that is a note and does not change the ending. |
| **`gave-up`** | stop source `"user-gave-up"`, or `reason: "policy-stuck"` | The planner concluded no remaining approach on the page could achieve the goal (`giveUp: { reason, tried }`), or a custom policy stopped as stuck. |
| **`mistaken`** | `reason: "verification-failed"` | The planner marked the plan `complete: true`, but `task.verify.all` did not pass. |
| **`unmeasured`** | Any limit, block, or environment stop | Stopped before the user could finish or give up. `by` identifies the cause (see below). |

`by` values for `unmeasured`, by what produced them:

| `by` | Produced by |
| :--- | :--- |
| `'planner-calls'` | stop source `orchestration-limit` |
| `'no-allowed-action'` | stop source `no-allowed-action` |
| `'repetition-guard'` | stop source `exploration-guard` |
| `'model-uncertain'` | `reason: "policy-uncertain"` |
| `'max-steps'` | `reason: "maxSteps"` |
| `'timeout'` | `reason: "timeout"` |
| `'planner-timeout'` | `reason: "planner-timeout"` |
| `'blocked'` | `reason: "access-blocked"` |
| `'environment'` | `reason: "unsupported-profile"` |
| `'other'` | `reason: "unsupported-pattern"`, or a reason this version does not know |

A stop source is checked before `reason`, so it wins when both are present.

---

## 4. The 16 Friction Hints (`hints.json`, Schema `3.0`)

Extracted by `extractHints(trace, options)` in [`packages/reports/src/hints/index.ts`](../../packages/reports/src/hints/index.ts).

`hints.json` is a `HintReport` wrapper around the hints:
- `schemaVersion`: `"3.0"`.
- `runId`, `taskId`: Which run and task the report is for.
- `steps`, `durationMs`, `goalReached`: The run's step count, duration in milliseconds (`null` when unknown), and whether the goal was reached.
- `outcome` *(optional)*: `{ status, reason? }` from the trace.
- `reference` *(optional)*: `{ runId, steps, durationMs, goalReached }` of the successful run this one was compared against (used by `slow-run`).
- `hints`: The list of `Hint` objects below.
- `limitations`: Plain-language notes on what the hints cannot tell you (for example, that no page observer events were recorded).

Each `Hint` object in `hints` contains:
- `kind`: One of the 16 `HintKind` values below.
- `source`: `'page'`, `'run'`, or `'model'`.
- `certainty`: `'observed'` (directly recorded event) or `'suspected'` (heuristic inference).
- `target` *(optional)*: `{ role: string, name?: string }` of the associated accessibility node.
- `steps`: Step numbers where the hint occurred.
- `count` *(optional)*: Number of times the same page behavior repeated on the same element in the run.
- `summary`: Human-readable one-line description.
- `detail`: Structured metadata specific to the hint kind.
- `evidence`: Trace event IDs (`e-1`, `e-12`, ...) from which the hint was derived.

### 4.1 Page Hints (`source: "page"`)

Repeated occurrences of the same page hint (except `excess-keystrokes`) on the same element within a single run are automatically merged into one hint entry with `count` incremented.

| `kind` | `certainty` | Default Threshold / Trigger |
| :--- | :--- | :--- |
| **`excess-keystrokes`** | `observed` | `>= 10` (`keystrokesToTarget`) navigation actions (`next`, `previous`, `Tab`, `Shift+Tab`, arrows, `Home`, `End`, `PageUp`, `PageDown`) between two activations (`activate`, `Enter`, `Space`). |
| **`focus-lost`** | `observed` | Page observer recorded `focus-lost` (`step > 0`) because the focused element was removed from the DOM or blurred back to `<body>`/`null` after an action. |
| **`focus-left-page`** | `observed` | Page observer recorded `page-blur` (`step > 0`) because keyboard focus left the web page into browser UI or another window. |
| **`focus-not-visible`** | `observed` / `suspected` | • **`observed`:** Observer recorded `focus` on an element with `visible === false` or `inViewport === false`.<br>• **`suspected`:** Browser diagnostic found `focus.centerOccluded === true` or `focus.indicator === "not-detected"` (no CSS outline or box-shadow). |
| **`modal-focus-outside`** | `observed` / `suspected` | • **`observed`:** Observer recorded `focus` outside an open modal dialog (`modalOpen === true`, `inDialog === false`).<br>• **`suspected`:** A `dialog` or `alertdialog` appeared (`step > 0`), but no `focus` event moved focus into it on that step. |
| **`missing-announcement`** | `suspected` | An activation action (`activate`, `Enter`, `Space`) changed the page (DOM state, navigation, or element appearance/disappearance), **but** no live-region, focus move, announcing surface (`alert`, `alertdialog`, `dialog`, `status`, `log`), cross-document navigation, or state change on the focused control occurred. |
| **`live-interruptions`** | `observed` | A page live region announced unsolicited updates after `>= 3` (`liveInterruptions`) moves during the run, talking over the user's navigation. |

### 4.2 Run Hints (`source: "run"`)

| `kind` | `certainty` | Default Threshold / Trigger |
| :--- | :--- | :--- |
| **`slow-run`** | `observed` | Compared against a successful reference run, `steps >= reference.steps * 1.5` (`slowRunStepRatio`) **and** `steps - reference.steps >= 3` (`slowRunMinExtraSteps`). |
| **`goal-met-at-start`** | `observed` / `suspected` | Baseline check before step 1 (`verifier.baseline`) found that all (`observed`) or some non-`not` (`suspected`) rules in `task.verify.all` already held on initial load. |
| **`replan`** | `observed` | The planner had to revise the plan mid-run because of `'failures'`, `'no-change'`, `'press-unanswered'`, `'task-limit'`, `'oscillation'`, or `'effort-review'`. |
| **`task-limit`** | `observed` | A plan subtask ran out of its allotted actions (`stepActionLimit`) without hearing its expected cue. |
| **`wanted-to-give-up`** | `observed` | The planner tried to give up while open assumptions remained untried (refused by orchestration so remaining approaches could be tested first). |
| **`goal-word-stretch`** | `observed` | Long stretch of consecutive moves without hearing any words related to the task's goal. |
| **`early-stop`** | `observed` | The run ended before reaching the goal (`user-gave-up`, `policy-stuck`, `policy-uncertain`, `exploration-guard`, `orchestration-limit`, or `no-allowed-action`). It says how the run stopped; the run's ending (section 3) is what is counted, so this hint is not gathered into findings. |

### 4.3 Model Hints (`source: "model"`)

| `kind` | `certainty` | Default Threshold / Trigger |
| :--- | :--- | :--- |
| **`expectation-broken`** | `observed` | An assumption in the plan document was marked `broken` (for example, pressing a button or submitting a form within the last 3 actions did not produce the expected result). Also surfaced as a **Stuck Place** in batch summaries. |
| **`backtracking`** | `observed` | Navigation direction reversed between forward (`next`, `Tab`, `ArrowDown`, `ArrowRight`) and backward (`previous`, `Shift+Tab`, `ArrowUp`, `ArrowLeft`) `>= 2` (`backtrackReversals`) times. |
