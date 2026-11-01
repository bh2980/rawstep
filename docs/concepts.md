# Concepts

This page is for anyone reading Rawstep results or setting up runs. It explains the ideas behind them: what a run is made of, who the simulated user is and what it may know, how a run can end, what its cost is and why hints are not verdicts. It explains why things work this way; the [reference docs](#where-to-go-next) list the fields.

Rawstep asks one question: can a first-time screen reader user complete this task on this page, and at what cost? Every idea below serves that question.

## Task and run profile

A run is a **task** run with a **run profile**.

- A **task** says what to do and what the site needs: a start address, a goal, what a newcomer knows about the site (`context`), the inputs the user may type, a completion check, and what the site needs of the browser (`browser`, for example a Chrome you started yourself for a site with a bot check). It says nothing about who tries it or how. See the [task reference](./reference/task.md).
- A **run profile** says who does it and under what conditions. In the dashboard a profile answers four questions: How do they find things? (the actions the user may take), Which AI thinks? (the planner), Where do they listen? (the page environment and the screen reader) and When to stop? (the run rules). There is no layer between Rawstep's defaults and a profile.

A profile is not tied to a task: you pick it when a run starts, so one task can run under many profiles and one profile can be reused across tasks. A task can list the profiles it usually runs with (`profiles` in the config), which the dashboard offers first and `rawstep run` uses when you name none. To learn what one thing changes, make two profiles that differ only in it (the planner model, the way of finding things, the page environment) and run the same task with each. Every run records the full profile it used and the run rules it ran with, so results from different conditions are never mixed up.

A task can also be marked as a broken copy of another (`variantOf`): the same goal on a copy of the page with one accessibility defect. Results then show how many more moves the broken copy took.

## Ways of finding things

Screen reader users differ less in skill than in how they look for things. Rawstep describes the simulated user by that: a **way of finding things**. The dashboard offers these starting points under Way of finding things:

| Way | Actions |
|---|---|
| Item by item | next item, previous item, press |
| By headings | item by item, plus next/previous heading and listing the headings |
| By form controls | item by item, plus next/previous form control and the rotor's form controls list |
| By links | item by item, plus next/previous link and listing the links |
| Custom | actions picked one by one |

Each way is run and costed on its own, instead of guessing what a skilled user would do. A page that is quick by headings and slow item by item tells you who it fails.

With headings allowed, the run starts the way a VoiceOver user who finds things by headings starts: it lists the headings first (the rotor, VO+U), before the first plan. That listing is a move like any other. A user who reads item by item does not do it, so missing headings slow down only the users who rely on them. The `survey` run rule turns this off.

Typing a task's inputs is part of the task, not a way of finding things; each starting point allows it. The profiles `init` writes allow next, previous, press and typing the task's inputs. The intents and keys each screen reader supports are listed in [Screen readers](./screen-readers.md).

## What the simulated user may know

The acting side of a run gets only what a first-time screen reader user could know:

- what the screen reader said, including the item the cursor is on and the page title as announced;
- the task's goal and `context`;
- the actions the profile allows, and the names of the inputs (a value only when the input is marked not sensitive);
- its own plan so far, and its recent actions with what was heard before each (`plannerHistoryLimit`, default 60; older ones are forgotten);
- how much effort it has spent.

It never gets the page's DOM, the diagnostic screenshots or the completion check. Those are the oracle: Rawstep uses them only to measure the run, never to steer it. The completion check decides whether the goal was reached; a page observer records focus moves, announcements and dialogs; screenshots show where the cursor was.

This is why a planner's own instructions must not carry page knowledge, such as where a button is. They are added to Rawstep's planner rules, and a hint about the page would remove the very difficulty the run is there to measure. The dashboard warns about this next to the field.

## How a run goes

A run always follows a plan. The **planner** writes a plan document: success criteria, assumptions about the page, and phases of small tasks, each saying how to move and what cue to listen for. The planner is either a model on a connection or a **plan file** written beforehand.

Rawstep carries the plan out exactly as written. No model picks individual actions. A moving task repeats its move until its cue is heard, a pressing task presses the item the cursor is on, and a typing task types a named input into the field the cursor is on. A task is done when its cue is heard after one of its actions. With a model planner, an item that shares words with the cue but does not match it exactly is put to the planner, which judges whether it is the thing looked for.

Rawstep asks for a new plan when the actions on a task keep failing, change nothing, swing between the same two items, or go on without hearing anything new; when the user hears something named in the goal while looking for something else; when a phase or the whole plan is finished; and every so many moves (`reviewEvery`), to take stock of the effort. A plan file never changes during a run: a stuck task is abandoned and the next one starts, and when no task is left before the goal is reached, the run ends as gave up.

[Planning](./planning.md) describes the plan document, the cue rules and every trigger in detail.

## How a run ends

A run ends in one of four ways. The CLI and the dashboard use these words:

| Ending | What it means |
|---|---|
| reached the goal | The completion check passed. Rawstep checks it; the planner's opinion does not count. |
| gave up | The user decided that nothing it heard left another way to try. A plan file gives up when it runs out of tasks before the goal is reached. |
| said it was done, but the goal was not reached | The planner declared the goal reached, and the completion check said no. |
| not measured | A limit ended the run first, so it says nothing about the user. |

A **not measured** run says what ended it: the planner-call limit (`maxPlannerCalls`), a run profile that allows no action the plan's task needs, the task's maximum steps, the time limit, the repetition guard (the same action producing the same speech too many times in a row), the planner not answering within its connection's time limit, the site blocking the browser (a bot check or an access error, found on the first page or after a press, before any move is spent on it), this computer not applying the page environment, or, for [your own policy](./reference/api.md), the policy stopping because it is unsure. These are cost, safety and harness limits, not the user failing. Whether the task can be done is simply not known.

The time limit counts page time only. Waiting for a planner model, which can take a minute a call, and a person passing a bot check do not count, so a slow model does not end a run as not measured by itself. The repetition guard and the other "nothing changed" checks compare what the move said, not what a live region said on its own meanwhile: a banner that keeps rotating does not hide that the user is going nowhere, and it comes back as a `live-interruptions` hint.

A **give-up** has to rest on something. The planner must name the assumptions it tried that turned out wrong; a give-up that names none, or names assumptions that did not break, is refused and the run goes on. The refusal is kept as a `wanted-to-give-up` hint, since wanting to stop is part of the cost. A plan file that runs out of tasks is the one exception: it has no other way to try, so its give-up is accepted without broken assumptions. An accepted give-up is still the simulated user's judgement, not proof that the task is impossible on this page.

A run that **ended on an error** (the browser failed, the trace could not be written) is none of these. The CLI says it "says nothing about the page", and it is left out of every count.

## Cost

Reaching the goal is only half the answer. The other half is what it cost. Rawstep counts cost in **moves**: each step of the run is one move, a swipe, a press, typing an input, or listing the headings. Time is left out, because it depends on the models, not on the page.

| Measure | What it counts |
|---|---|
| moves | Steps the run took. Across runs, "Cost of reaching it" is the median over the runs that reached the goal, with the range. |
| longest without a goal word | The longest stretch of moves in which the user heard no word of the goal. A word said on every card in a list counts only the first few times. How long is too long is for you to judge. |
| wrong guesses about where something is | Assumptions about where something is (say, "the buy button comes after the product name") that broke while the user was moving. |
| new plans | How often the planner had to write a new plan, by reason: actions kept failing, changed nothing, went back and forth, or a task ran out of actions. |
| stuck | An assumption that broke right after the user pressed something: the element did not respond as expected. These are placed on that element. |

Two more measures compare against a known path. A task can record `minimalSteps`, the fewest moves the goal takes when you know where everything is; the dashboard shows it as "N moves if you know where it is". Among repeats of a task under one profile, from the CLI or the dashboard, each run is compared with the fastest run that reached the goal, and one that took much longer gets a `slow-run` hint.

Reaching the goal without hearing it counts too. If the goal is reached but nothing the user heard said so (a confirmation that is shown but not announced), the run goes on for a few more moves (`confirmationGrace`, default 5): a real user would keep checking. The dashboard counts such runs as Reached but did not know.

## Hints are not verdicts

Rawstep reports **friction hints**: places in a run worth a human look, each with the steps and trace events it came from. None of them is a pass or fail, and a run that reaches the goal can still have many.

Each hint has a source, because the cause differs:

- **page**: the page itself behaved this way. Focus was lost or left the page, the focused element was not visible, focus stayed outside an open dialog, a change happened that nothing announced, many navigation presses were needed to reach a control.
- **model**: the simulated user wandered (went back and forth) or stopped early, or an expectation of its own broke. This may say more about the planner than about the page.
- **run**: the run as a whole: it was slow against the fastest run, the goal already held before the first action, a new plan was needed, the user wanted to give up.

Each hint is also marked `observed` (recorded directly) or `suspected` (inferred from indirect signals, and possibly wrong). Across repeats, hints of the same kind on the same element are gathered into one finding with the number of runs it came up in. A finding that comes up once may be chance; one that comes up in most runs is worth a look.

A stuck place in particular is the user's expectation meeting the page. Rawstep can say that pressing "Add to cart" did not do what the user expected. Whether the page or the expectation is wrong is for you to decide. Every hint kind and its source are listed in the [results reference](./reference/results.md).

## Simulation and real screen readers

The default screen reader is `simulation`: a simulated VoiceOver running on Chromium. It needs nothing installed, and it is always labelled as a simulation in run records, the CLI and the dashboard (Simulated VoiceOver). It walks Chromium's accessibility tree and speaks each stop with wording drawn from reports of real VoiceOver, with assumptions where there are none. It is not VoiceOver, and a result on it is not evidence of what a real screen reader user hears.

A profile can instead run on a real VoiceOver or NVDA through an AT Driver server. That needs the screen reader and the server set up on the host, and not every action is available on every screen reader: a profile whose actions the chosen screen reader cannot do is stopped before it runs. [Screen readers](./screen-readers.md) compares the two, and the [simulator internals](../packages/screenreaders/src/mock-voiceover/README.md) list its evidence and assumptions.

None of this makes Rawstep an accessibility certification. A run tells you how one simulated first-time user fared under one set of conditions.

## Where to go next

- [Getting started](./getting-started.md): run the demo and your own task.
- [Planning](./planning.md): the plan document, cues, new plans, give-up rules and planner prompts.
- [Screen readers](./screen-readers.md): simulation against real VoiceOver and NVDA.
- [Using Rawstep in CI](./ci.md): a saved baseline, noise between repeats and exit codes.
- [Config reference](./reference/config.md): run profiles, actions, run rules and page environments.
- [Task reference](./reference/task.md): goals, context, inputs and completion checks.
- [Results reference](./reference/results.md): run folder files and every hint kind.
