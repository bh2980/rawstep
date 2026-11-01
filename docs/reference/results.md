# Results reference

This page is for anyone who opens a run folder: to read the files, build on them, or understand a hint. It lists the files a run writes, what the trace records, how input values are redacted, every hint kind and where it comes from, and what the report and the analysis contain. For what the numbers mean for a first-time screen reader user, see [concepts](../concepts.md).

## Where runs are written

Every run is saved inside a batch: one `rawstep run`, `rawstep suite` or `runTask` / `runSuite` call, or one batch started in the dashboard.

```text
<project>/.rawstep/experiments/<batch id>/
  experiment.json          the record of the batch
  summary.json             the batch summed up per task and profile
  <run id>/                one folder per run
    trace.json, hints.json, report.html, ...
```

`<batch id>` and `<run id>` are UUIDs. The CLI and the dashboard write the same format, so `npx rawstep ui` lists the batches the CLI ran, also while it is open.

`experiment.json` holds what the batch is for (`request`, including the `note` from `--note`), each run with its task, profile, state and outcome, and the batch's `owner`: the process id, the computer, and whether it came from the CLI, the dashboard or the API. While the owner process is alive, no other process stops the batch or marks it interrupted. When the process is gone, the next listing marks its unfinished runs as interrupted. A task file that is not registered (run by path from the CLI) is kept in the batch under its file name.

`summary.json` is written when the batch's last run ends, whether it came from the CLI, the API or the dashboard. See [The batch summary](#the-batch-summary).

A run folder is never silently replaced: Rawstep refuses to write into a folder that already holds a trace. Keep `.rawstep/` out of git.

## The batch summary

`summary.json` is a `BatchSummary`, schema version `1.0`: what the batch's runs came to, per task and profile, without the traces. `rawstep compare` and `--baseline` read it, and `--save-summary <file>` writes the same content to another file, so it can be committed as a baseline (see [Using Rawstep in CI](../ci.md)). `runTask` and `runSuite` return it as `summary`. Readers refuse other schema versions.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `"1.0"`. |
| `batch` | `id`, `createdAt` (an ISO timestamp) and the `note` from `--note`, when there is one. |
| `cells` | One entry per task under a profile, in the order the runs came. |

Each cell:

| Field | Meaning |
| --- | --- |
| `taskId`, `taskName`, `profileId`, `profileName` | The task and run profile. Cells of two batches are matched by `taskId` and `profileId`. |
| `runs` | How many runs the batch made of this task under this profile. |
| `endings` | A count for each of `reached`, `gave-up`, `mistaken`, `unmeasured` and `error`. They add up to `runs`. `error` counts runs that broke (or were cancelled): they say nothing about the page and are left out when comparing. The other four are the [endings](../concepts.md). |
| `reachedMoves` | The moves of each run that reached the goal, in run order. |
| `stuck` | Elements where pressing did not respond as the user expected: `role`, `name` (when the element has one) and `runs`, how many runs it came up in. |
| `pageFindings` | Hints from the page (focus, announcements, dialogs...) by `kind` and element, with `role`, `name` and `runs`. Shown in the summary; the comparison does not use them. |

Only runs that did not end on an error are read for `stuck` and `pageFindings`.

## Files in a run folder

| File | Written | What it holds |
| --- | --- | --- |
| `trace.json` | Created when the run starts (without `endedAt` and `outcome`), replaced atomically when it ends | The run: task, environment, every event, the outcome, the privacy record. |
| `trace.jsonl` | Appended one event per line while the run goes | The same events as a journal. If a run is cut off before it ends, readers rebuild the events from it. |
| `plan.json` | At the end of the run, when a plan was made | The final plan document: success criteria, strategy, assumptions with their status, phases of tasks with status and action counts, retired tasks, and every revision. |
| `plan.md` | With `plan.json` | The same plan as a readable checklist. |
| `hints.json` | When the run ends; again after the last repeat | The friction hints of the run. |
| `analysis.json` | When the run ends | The analysis: rule-based, or by the analysis model. |
| `report.html`, `report.json` | When the run ends; again after the last repeat | The report for people, and its data. |
| `diagnostics/step-<n>.png` | During the run | A screenshot after step `n` (step 0 is the page before the first action). For people only; never given to the planner or the user model. |
| `diagnostics/start-page.png` | During the run | The whole start page (cut at 16,000 pixels), to show where on the page a run got stuck. |

