# Configuration: rawstep.config.json

One file in the project directory configures Rawstep. The dashboard (`rawstep ui`), the CLI (`rawstep run`) and the `runTask` library function read the same file. `rawstep init` writes a default file; `rawstep ui` creates it if it is missing. Task JSON files keep their own contract ([task files](./task.md)).

Commit `rawstep.config.json` with your project. Keep `.rawstep/` (run output) and `.env.local` (credentials) out of git.

## Credentials

The config never contains keys. A preset provider keeps its key under a fixed environment variable (the table below); a `custom` connection may name its own in `apiKeyEnv`. Put the value in `.env.local` in the project directory (the dashboard writes it with mode 0600) or in the process environment. `.env.example` shows the format. `rawstep doctor` checks that each variable is set without printing it.

## Top-level fields

| Field | Content |
|---|---|
| `version` | Always `7`. |
| `connections` | Where models are reached: a provider preset or a custom server. The model and its effort are picked where they are used. |
| `profiles` | Run profiles: everything that changes how a run ends, under one name. At least one is required. |
| `tasks` | Registered task files, each with the profile it uses by default. |
| `project` | Settings shared by the project that never change an outcome: the analysis model and instructions, and the check-suggestion model. |
| `machine` | Settings of the computer running Rawstep. |

Unknown fields are rejected. An `id` is letters, digits, `.`, `_` or `-`, up to 100 characters. `rawstep init` writes one profile `Default` (no planner yet, the `Basic` actions, the `default` page environment, the simulated screen reader), with no connections or tasks.

An older config does not load: Rawstep stops with the code `old-config` (`version` 1 to 5) or `invalid-config` (`version` 6, which still had executors and connection kinds). Start a new project with `rawstep init` and copy the tasks over.

## Run profiles

An experiment is **task × run profile**. A task says only what to do; a run profile says who does it and how, and holds everything that changes how a run ends: who plans, what the simulated user may do, the page, the screen reader and the run rules. The profile is picked when a run starts. To compare two conditions, make two profiles that differ only in that part and run the same task with both.

| Part of a profile | What it holds |
|---|---|
| `planner` | Who plans: an LLM and its instructions, or a plan file. |
| `actions` | The keys, screen reader intents and named-input typing allowed. |
| `page` | The page environment: viewport, text size and spacing, colors, contrast, motion. |
| `screenReader` | The screen reader backend: `simulation`, `voiceover` or `nvda`. |
| `runRules` | When a run counts as stuck, and when Rawstep asks for a new plan. |