Notes:

- Trace files are written with mode `0600` (owner only).
- Screenshots are taken only for runs started by `rawstep run`, `rawstep suite` and the dashboard. After a secret was typed, form fields are blacked out, and a screenshot is left out while the page shows a typed secret (see [redaction](#redaction)). The report lists them by reference; the dashboard shows them.
- `plan.json` and `plan.md` are written even when the run ended on an error. They are the end state; every plan version is also in the trace as `policy.evidence`.
- A run gets its files as soon as it ends, with no reference run. When the last repeat of a task under a profile in the same batch has ended, every repeat's `hints.json` and report are written again against the fastest one that reached the goal, keeping each run's analysis. So repeats get `slow-run` hints, from the CLI and the dashboard alike.
- A cancelled `rawstep run`, `rawstep suite`, `runTask` or `runSuite` keeps the traces written so far and still writes their hints, the rule-based analysis and the report, without the model analysis. Run `rawstep analyze --llm` on a folder afterwards if you want one.
- The `hints`, `report` and `analyze` commands write into the folder they read (or `--out`). `rawstep analyze` rewrites `hints.json` without a reference run.

## The trace

`trace.json` is a `RunTrace`, schema version `3.0`. Readers refuse other versions.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `"3.0"`. |
| `runId` | A UUID. |
| `task` | The task as run: `id`, `url`, `goal`, `input` (redacted), `inputOptions`. |
| `environment` | Platform, browser and screen reader names and versions (`unknown` when not known), plus `observationProvenance`: `simulation`, `native` or `unspecified`. |
| `startedAt`, `endedAt` | ISO timestamps. `endedAt` is missing while the run is going. |
| `events` | The ordered evidence (below). |
| `outcome` | How the run ended (below). Missing while the run is going. |
| `privacy` | `inputValues`: `redacted` or `included-by-explicit-opt-in`; `redactionApplied`: whether anything was redacted. |

### Events

Each event has an `id` (`event-000001`, ...), a `seq`, a `timestamp`, a `type`, a `source`, `data`, and `redacted` (true when something in it was replaced or withheld). Speech events may carry a `collectionWindow` and `association: "temporal-only"`: a collected line is not proof that the last command caused it.

`source` is one of `simulation` (simulated VoiceOver output), `screen-reader` (native output), `runner`, `browser-diagnostic`, `verifier`, `policy`.

The event types you will meet most:

| Type | Source | What it records |
| --- | --- | --- |
| `run.started` | runner | Limits, the allowed actions, and the conditions (profile, planner, action set, page environment, screen reader, run rules). |
| `backend.metadata`, `browser.metadata`, `environment.updated` | runner, browser-diagnostic | What the screen reader backend and the browser are. |
| `simulation.observation` / `screen-reader.observation` | simulation / screen-reader | What was spoken after an action (`speech`, `title`), and where the cursor was (`cursor`). |
| `simulation.output` / `screen-reader.output` | same | Each spoken output. |
| `backend.<type>` | simulation / screen-reader | Raw events from the screen reader backend (command acknowledgments, outputs). |
| `policy.decision` | policy | The step's decision: the action taken, or the stop. |
| `policy.evidence` | policy | The planner's side: plan versions (`orchestration-plan`), the action Rawstep chose for a task (`orchestration-follow`), whether a task's cue was heard (`orchestration-cue`), task status changes (`orchestration-task`), a give-up (`orchestration-give-up`), the heading survey (`orchestration-survey`), the planner-call limit or a task the profile has no allowed action for (`orchestration-limit`), the repetition guard (`repetition-guard`). |
| `policy.rejected` | policy | A decision that was not allowed. |
| `action.result` | runner | Whether the action ran (`ok`, `error`). |
| `observer.<kind>` | browser-diagnostic | What the page itself did, seen by a page observer the user model never sees: `focus`, `focus-lost`, `appeared`, `disappeared`, `live-region`, `state`, `submit`, `navigation`, `page-blur`, `page-focus`. Hints are computed from these. |
| `verifier.baseline` | verifier | Which goal checks already held before the first action. |
| `verifier.result`, `verifier.evidence` | verifier | The goal check after a step: per rule outcome, and what each rule observed. |
| `goal.reached`, `goal.lost` | runner | The goal check passed (and whether the words were heard), or an action undid it. |
| `browser.screenshot`, `browser.start-page`, `browser.screenshot-redacted` | browser-diagnostic | The screenshot files, or that one was withheld. |
| `browser.accessibility-diagnostic`, `browser.profile`, `browser.profile-check` | browser-diagnostic | DOM diagnostics and what the page environment actually applied. These are measurements, not what the user model sees. |
| `browser.navigation-blocked`, `browser.navigation-warning`, `browser.access-blocked` | browser-diagnostic | Navigation the task's navigation scope refused or warned about; a site that blocked the browser. |
| `privacy.input-taint`, `privacy.input-taint-ended` | runner | A secret is being typed, and evidence is withheld; with the simulation the second marks where that stops, after the typing step (see below). |
| `policy.planner-call` | policy | The policy started asking its planner (`trigger`: why). The plan or cue answer follows as `policy.evidence`; the time between is time spent waiting for the model, which the run's time limit does not count. |
| `run.error`, `run.aborted`, `run.cleanup-warning` | runner | Why a run ended on an error or was cancelled; a resource that did not close in time. |

Some `run.*` events appear only in some runs (waiting for a person to pass a site's human check, for example).

### Outcome

`outcome.status` is `success`, `failure`, `inconclusive` or `aborted`. `outcome.reason` says why:

| `reason` | Status | Meaning |
| --- | --- | --- |
| `verified` | `success` | The goal check passed. |
| `verification-failed` | `failure` | The user said the goal was reached and it was not. |
| `policy-stuck` | `failure` | The user gave up (or a custom policy stopped as stuck). |
| `policy-uncertain` | `inconclusive` | A policy stopped as unsure. |
| `maxSteps` | `inconclusive` | The step limit ended the run. |
| `timeout` | `inconclusive` | The time limit ended the run. |
| `error` | `failure` | The run broke. `stage` (`initialization`, `backend-start`, `browser-start`, `observation`, `policy`, `action`, `settling`, `verification`), `step` and `error` say where. Says nothing about the page. |
| `trace-persistence-error` | `failure` | The trace could not be written. |
| `unsupported-profile`, `access-blocked`, `unsupported-pattern` | `failure` or `inconclusive` | The page environment could not be applied; the site blocked the browser; the simulator does not model a pattern on the page. |
| `aborted` | `aborted` | The run was cancelled; `cancellation` holds the signal, stage and step. |

Other fields: `steps` (actions taken), `policyStopSource` (who ended a run that stopped itself: `user-gave-up`, `orchestration-limit` for the planner-call limit, `no-allowed-action` when the run profile allows no action the plan's task needs, `exploration-guard` for the repetition guard, `planner`, `model`) and `policyStop` (`success`, `stuck`, `uncertain`).

How `reason` and `policyStopSource` map to the four endings (reached the goal, gave up, said it was done but the goal was not reached, not measured), and why a run that ended on an error is not counted, is in [concepts](../concepts.md).

## Redaction

Input values you give a task (a password, an email address) must not end up in a saved run. Rawstep redacts them before anything is written.

- Every string in the trace is checked against the task's input values. A match is replaced with `[REDACTED]`, and the event gets `redacted: true`. A value is also found when it appears URL-encoded, form-encoded or JSON-escaped. Property names are never changed.
- An input marked `sensitive: false` in `inputOptions` (a search term, a quantity) is not redacted, and the planner is told its value. Everything else is sensitive by default. See the [task reference](./task.md).
- While a secret is typed, its echo arrives character by character, which cannot be matched as the whole value. So for the typing step (`privacy.input-taint`) the run withholds more than the value: speech and titles are replaced by `[REDACTED]`, observer events keep their kind and role but lose names and text, policy evidence is cut down to bookkeeping (ids, counts, statuses), error messages are replaced, and no screenshot is taken (`browser.screenshot-redacted`). Structure is kept so hints still work.
- With the simulation, whose speech is exact text, that ends after the typing step (`privacy.input-taint-ended`): later speech, plans, errors and verification are kept, with the value itself masked wherever it appears. A real screen reader can echo late and in its own words, so with VoiceOver or NVDA the withholding lasts to the end of the run.
- After a secret was typed, screenshots black out every form field, and one is left out when the page's text shows a typed secret.
- Before the user model sees speech, the same values are masked in it too, and the speech that follows typing is withheld (`[typed input withheld]`).
- Redaction covers the configured input values and these recorded boundaries. It does not cover other secrets visible on a page, and screenshots taken before typing show what was on screen. Treat a run folder as sensitive.
- `privacy.inputValues` is `redacted` for every run started by the CLI or the dashboard. Only a program that calls the low-level runner (or `TraceRecorder`) with `includeSensitiveInputValues: true` can write `included-by-explicit-opt-in`.
- An analysis by a model needs `privacy.inputValues` to be `redacted` and sends the whole saved trace to the model (see [Analysis](#analysis)).

## Hints

`hints.json` is a `HintReport`, schema version `3.0`. Hints are pointers to places in a run worth a human look. They are never verdicts: Rawstep is not an accessibility certification, and reaching the goal is one signal among them. The file is computed from the saved trace alone, so it can be recomputed any time with `rawstep hints <run-dir>`.

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `runId`, `taskId` | Identify the run. |
| `steps` | Actions taken. |
| `durationMs` | Time from start to end, or `null`. |
| `goalReached` | The outcome status was `success`. |
| `outcome` | The trace's `status` and `reason`. |
| `reference` | Another run it was compared with (`runId`, `steps`, `durationMs`, `goalReached`), when there was one. |
| `hints` | The list, sorted by first step. |
| `limitations` | Always says that hints do not establish defects or conformance. Adds a line when the page observer recorded nothing, or when names after typing were redacted. |

Each hint:

| Field | Meaning |
| --- | --- |
| `kind` | See the table below. |
| `source` | `page`, `model` or `run` (below). |
| `target` | The page element it is about: `{ role, name? }`, as the accessibility tree names it. `name` is left out when unnamed or redacted. |
| `certainty` | `observed`: directly recorded. `suspected`: inferred from indirect signals; may be wrong. |
| `steps` | The steps it points at. Empty for `slow-run`, which is about the whole run. |
| `count` | Only when the same page behaviour repeated on the same element and was merged into this hint: how many times it happened. `steps` and `evidence` then hold all of them. Absent means once. |
| `summary` | One sentence for people. |
| `detail` | Numbers and names specific to the kind. |
| `evidence` | Ids of the trace events it was derived from. |

### Sources

| Source | Meaning |
| --- | --- |
| `page` | The page itself behaved this way: focus, announcements, dialogs, navigation. |
| `model` | The simulated user wandered, stopped early, or held an expectation that broke. This may say more about the user model or the plan than about the page. |
| `run` | About the run as a whole (length against a reference, goal already met at the start) and orchestration events: a new plan, a task that ran out of actions. They mark where the plan needed revising. The page may have made that hard, or the plan may have been wrong. |

Within one run, `page` hints of the same kind, on the same element (role and name) and with the same certainty are merged into one hint with a `count`; a skip link whose activation was never announced four times is one `missing-announcement` hint with `count` 4, not four hints. `excess-keystrokes` is not merged, since each stretch has its own number of keys, and neither are hints without an element or hints from `model` and `run` sources.

Only `page` and `model` hints are grouped across runs (see [Findings](#findings-across-runs)).

### Hint kinds

| Kind | Source | Certainty | What it says and when it appears |
| --- | --- | --- | --- |
| `slow-run` | run | observed | The run took at least 1.5 times as many steps as a reference run that reached the goal, and at least 3 more. Needs a reference: `--repeat`, repeats in the dashboard, or `rawstep hints --reference`. |
| `goal-met-at-start` | run | observed or suspected | Goal checks already held before the first action, so "reached the goal" is weak evidence. Observed when every check held, suspected when some did. |
| `goal-word-stretch` | run | observed | The longest stretch of moves in a row without hearing a word of the goal that carries meaning (a word said on every card does not count). `detail.moves`, `from`, `to`. |
| `replan` | run | observed | The planner wrote a new plan because actions kept failing, kept changing nothing, or the cursor kept going back and forth between two items. `detail.trigger` is `failures`, `no-change` or `oscillation`. |
| `task-limit` | run | observed | A task used up its actions, so the planner wrote a new plan. |
| `wanted-to-give-up` | run | observed | The user wanted to give up but named no approach that had failed, so Rawstep asked for another plan and the run went on. The wish is part of the cost. |
| `expectation-broken` | model | observed | An assumption the planner made (for example "pressing Add to cart announces that the item was added") was marked broken. If the user pressed something in the three actions before, the hint sits on that element and `detail.pressed` is the step: a stuck place. Otherwise it was a guess about where something is. `detail.gaveUpOn` is true when the user's give-up rests on it. |
| `early-stop` | model | observed | The run ended early: the user gave up (a plan file that ran out of tasks gives up too), the repetition guard stopped it, the planner-call limit was reached, the run profile allowed no action the plan's task needed, or a policy stopped as stuck or unsure. `detail.stopSource` says who; for a give-up, `detail.giveUp` holds the reason and the assumptions it rests on. |
| `backtracking` | model | observed | Direction reversed 2 or more times (next, then previous, and so on). |
| `excess-keystrokes` | page | observed | 10 or more moves (next, previous, Tab, arrows, Home, End, PageUp, PageDown) between two activations, attributed to the element that was then activated. `detail.count`, `detail.keys`. |
| `focus-lost` | page | observed | Focus fell back to the page after an action removed or left the focused element. |
| `focus-left-page` | page | observed | Keyboard focus left the page (browser UI or another window). |
| `focus-not-visible` | page | observed or suspected | Focus moved to an element that was hidden or outside the viewport (observed); another element may cover the focused control, or no focus indicator was detected (suspected). |
| `modal-focus-outside` | page | observed or suspected | A modal dialog was open while focus moved behind it (observed); a dialog opened but focus did not move into it (suspected). |
| `missing-announcement` | page | suspected | An activation changed the page, but no live region, alert or status, focus move or page load was recorded. |
| `live-interruptions` | page | observed | After three or more moves that pressed nothing, the page announced something on its own (a live region: a rotating banner, a viewer count), talking over what each move said. `detail` has the number of moves and example texts. Simulation only: a real screen reader's output does not say which lines a live region spoke. |

The thresholds (1.5 times, 3 steps, 10 moves, 2 reversals) are `DEFAULT_HINT_THRESHOLDS` in `rawstep/hints`; `extractHints` and `writeHints` take overrides in the library. The CLI uses the defaults.

### Findings across runs

`rawstep run` and `runTask` group the `page` and `model` hints of all repeats by kind and element into findings: the same kind of hint about the same element. Each finding has the number of runs that show it (`runs` of `totalRuns`) and every occurrence, so you can open the step. Findings are sorted by how many runs show them, `page` before `model`. `excess-keystrokes` findings also carry the min, max and mean count. An occurrence carries the hint's `count` when it has one. Runs are counted once however many times the hint repeated inside them. A finding is a place to look at, not a conclusion that the page is wrong.

### Comparing two runs

`compareHints(current, reference)` (from `rawstep/hints`) takes two hint reports and matches their hints by kind and element, the same identity findings use. It returns `new` (only in `current`), `gone` (only in `reference`) and `both` (a `{ current, reference }` pair of hint lists for each kind and element they share, since a run can have several of one identity). `slow-run` is left out: it exists only because of the reference. The comparison says what differs, not which run is better. `writeHints(runDir, { reference })` returns it as `comparison`, and `rawstep hints <run-dir> --reference <run-dir>` prints it. Neither writes it to `hints.json`.

## The report

`report.html` is one self-contained page for reading a run. It opens with the task and its goal, then what was hard (the stuck places, wrong guesses and why the run stopped), then how it ended and what it cost in moves, then the details; the run id is last. Every sentence is in English and Korean, and the page opens in the reader's language (the browser's, or the one chosen with the switch at the top, remembered in the browser). It has no remote files and one fixed inline script for the language switch, and its content security policy allows that script by its hash and nothing else. `report.json` is the same information as data: `schemaVersion` `1.0`, `runId`, `runOutcome`, `analysis`, `hints` (when there is a `hints.json`), `eventCount`, `privacy` and a `summary` of counts, actions, the first failure and the verification results.

The HTML sections, in order:

1. Recorded run outcome: status and reason, who stopped it, the error, the stage and step, the signal for a cancelled run, start and end time, and the kind of evidence. A simulated run is labelled "Simulated VoiceOver approximation. This is not Apple VoiceOver."
2. First recorded failure or interruption, if any.
3. Privacy and evidence coverage: how many events were redacted, how many screenshots were taken or withheld.
4. Friction hints, when the run has them: the table of hints and the limitations.
5. Action results: each action attempt and whether it ran, with links to the events.
6. Applied environment and independent diagnostics, when the run recorded them.
7. Independent verification: each goal check, each rule's result and what it observed.
8. The task and the environment.
9. Analysis: the status and the findings, or "Not requested."
10. Raw ordered evidence: every event, expandable, with an anchor by event id so the findings link to them.

The report does not show screenshots; the files are in `diagnostics/`. It describes this run only and says so: it does not establish accessibility conformance.

## Analysis

`analysis.json` is an `AnalysisReport`, schema version `1.0`. A run started by `rawstep run`, `rawstep suite` or the dashboard gets one when it finishes.

| Field | Meaning |
| --- | --- |
| `analyzer.id` | `rawstep/deterministic-v1` for the rule-based analysis, `rawstep/llm-openai-compatible-v1` for the model-based one. |
| `status` | `completed` or `failed`. |
| `summary` | A paragraph. |
| `findings` | Each has `id`, `title`, `description`, `severity` (`info`, `warning`, `error`) and `evidenceEventIds`, which must name events that exist in the trace. |
| `runOutcome` | A copy of the recorded outcome. An analysis whose outcome differs from the trace is rejected: analysis never changes how a run ended. |
| `failure`, `error` | When `status` is `failed`: `cancelled`, `timeout`, `invalid-result` or `analyzer-error`, with a generic message (provider text is never saved). |

**Rule-based analysis** always runs, locally, with no model. It counts and flags what the trace records. Its findings are, by `id`: `policy-block` (a decision or navigation was refused), `command-failure`, `missing-speech-evidence`, `redacted-speech-evidence`, `simulated-voiceover-evidence`, `redacted-simulation-evidence`, `redacted-diagnostic-screenshots`, `redacted-verifier-evidence`, `speech-repetition-limit`, `orchestration-limit` and `verification-failure`. Most are `info`; a few are `warning`. They are diagnostics, not an accessibility verdict.

**Model-based analysis** sends the whole saved trace to the project's analysis model and asks for a summary and findings that each cite events. Set the model in the config at `project.analysis.model` (a connection, a model id and optionally a reasoning effort), or in the dashboard's settings. Optional `project.analysis.instructions`, and a task's `analysisInstructions`, add focus to the prompt but never replace its evidence rules. See the [config reference](./config.md).

- `rawstep run`, `rawstep suite`, `runTask` and `runSuite` analyse each run with the model when one is set and its key is available. Without the key, the runs get the rule-based analysis and a warning says so.
- `rawstep analyze <run-dir> --llm` does it for a saved run.
- The trace must be finished and input-redacted, and must fit in about 1,000,000 bytes: Rawstep refuses to cut events silently. The model is told that trace content is untrusted evidence, that plans and assumptions are expectations and not facts about the page, and that it must not claim conformance.
- If the model's analysis fails, `analysis.json` says `failed`; the rule-based analysis is not substituted. The run folder, its outcome and its hints are unchanged.
- The analysis is read by people and the report. The dashboard shows the model's analysis; the rule-based facts are covered by the hints.