A run uses the profile picked for it (`rawstep run --profile`, or the profiles picked in the dashboard's run dialog), otherwise the project's first profile. There is no layer between Rawstep's defaults and a profile: a profile holds the full set of run rules, and `--rule` changes some of them for one run. Every run records the full content of its profile, so runs are compared by content, not by name.

Anything that changes how a run ends belongs in a profile. The analysis model does not: it explains a finished run and never changes its outcome, so it lives in `project`.

## connections[]

A connection is where language models are reached: a provider preset (fixed address and key variable), a coding-agent CLI or a custom OpenAI-compatible server. It holds no model; a profile's planner, the analysis and the check suggestions pick the model on a connection (see [profiles[]](#profiles)).

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier (letters, digits, `.`, `_`, `-`) and display name. |
| `provider` | Where the models live. One of the providers below. |
| `baseURL` | Only for `provider: custom`, and required there: the server address (HTTPS, or HTTP on this computer). |
| `apiKeyEnv` | Only for `provider: custom`: the environment variable that holds the key, if the server needs one. |
| `timeoutMs` | Request timeout, 100 to 600000 ms. |

Providers are defined once in `@rawstep/project/config` (`PROVIDERS`):

| `provider` | Address | Key variable |
|---|---|---|
| `openai` | `https://api.openai.com/v1` | `RAWSTEP_OPENAI_API_KEY` |
| `anthropic` | `https://api.anthropic.com/v1` (Anthropic's OpenAI-compatible endpoint) | `RAWSTEP_ANTHROPIC_API_KEY` |
| `google` | `https://generativelanguage.googleapis.com/v1beta/openai` | `RAWSTEP_GOOGLE_API_KEY` |
| `openrouter` | `https://openrouter.ai/api/v1` | `RAWSTEP_OPENROUTER_API_KEY` |
| `claudeCode` | runs `npx -y @agentclientprotocol/claude-agent-acp@0.89.1` | none (CLI login) |
| `codex` | runs `npx -y @agentclientprotocol/codex-acp@2.2.2` | none (CLI login) |
| `opencode` | runs `opencode acp` | none (CLI login) |
| `grok` | runs `grok agent stdio` | none (CLI login) |
| `antigravity` | runs `agy_acp_server.par` (Google's separate ACP server from the ACP registry; put its folder on `PATH`) | none (its own Google sign-in) |
| `custom` | any OpenAI-compatible server (LM Studio, Ollama, ...), `baseURL` | optional, `apiKeyEnv` |

**Coding-agent CLIs** (`claudeCode`, `codex`, `opencode`, `grok`, `antigravity`) are connections to a CLI spoken to over ACP (Agent Client Protocol, JSON-RPC over stdio) instead of an address. The CLI must be installed and logged in; its own subscription pays and there is no API key or `baseURL`. The commands are fixed in `PROVIDERS` and never read from the shared config. The two `npx` adapters are pinned and downloaded on first use, so the first call is slow. `modelId: "default"` keeps the agent's own model choice; the model list (dashboard 확인 and the model picker) starts the agent and shows `default` first. Every call runs in a fresh agent session in an empty temporary folder; file and terminal access is refused, permission requests are rejected, and the session is deleted after the call. Agents carry their own large system prompt, so each call uses more tokens and is slower than a direct API (about 4 to 13 s per call measured).

When a model's reply cannot be used (no JSON object, or the wrong shape for what was asked), Rawstep asks once more, saying what was wrong; the retry is recorded as `model-retry` policy evidence. If the second reply fails too, or the first was cut off, came from another model or echoed the key, the run ends with an error whose `run.error` event carries `modelFailure`: the kind, the schema's complaints (field paths and messages) and the model's reply, shortened. The reply is left out when it echoed the key or after text was typed into the page. Provider error text is never kept, since it can carry credentials.

Connections to one preset provider share its key. Models on an address are called through the provider's chat API with the AI SDK; coding-agent CLIs are spoken to over ACP.

```json
{ "id": "openai", "name": "OpenAI", "provider": "openai", "timeoutMs": 60000 }
```

### Coding-agent CLIs (`claudeCode`, `codex`, `opencode`, `grok`, `antigravity`)

These are spoken to over ACP, as described above. `antigravity` runs Google's ACP server `agy_acp_server.par`, a separate download from the ACP registry whose folder must be on `PATH`. It keeps its own Google sign-in, done once from the dashboard connection check's sign-in button; Rawstep never signs in on its own, and an agent without a sign-in method has to be signed in with its own CLI in a terminal. `reasoningEffort` picks how hard the agent thinks; each agent offers its own subset and an unknown value fails at run time.

```json
{ "id": "codex", "name": "Codex", "provider": "codex", "timeoutMs": 180000 }
```

## tasks[]

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier used by `rawstep run <task>`, and display name. |
| `file` | Task JSON path relative to the project. |
| `variantOf` | Optional id of the task this one is a broken version of: the same goal on a copy of its page with one accessibility defect. The dashboard lists it under that task and shows the extra moves. One level only. |
| `minimalSteps` | Optional fewest moves the goal takes, as counted or measured; results show moves against it. |
| `analysisInstructions` | Optional analysis focus that overrides `project.analysis.instructions`. |

## profiles[]

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. `--profile` accepts either. |
| `planner` | Writes the plan document that Rawstep carries out: either an LLM, `{ connectionId, modelId, reasoningEffort?, instructions }`, or a plan file, `{ planFile }` (see [File planner](#file-planner)). A profile without a planner cannot run until one is picked (`planner-model-invalid`). A new profile has none yet. |
| `actions` | What the simulated user may do (see below). |
| `page` | A built-in page environment name (`default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text`, ...) or an object. Default `"default"`. See [environment profiles](./environment-profiles.md). |
| `screenReader` | The assistive technology the run goes through. `simulation` (default): a Chromium-backed simulated screen reader, always labelled simulation in traces. `voiceover` (macOS) or `nvda` (Windows): a native screen reader reached through an AT Driver server (addresses under [machine](#machine)). Two profiles that differ only here compare the same task on a simulated and a native VoiceOver. |
| `runRules` | The run rules, in full (see [runRules](#runrules)). |

An LLM planner's `connectionId` must name an existing connection (`profile-connection-missing`), and `modelId` is the identifier sent to the provider. `reasoningEffort` is optional: a level the agent offers (only meaningful on coding-agent CLI connections); unset = the agent's default (Codex: `xhigh`, which is slow). It is also allowed on `project.analysis.model` and `project.suggestions.model`. `instructions` are added to the planner rules (see [Planner and plan](#planner-and-plan) and [prompts](./prompts.md)).

`actions` is a permissions object: `{ keys, intents, typeText, replaceText, inputKeys? }`. They list the keys and screen reader intents the simulated user may use, and whether it may type or replace text in named inputs (`inputKeys` limits which; default all of the task's). The planner is given them as the listed actions and plans with them only; each action Rawstep takes is checked against them again before it runs. An action the backend does not support (a screen reader intent the simulation or the native screen reader lacks, say) fails the run check before the browser starts. Independent verification and the named-input checks stay with the engine.

The dashboard starts screen reader profiles from a way of finding things rather than a skill level. Item by item allows `next`, `previous` and `activate`. Each of the other three adds one family of jumps: by headings (`heading.next`, `heading.previous`, `headings.list`), by form controls (`form.next`, `form.previous`, `formControls.rotor`) or by links (`link.next`, `link.previous`, `links.list`). All of them allow typing in named inputs. Changing the intents one by one makes the profile custom. Running the same task with each method shows what it costs to find the goal that way.

```json
{
  "id": "headings-voiceover",
  "name": "By headings, VoiceOver",
  "planner": { "connectionId": "openai", "modelId": "gpt-5", "instructions": "Plan like an experienced screen reader user." },
  "actions": { "keys": [], "intents": ["next", "previous", "activate", "heading.next", "heading.previous", "headings.list"], "typeText": true, "replaceText": false },
  "page": "narrow",
  "screenReader": "voiceover",
  "runRules": { "maxPlannerCalls": 60 }
}
```

## runRules

When a run stops early and when Rawstep asks the planner for a new plan. Each profile holds its own `runRules`; the `--rule <name>=<value>` option of `rawstep run` (and the `runRules` option of `runTask`) changes any of the fields for one run. Each run records the rules it ran with.

| Field | Default | Meaning |
|---|---|---|
| `repetitionGuard` | `true` | Whether a run stops as stuck when it keeps repeating itself. |
| `maxUnchangedTransitions` | 4 | The same action producing the same speech this many times in a row stops the run as stuck. |
| `maxPlannerCalls` | 40 | Planner calls a run may make: plans (the first included), questions about a heard item, and asking again after an unusable reply. A cost limit: a run that reaches it ends unmeasured (`orchestration-limit`), not as the user failing. |
| `reviewEvery` | 60 | Moves since the planner last looked before it takes stock of the effort spent (`effort-review`): keep going, change the approach, or give up. |
| `stepActionLimit` | 12 | Actions on one task without hearing anything new before a new plan is requested. Walking a page item by item, each new item resets the count. |
| `failureLimit` | 2 | Failed actions in a row on one task before a new plan is requested. |
| `noChangeLimit` | 3 | Actions in a row on one task that changed nothing before a new plan is requested. |
| `plannerHistoryLimit` | 60 | Past actions the planner is given when it plans, each with what was heard before it. Older ones are forgotten; the plan document it wrote stays. Lower it for a user who does not remember the whole page. |
| `survey` | `headings` | `headings` lists the page's headings (the VoiceOver rotor) as the first action, before the first plan, counted as a step, when the profile's actions allow `headings.list` (the dashboard's finding-by-headings user does). A user who finds things another way never lists headings, so missing headings do not slow them down, while they do slow one who finds things by headings. `none` never surveys. Native VoiceOver lists them through the rotor (VO+U; not yet checked against a live VoiceOver); NVDA cannot list headings in Rawstep yet. |
| `confirmationGrace` | 5 | Screen reader runs: when the goal is reached but nothing the user heard said so (shown, not announced), the run goes on this many actions before it ends. Those actions are the user's not knowing whether it worked; `goal.reached` in the trace records the step and whether it was heard. 0 ends at once. |

A field a profile leaves out takes the default above. An override for one run changes only the fields it names.

```json
{ "repetitionGuard": true, "maxUnchangedTransitions": 4, "maxPlannerCalls": 40, "reviewEvery": 60, "stepActionLimit": 12, "failureLimit": 2, "noChangeLimit": 3, "plannerHistoryLimit": 60, "survey": "headings", "confirmationGrace": 5 }
```

## Example

A complete `rawstep.config.json` with a connection, a profile and the project analysis model:

```json
{
  "version": 7,
  "connections": [
    { "id": "openai", "name": "OpenAI", "provider": "openai", "timeoutMs": 60000 }
  ],
  "profiles": [
    {
      "id": "narrow-screenreader", "name": "Narrow page, screen reader",
      "planner": { "connectionId": "openai", "modelId": "gpt-5", "instructions": "Plan like an experienced screen reader user." },
      "actions": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": false, "replaceText": false },
      "page": "narrow",
      "screenReader": "voiceover",
      "runRules": { "maxPlannerCalls": 60 }
    }
  ],
  "tasks": [
    { "id": "checkout", "name": "Checkout", "file": "tasks/checkout.json" }
  ],
  "project": {
    "analysis": { "model": { "connectionId": "openai", "modelId": "gpt-5-mini" }, "instructions": "Focus on where the page made the run detour." },
    "suggestions": {}
  },
  "machine": { "atEndpoints": { "voiceover": "", "nvda": "" }, "browserExecutablePath": "", "headless": true, "personCheck": false }
}
```

## Planner and plan

A run always plans. The planner (an LLM, or a [plan file](#file-planner)) writes a **plan document**, and Rawstep carries out each of its tasks exactly as written. No model picks individual actions: every judgement is the planner's and the cue's, a run costs only planner calls, and repeats vary less.

The plan document has:

- **Success criteria** (C1, C2, ...): what the user must be able to hear for the goal to count as reached, each marked unchecked, met or unmet.
- **Strategy and assumptions**: one sentence on the approach, and assumptions (A1, A2, ...) taken from common UI conventions, each marked unchecked, held or broken.
- **Phases and numbered tasks** (1, 1.1, 1.2, ...): each task has a goal, a completion cue (the words the user should hear, with the role and state when the planner can tell them), how it is carried out (below), the criteria it serves and the assumptions it relies on. A task is waiting, in progress, done, abandoned or failed, and records how many actions it took. The current task is always marked.
- **Versions and history**: planning again revises the document. Finished tasks stay as they are, abandoned ones are kept with the reason, the version goes up, and the history says what triggered the change, which assumption was wrong and what changed.

### Carrying out a task

Each task is one of three kinds:

- **Moving** (`activates: false`): Rawstep repeats the task's first listed move (`moves`, for example `["heading.next"]`; item by item with `next` when it names none) until the cue is heard. One method and one direction per task: to change either, the planner starts a new task. A list the task already opened (`formControls.rotor`) is not opened again.
- **Pressing** (`activates: true`): Rawstep presses the item the cursor is on, so the tasks before it bring the cursor there.
- **Typing** (`types: "<input name>"`): Rawstep presses the field the cursor is on, which gives it focus, types that named input's value and the task is done. The planner knows the task's input names (and their descriptions), never the values; a typing task has no `moves` and an empty cue, since what the field says after typing cannot be predicted. The profile's `actions` must allow typing into that input.

A task whose action the profile does not allow ends the run as not measured. Each action Rawstep takes is recorded as `orchestration-follow` policy evidence: the task and plan version, the actions that were allowed and the one taken.

A moving or pressing task ends when its cue is heard after one of its own actions. A cue is written before the item is heard, so its wording is a guess: when the cursor lands on an item that shares words with the cue without matching it, the planner is asked once per item whether it is the item the cue meant (`orchestration-cue`, `recognized` or `not-recognized`). A plan file cannot be asked, so there only a cue heard as written ends a task. When all tasks of a phase are done, the planner checks the phase's criteria at a **checkpoint**; when no tasks are left, it makes a final check and may declare the run complete.

Rawstep asks for a new plan at a checkpoint or final check, and when the current task looks stuck: `failureLimit` failed actions in a row, `noChangeLimit` actions in a row that changed nothing (or the same speech over and over), `stepActionLimit` actions on one task without hearing anything new, or the cursor swinging between the same two items (four actions in a row). It also asks when the user hears an item named as in the goal for the first time while the task is after something else (`goal-heard`), and after `reviewEvery` moves since the planner last looked (`effort-review`). The planner is given only what a person could hear, the actions the profile allows (input names, never secret values) and the attempts per task, each with its result (`ok`, and for a failure the code `not-editable` or `backend`, never the raw error text) and whether the speech changed afterwards (`changed`). It never sees the accessibility tree.

### How a run ends

A screen reader run asks whether a user who has never seen the page can do the task, and at what cost. It ends in one of three ways, each reported with what it cost (moves, detours, where the plan changed):

- **Reached**: the run's checks hold. The planner may also declare the goal reached (`planner`); independent verification still decides.
- **The user gave up** (`user-gave-up`): at a point where it looks again at the plan, the planner decides that nothing heard leaves another approach to try and sets `giveUp` with the assumptions it marked broken (the approaches that failed). A give-up that names no broken assumption is refused, recorded as a `wanted-to-give-up` hint, and the planner is asked again: many moves alone are not a reason.
- **Not measured** (`orchestration-limit`, `maxSteps`, timeout): a cost limit came first, so whether the task can be done is not known.

The planner is told the effort spent in moves (`effort`: in all, since it last looked, and in a row without hearing any word of the goal). Rawstep sets no patience: each run records the longest stretch without a word of the goal (`goal-word-stretch`; a goal word said on more than three different items, like "Add … to cart" on every card, stops counting), and whoever reads the results decides how long a user would keep going. Each assumption the planner marks broken is recorded as an `expectation-broken` hint. When the user pressed something in the last three actions, the hint is on that object (`pressed`): it did not respond as expected, and the dashboard gathers these across runs as the places users got stuck, pinned on a screenshot of the whole start page. One broken while moving was a guess about where something is; it is counted per run (wrong location guesses) rather than placed on an object. The simulated screen reader scrolls its cursor into view, as VoiceOver does, and records where it was for the step screenshots; none of this reaches a model. Moves, not time: time depends on the models. The repetition guard (`exploration-guard`) still stops a run that keeps hearing the same speech before the first plan. Each screen reader run directory also holds `plan.json` and `plan.md` (checkbox form, for people), and the dashboard shows the plan live. Plans, task changes and the reason for each new plan are saved as policy evidence in the trace.

New plans after failing, unchanging or swinging actions (`replan`), tasks that ran long without hearing anything new (`task-limit`) and broken assumptions (`expectation-broken`) are friction hints. They point at where a run needed to think again and do not say why: the page may have been hard, or the plan wrong.

`planner.instructions` are added to Rawstep's planner rules (plan document format, plan only from what was heard and with the listed actions), never replacing them. Do not put page knowledge in them that a real user would not have, such as where a button is: that hides the friction Rawstep measures. Strategy or user-type guidance ("plan like an experienced screen reader user") is fine. Planner instructions are fingerprinted (sha256) in the plan evidence.

### File planner

Instead of a planner model, a profile can read a plan written beforehand: `"planner": { "planFile": "plans/{task}/plan.json" }`. The path is relative to the project and must end in `.json`. `{task}` becomes the task file's name without `.json`, so one profile gives every task its own plan (`plans/{task}/L2.json` for a task file `tasks/checkout.json` reads `plans/checkout/L2.json`).

The file has the planner's draft format: `strategy`, `criteria` (`C1`...), `assumptions` (`A1`...) and `phases` of `tasks`, each with `goal`, `done` and `cue` (the words the user should hear when it is finished: a string, or `{ name, role?, state? }`), how it is carried out (`activates`, `moves`, `types`, see [Carrying out a task](#carrying-out-a-task)), and optionally `serves` and `relies`. `complete` and `rationale` are optional.

```json
{
  "strategy": "Find the product, add it to the cart, then open the cart.",
  "criteria": [{ "id": "C1", "text": "The user hears that the item is in the cart." }],
  "assumptions": [{ "id": "A1", "text": "The product page has an \"Add to cart\" button." }],
  "phases": [{ "title": "Add the product", "criteria": ["C1"], "tasks": [
    { "goal": "Move to the 'Add to cart' button", "done": "The user hears \"Add to cart, button\"", "cue": { "name": "Add to cart", "role": "button" }, "activates": false, "moves": ["next"], "serves": ["C1"], "relies": ["A1"] },
    { "goal": "Activate the 'Add to cart' button", "done": "The user hears that the item was added", "cue": "added to cart", "activates": true, "serves": ["C1"] }
  ] }]
}
```

The plan never changes during a run. Where Rawstep would ask for a new plan, the stuck task is recorded as abandoned and the next task starts. Use it to run plans written by a person, to run a plan saved from a planner model again, and in experiments that hold the plan fixed while the actions or environment vary.

## project

Settings shared by the project that never change a run's outcome.

| Field | Meaning |
|---|---|
| `analysis.model` | Optional `{ connectionId, modelId, reasoningEffort? }` on a connection. When set, an LLM analysis is added to every run (`rawstep run`, `runTask` and the dashboard). Without it only the rule-based analysis runs, which always does. A missing key skips the analysis and never blocks a run. |
| `analysis.instructions` | Optional analysis focus. A task's `analysisInstructions` override it. |
| `suggestions.model` | Optional `{ connectionId, modelId, reasoningEffort? }` on a connection that suggests completion checks while a task is written. The analysis model is used when unset. |

## machine

Settings of this computer, not of an experiment.

| Field | Meaning |
|---|---|
| `atEndpoints` | `{ voiceover, nvda }`: AT Driver WebSocket URLs of the native screen readers. Empty (the default) means the usual address of that screen reader's server: `ws://localhost:4382/session` for VoiceOver (Bocoup macOS server) and `ws://localhost:3031/session` for NVDA (PAC server). Loopback only. The simulation uses none. |
| `browserExecutablePath` | Optional path to a trusted Chromium. Empty uses the bundled one. |
| `browserEndpoint` | Optional address of a Chrome you started yourself with `--remote-debugging-port` (for example `http://localhost:9222`). Runs connect to it instead of launching a browser, so sites see an ordinary browser (not headless, `navigator.webdriver` false) and bot detection fires less. Loopback only. Each run uses its own isolated context in that Chrome and only disconnects at the end, so cookies from its normal tabs are not shared. `browserExecutablePath`, `headless` and proxy settings do not apply; combine with `personCheck` if a person should pass human checks in that window. Chrome only opens the port with a separate profile: `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.rawstep-chrome"`. |
| `headless` | Run the browser without a window (default true). |
| `personCheck` | For real sites with a human check (Cloudflare and the like). Runs use a visible Chrome with a profile kept in `.rawstep/browser-profile`. When a check appears, the run pauses until a person passes it in that window (up to 5 minutes; the wait does not count against the time limit). Rawstep never answers a check itself. Default `false`. |

### Starting the AT Driver server

If no AT Driver server answers at the address, Rawstep can start one with a command. The command is stored only in this computer's `.env.local`, never in `rawstep.config.json`, because it runs a program:

```dotenv
# .env.local (never commit)
RAWSTEP_AT_DRIVER_COMMAND=YOUR_SERVER_START_COMMAND
```

Rawstep starts it, waits until the address accepts connections and stops the server after the run. A server that already answers is used as it is. The screen reader itself and the OS permissions it needs remain yours to set up.

See [simulation limits](./mock-voiceover.md).
