# Configuration: rawstep.config.json

One file in the project directory configures Rawstep. The dashboard (`rawstep ui`), the CLI (`rawstep run`) and the `runTask` library function read the same file. `rawstep init` writes a default file; `rawstep ui` creates it if it is missing. Task JSON files keep their own contract ([task files](./task.md)).

Commit `rawstep.config.json` with your project. Keep `.rawstep/` (run output) and `.env.local` (credentials) out of git.

## Credentials

The config never contains keys. A preset provider keeps its key under a fixed environment variable (the table below); a `custom` connection may name its own in `apiKeyEnv`. Put the value in `.env.local` in the project directory (the dashboard writes it with mode 0600) or in the process environment. `.env.example` shows the format. `rawstep doctor` checks that each variable is set without printing it.

## Top-level fields

| Field | Content |
|---|---|
| `version` | Always `3`. |
| `connections` | Where models are reached: a provider preset or a custom server. |
| `tasks` | Registered task files, with the experiment conditions each uses by default. |
| `combos` | Model combos: who plans and who acts. At least one is required. |
| `actionSets` | Action sets: what the simulated user may do. At least one is required. |
| `pageEnvironments` | Page conditions (viewport, text, colors). At least one is required. |
| `atEnvironments` | Assistive technology: the simulation, VoiceOver or NVDA. At least one is required. |
| `presets` | Saved bundles of the conditions above. Optional. |
| `runRules` | The project's default run rules. |
| `project` | Settings shared by the project that never change an outcome: the analysis model and instructions, and the check-suggestion model. |
| `machine` | Settings of the computer running Rawstep. |

Unknown fields are rejected. An `id` is letters, digits, `.`, `_` or `-`, up to 100 characters. `rawstep init` writes one model combo `Default` (no executors yet), one action set `Basic`, one page environment `Default` (`profile: "default"`) and one assistive technology `Simulated VoiceOver` (the simulation), with no connections or tasks.

An older config (`version` 1 or 2) does not load: Rawstep stops with the code `old-config`. Convert it once from the Rawstep checkout with `node scripts/migrate-config.mjs <project-dir>`. It also converts the dashboard's run records in `.rawstep/experiments/*/experiment.json` and keeps a `.bak` copy of each original file.

## Experiment conditions

An experiment is **task × model combo × action set × page environment × assistive technology × mode**. Each condition is a shared list in the config, so you compare runs by changing one condition at a time:

| Condition | What it holds |
|---|---|
| model combo (`combos`) | The structure (a model alone, or a planner plus an executor), the planner and its instructions, the executor of each mode and its instructions, and an optional analysis model. |
| action set (`actionSets`) | The keys, screen reader intents and named-input typing allowed in each mode. |
| page environment (`pageEnvironments`) | Viewport, text size and spacing, colors, contrast, motion. |
| assistive technology (`atEnvironments`) | The screen reader backend: `simulation`, `voiceover` or `nvda`. |
| run rules (`runRules`) | When a run counts as stuck, and when a planned run plans again. |

A preset bundles some of them. The conditions a run uses are picked in this order: the task's own field, then the task's preset, then the first shared item of the list. Run rules layer the same way: project defaults, then the preset's, then the task's. `rawstep run` options (`--combo`, `--actions`, `--environment`, `--at`, `--preset`, `--rule`) override these for that run. Every run records the full content of the conditions it used (and which shared item a task-only copy came from), so runs are compared by content, not by name.

Anything that changes how a run ends is a condition. The analysis model is not: it explains a finished run and never changes its outcome.

## connections[]

A connection is where models are reached: a provider preset (fixed address and key variable) or a custom server. It holds no model; a model combo picks the model on a connection (see [combos[]](#combos)).

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier (letters, digits, `.`, `_`, `-`) and display name. |
| `kind` | `llm`: a language model that reads the situation and picks a candidate (runs, planners, post-run analysis, completion-check suggestions). `decision`: a model that answers with a probability for every candidate (runs only; fast and cheap). |
| `provider` | Where the models live. One of the providers of its `kind`, see below. |
| `baseURL` | Only for `provider: custom`, and required there: the server address (HTTPS, or HTTP on this computer). |
| `apiKeyEnv` | Only for `provider: custom`: the environment variable that holds the key, if the server needs one. |
| `timeoutMs` | Request timeout, 100 to 600000 ms. |

Providers are defined once in `@rawstep/project/config` (`PROVIDERS`):

| `kind` | `provider` | Address | Key variable |
|---|---|---|---|
| `llm` | `openai` | `https://api.openai.com/v1` | `RAWSTEP_OPENAI_API_KEY` |
| `llm` | `anthropic` | `https://api.anthropic.com/v1` (Anthropic's OpenAI-compatible endpoint) | `RAWSTEP_ANTHROPIC_API_KEY` |
| `llm` | `google` | `https://generativelanguage.googleapis.com/v1beta/openai` | `RAWSTEP_GOOGLE_API_KEY` |
| `llm` | `openrouter` | `https://openrouter.ai/api/v1` | `RAWSTEP_OPENROUTER_API_KEY` |
| `llm` | `claudeCode` | runs `npx -y @agentclientprotocol/claude-agent-acp@0.89.1` | none (CLI login) |
| `llm` | `codex` | runs `npx -y @agentclientprotocol/codex-acp@2.2.2` | none (CLI login) |
| `llm` | `opencode` | runs `opencode acp` | none (CLI login) |
| `llm` | `grok` | runs `grok agent stdio`, no images | none (CLI login) |
| `llm` | `antigravity` | runs `agy_acp_server.par` (Google's separate ACP server from the ACP registry; put its folder on `PATH`) | none (its own Google sign-in) |
| `llm` | `custom` | any OpenAI-compatible server (LM Studio, Ollama, ...), `baseURL` | optional, `apiKeyEnv` |
| `decision` | `typesafe` | `https://api.typesafe.ai/v1` (`POST /v1/systemone`) | `RAWSTEP_TYPESAFE_API_KEY` |
| `decision` | `gateway` | Vercel AI Gateway, called through the AI SDK's gateway provider; text only | `RAWSTEP_AI_GATEWAY_API_KEY` |
| `decision` | `openrouter` | `https://openrouter.ai/api/v1` (`POST /api/v1/systemone`) | `RAWSTEP_OPENROUTER_API_KEY` (shared with `llm`) |
| `decision` | `custom` | any `/systemone`-compatible server, `baseURL` | optional, `apiKeyEnv` |

**Coding-agent CLIs** (`claudeCode`, `codex`, `opencode`, `grok`, `antigravity`) are connections to a CLI spoken to over ACP (Agent Client Protocol, JSON-RPC over stdio) instead of an address. The CLI must be installed and logged in; its own subscription pays and there is no API key or `baseURL`. The commands are fixed in `PROVIDERS` and never read from the shared config. The two `npx` adapters are pinned and downloaded on first use, so the first call is slow. `modelId: "default"` keeps the agent's own model choice; the model list (dashboard 확인 and the model picker) starts the agent and shows `default` first. Grok takes no images, so it only fits screen-reader mode and analysis. Every decision runs in a fresh agent session in an empty temporary folder; file and terminal access is refused, permission requests are rejected, and the session is deleted after the call. Agents carry their own large system prompt, so each call uses more tokens and is slower than a direct API (about 4 to 13 s per decision measured).

Connections to one preset provider share its key. `llm` models call the provider's chat API through the AI SDK. `decision` models call the AI SDK's experimental `decide` API: an in-house adapter for the `/systemone` protocol serves `typesafe`, `openrouter` and `custom`, and the AI SDK's gateway provider serves `gateway` (see [SystemOne decisions](./systemone.md)). Keyboard mode sends images, so it needs an `llm` with image input or a `decision` model on `typesafe`, `openrouter` or `custom`.

```json
{ "id": "jev", "name": "Jev", "kind": "decision", "provider": "typesafe", "timeoutMs": 60000 }
```

### Coding-agent CLIs (`claudeCode`, `codex`, `opencode`, `grok`, `antigravity`)

These are spoken to over ACP, as described above. `antigravity` runs Google's ACP server `agy_acp_server.par`, a separate download from the ACP registry whose folder must be on `PATH`. It keeps its own Google sign-in, done once from the dashboard connection check's sign-in button; Rawstep never signs in on its own, and an agent without a sign-in method has to be signed in with its own CLI in a terminal. `reasoningEffort` picks how hard the agent thinks; each agent offers its own subset and an unknown value fails at run time.

```json
{ "id": "codex", "name": "Codex", "kind": "llm", "provider": "codex", "timeoutMs": 180000 }
```

## tasks[]

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier used by `rawstep run <task>`, and display name. |
| `file` | Task JSON path relative to the project. |
| `presetId` | Optional preset the task starts from. |
| `comboId`, `actionSetId`, `pageEnvironmentId`, `atEnvironmentId` | Optional conditions the task uses by default, each over the preset's. |
| `runRules` | Optional run rules for this task only, over the project's and the preset's (see [runRules](#runrules)). |
| `analysisInstructions` | Optional analysis focus that overrides `project.analysis.instructions`. |

A condition a task and its preset leave out is the first shared item of that list. Editing a shared item from a task in the dashboard makes a task-only copy (the item gets `owner` set to the task id and `copiedFrom` set to the shared item it came from) and leaves the shared item as it was. Task-only copies are used only by their task and are deleted with it. Task-only copies exist for model combos, action sets and page environments.

## combos[]

A model combo says which models act. It is an experiment condition: to compare models or instructions, compare combos that differ only in that part.

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. `--combo` accepts either. |
| `structure` | `solo` (default): the executor of the mode decides every action. `planned`: a planner LLM writes a plan document and the executor carries out one task at a time. |
| `planner` | Required when `structure` is `planned`; screen reader mode only for now. Either an LLM, `{ connectionId, modelId, reasoningEffort?, instructions }` (the connection must be an `llm`), or a plan file, `{ planFile }` (see [File planner](#file-planner)). |
| `executors` | `{ screenreader?, keyboard? }`. The model that picks each action in that mode, with its instructions (see below). A mode without an executor cannot run with this combo. In a planned combo the screen reader executor may be `{ "followPlan": true }` instead: no executor model, Rawstep carries out the plan as written (a pressing task presses, a moving task uses its first move), so every judgement is the planner's and the cue's, a run costs only planner calls, and repeats vary less. It only moves and presses, so a task whose action set types into inputs is rejected before the run. The dashboard picks this for a new planned combo. |
| `analysis` | Optional `{ connectionId, modelId, reasoningEffort? }` of an `llm` connection that explains this combo's runs. Without it, `project.analysis.model` is used. |
| `owner`, `copiedFrom` | Set on task-only copies; leave them out otherwise. |

An executor is `{ connectionId, modelId, reasoningEffort?, inputs, maxChoices, maxImages, instructions, historyLimit, focusGate, latitude }`:

| Field | Meaning |
|---|---|
| `connectionId`, `modelId` | The connection, and the identifier sent to the provider. |
| `reasoningEffort` | Optional. A level the agent offers (only meaningful on coding-agent CLI connections); unset = the agent's default (Codex: `xhigh`, which is slow). Also allowed on a combo's `planner` and `analysis`, and on `project.analysis.model` and `project.suggestions.model`. |
| `inputs` | `["text"]` or `["text", "image"]`. |
| `maxChoices`, `maxImages` | The candidate and image limits (defaults 255 and 2). |
| `instructions` | The executor prompt (required), see [prompts](./prompts.md). |
| `historyLimit` | How many past steps the model sees (default 12). |
| `focusGate` | Keyboard mode with a `decision` model only (default `false`): a separate focus judgement narrows the candidates before each action. An `llm` executor with `focusGate` is rejected before the run. |
| `latitude` | Screen reader runs of a planned combo (default `none`): how much the executor decides inside a task. `none`: the plan fixes the method, direction and when to press. `direction`: a task moves to its target and presses it, and the executor may also go back the same way. `method`: the executor may use any movement. The planner shapes its tasks to match. |

A keyboard executor needs image input and a `maxImages` of at least 2; a screen reader executor needs text input. A combo's `analysis` and `planner` must be on `llm` connections, and every executor must name an existing connection.

```json
{
  "id": "plan-and-jev",
  "name": "Plan with GPT, act with Jev",
  "structure": "planned",
  "planner": { "connectionId": "openai", "modelId": "gpt-5", "instructions": "Plan like an experienced screen reader user." },
  "executors": {
    "screenreader": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text"], "maxChoices": 255, "maxImages": 0, "instructions": "Reach the goal with the actions you are allowed.", "historyLimit": 12, "focusGate": false },
    "keyboard": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text", "image"], "maxChoices": 255, "maxImages": 2, "instructions": "Reach the goal with the keys you are allowed.", "historyLimit": 12, "focusGate": false }
  }
}
```

## actionSets[]

An action set is what the simulated user may do, per mode. It is an experiment condition (a beginner who only moves next and previous, an expert who jumps by headings and form controls).

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. `--actions` accepts either. |
| `keyboard`, `screenreader` | A permissions object for each mode: `{ keys, intents, typeText, replaceText, inputKeys? }`. The keys and screen reader intents the model may choose, and whether it may type or replace text in named inputs (`inputKeys` limits which; default all of the task's). |
| `owner`, `copiedFrom` | Set on task-only copies. |

Permissions apply to the candidates the model is offered and are checked again before an action runs. An action the backend does not support (a screen reader intent the simulation or the native screen reader lacks, say) fails the run check before the browser starts. Stop choices, independent verification and the named-input checks stay with the engine.

```json
{ "id": "basic", "name": "Basic", "keyboard": { "keys": ["Tab", "Shift+Tab", "Enter", "Space"], "intents": [], "typeText": false, "replaceText": false }, "screenreader": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": false, "replaceText": false } }
```

## pageEnvironments[]

A page environment is the page condition a task runs in.

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. `--environment` accepts either. |
| `profile` | A built-in environment profile name (`default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text`, ...) or an object. See [environment profiles](./environment-profiles.md). |
| `owner`, `copiedFrom` | Set on task-only copies. |

```json
{ "id": "narrow", "name": "Narrow", "profile": "narrow" }
```

## atEnvironments[]

The assistive technology a screen reader run goes through. Keyboard runs never use it.

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. `--at` accepts either. |
| `backend` | `simulation`: a Chromium-backed simulated screen reader, always labelled simulation in traces. `voiceover` (macOS) or `nvda` (Windows): a native screen reader reached through an AT Driver server (addresses under [machine](#machine)). |

Having a simulated and a native VoiceOver as two assistive technologies lets you compare the same task on both.

```json
{ "id": "voiceover", "name": "VoiceOver", "backend": "voiceover" }
```

## presets[]

A preset is a saved set of conditions, picked as one. Every field is optional: what it leaves out falls back to the first shared item.

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. `--preset` accepts either. |
| `comboId`, `actionSetId`, `pageEnvironmentId`, `atEnvironmentId` | The conditions it bundles. |
| `runRules` | Optional run rules for runs that use the preset. |

```json
{ "id": "narrow-beginner", "name": "Beginner on a narrow page", "actionSetId": "basic", "pageEnvironmentId": "narrow", "runRules": { "maxStateVisits": 3 } }
```

## runRules

When a run stops early and, with a planner, when it plans again. The top-level `runRules` holds the project's defaults; a preset's `runRules`, a task's `runRules` and the `--rule <name>=<value>` option overrides any of the fields for one run. Each run records the rules it ran with.

| Field | Default | Meaning |
|---|---|---|
| `repetitionGuard` | `auto` | `auto`: on in screen reader mode and for `llm` executors in keyboard mode, off for `decision` executors in keyboard mode. `on` or `off` forces it. |
| `maxStateVisits` | 5 | Keyboard mode: visits to the same screen before the run stops as stuck. |
| `maxUnchangedTransitions` | 4 | The same action producing the same speech or screen this many times in a row stops the run as stuck. |
| `modelGiveUp` | `false` | Whether the executor may end a run by choosing `stop:stuck` or `stop:uncertain`. Off, the model is offered only `stop:success`, and a run ends at the goal, a limit or a guard. |
| `maxReplans` | 4 | With a planner: corrections of the plan before the run stops (checkpoints do not count). |
| `stepActionLimit` | 12 | With a planner: actions on one task without hearing anything new before a new plan is requested. Walking a page item by item, each new item resets the count; one task never runs past three times this. |
| `failureLimit` | 2 | With a planner: failed actions in a row on one task before a new plan is requested. |
| `noChangeLimit` | 3 | With a planner: actions in a row on one task that changed nothing before a new plan is requested. |
| `taskControl` | `rawstep` | With a planner: who ends tasks and asks for new plans. `rawstep`: the executor only picks actions; a task ends when its cue is heard, and Rawstep's own signals (the limits above, repetition, and low executor confidence, see `confidenceFloor`) ask for a new plan. `executor`: the executor may also claim a task is done or ask for help; kept for comparison. |
| `survey` | `headings` | With a planner: `headings` lists the page's headings (the VoiceOver rotor) as the first action, before the first plan, counted as a step, when the action set allows `headings.list` (the dashboard's practised-user set does). A novice set never lists headings and walks from the top, so missing headings do not slow it down, while they do slow a practised user. `none` never surveys. Native VoiceOver lists them through the rotor (VO+U; not yet checked against a live VoiceOver); NVDA cannot list headings in Rawstep yet. |
| `confirmationGrace` | 5 | Screen reader runs: when the goal is reached but nothing the user heard said so (shown, not announced), the run goes on this many actions before it ends. Those actions are the user's not knowing whether it worked; `goal.reached` in the trace records the step and whether it was heard. 0 ends at once. |
| `confidenceFloor` | 0.25 | With `taskControl: "rawstep"`: how unsure the executor may be before Rawstep asks for a new plan. Normalised: how far the top probability is from a uniform guess (1/n for n choices) towards certainty (1). Two low choices in a row ask for a new plan. |

Overrides never fill in defaults: a field a preset or a task leaves out keeps the layer below.

```json
{ "repetitionGuard": "auto", "maxStateVisits": 5, "maxUnchangedTransitions": 4, "modelGiveUp": false, "maxReplans": 4, "stepActionLimit": 12, "failureLimit": 2, "noChangeLimit": 3, "taskControl": "rawstep", "confidenceFloor": 0.25, "survey": "headings", "confirmationGrace": 5 }
```

## Example

A complete `rawstep.config.json` with two connections, a solo and a planned combo, a preset, and the project analysis model:

```json
{
  "version": 3,
  "connections": [
    { "id": "openai", "name": "OpenAI", "kind": "llm", "provider": "openai", "timeoutMs": 60000 },
    { "id": "jev", "name": "Jev", "kind": "decision", "provider": "typesafe", "timeoutMs": 60000 }
  ],
  "tasks": [
    { "id": "checkout", "name": "Checkout", "file": "tasks/checkout.json", "presetId": "narrow-planned" }
  ],
  "combos": [
    {
      "id": "jev-alone", "name": "Jev alone", "structure": "solo",
      "executors": {
        "screenreader": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text"], "maxChoices": 255, "maxImages": 0, "instructions": "Reach the goal with the actions you are allowed.", "historyLimit": 12, "focusGate": false }
      }
    },
    {
      "id": "plan-and-jev", "name": "Plan with GPT, act with Jev", "structure": "planned",
      "planner": { "connectionId": "openai", "modelId": "gpt-5", "instructions": "Plan like an experienced screen reader user." },
      "executors": {
        "screenreader": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text"], "maxChoices": 255, "maxImages": 0, "instructions": "Reach the goal with the actions you are allowed.", "historyLimit": 12, "focusGate": false },
        "keyboard": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text", "image"], "maxChoices": 255, "maxImages": 2, "instructions": "Reach the goal with the keys you are allowed.", "historyLimit": 12, "focusGate": false }
      }
    }
  ],
  "actionSets": [
    { "id": "basic", "name": "Basic",
      "keyboard": { "keys": ["Tab", "Shift+Tab", "Enter", "Space"], "intents": [], "typeText": false, "replaceText": false },
      "screenreader": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": false, "replaceText": false } }
  ],
  "pageEnvironments": [
    { "id": "default", "name": "Default", "profile": "default" },
    { "id": "narrow", "name": "Narrow", "profile": "narrow" }
  ],
  "atEnvironments": [
    { "id": "simulation", "name": "Simulated VoiceOver", "backend": "simulation" },
    { "id": "voiceover", "name": "VoiceOver", "backend": "voiceover" }
  ],
  "presets": [
    { "id": "narrow-planned", "name": "Narrow page, planned", "comboId": "plan-and-jev", "pageEnvironmentId": "narrow", "runRules": { "maxReplans": 6 } }
  ],
  "runRules": { "repetitionGuard": "auto", "maxStateVisits": 5, "maxUnchangedTransitions": 4, "modelGiveUp": false, "maxReplans": 4, "stepActionLimit": 12, "failureLimit": 2, "noChangeLimit": 3 },
  "project": {
    "analysis": { "model": { "connectionId": "openai", "modelId": "gpt-5-mini" }, "instructions": "Focus on where the page made the run detour." },
    "suggestions": {}
  },
  "machine": { "atEndpoints": { "voiceover": "", "nvda": "" }, "browserExecutablePath": "", "headless": true, "personCheck": false }
}
```

## Planner and executor (orchestration)

With `structure: "planned"`, a screen reader run is split in two. The planner LLM writes a **plan document** and the executor carries it out one task at a time. Keyboard runs do not use the planner yet (the check warns and the keyboard executor decides alone).

The plan document has:

- **Success criteria** (C1, C2, ...): what the user must be able to hear for the goal to count as reached, each marked unchecked, met or unmet.
- **Strategy and assumptions**: one sentence on the approach, and assumptions (A1, A2, ...) taken from common UI conventions, each marked unchecked, held or broken.
- **Phases and numbered tasks** (1, 1.1, 1.2, ...): each task has a goal, a completion cue (the exact words are quoted when they can be predicted), the criteria it serves and the assumptions it relies on. A task is waiting, in progress, done, abandoned or failed, and records how many actions it took. The current task is always marked.
- **Versions and history**: planning again revises the document. Finished tasks stay as they are, abandoned ones are kept with the reason, the version goes up, and the history says what triggered the change, which assumption was wrong and what changed.

The executor sees the plan summary, its current task with the completion cue and its attempts on it, and can choose an action, **task done**, or **ask for help** with a reason: `no-cue` (no sign of completion can be found), `no-effect` (actions have no effect) or `already-done` (it seems done already). When the executor says a task is done, Rawstep checks whether the quoted words of the cue were heard now or just before; the result (`heard`, `not-heard`, `unchecked`) is recorded and shown to the planner, and the task moves on. When all tasks of a phase are done, the planner checks the phase's criteria at a **checkpoint**; when no tasks are left, it makes a final check and may declare the run complete.

The planner plans again when the executor asks for help, at a checkpoint or final check, and when the run rules say so: `failureLimit` failed actions in a row, `noChangeLimit` actions in a row that changed nothing, or `stepActionLimit` actions on one task. It is given only what a person could hear, the actions the executor may use (input names, never secret values) and the attempts per task, never the accessibility tree.

A run stops with one of these sources, kept distinct in the trace: `model` (the executor), `planner` (the planner declared the goal reached; independent verification still decides), `exploration-guard` (the repetition guard) or `orchestration-limit` (more than `maxReplans` plans). Each run directory of a planned combo also holds `plan.json` and `plan.md` (checkbox form, for people), and the dashboard shows the plan live. Plans, task changes and the reason for each new plan are saved as policy evidence in the trace.

Replans, help requests, abandoned tasks, tasks whose cue was not heard, broken assumptions and unmet criteria are friction hints (`replan`, `help-request`, `task-limit`, `unverified-done`). They point at where a run needed to think again and do not say why: the page may have been hard, or the plan wrong.

`planner.instructions` are added to Rawstep's planner rules (plan document format, plan only from what was heard and with the listed actions), never replacing them. Do not put page knowledge in them that a real user would not have, such as where a button is: that hides the friction Rawstep measures. Strategy or user-type guidance ("plan like an experienced screen reader user") is fine. Planner instructions are fingerprinted (sha256) in the plan evidence.

### File planner

Instead of a planner model, a combo can read a plan written beforehand: `"planner": { "planFile": "plans/{task}/plan.json" }`. The path is relative to the project and must end in `.json`. `{task}` becomes the task file's name without `.json`, so one combo gives every task its own plan (`plans/{task}/L2.json` for a task file `tasks/checkout.json` reads `plans/checkout/L2.json`).

The file has the planner's draft format: `strategy`, `criteria` (`C1`...), `assumptions` (`A1`...) and `phases` of `tasks`, each with `goal`, `done` and `cue` (the words the user should hear when it is finished), and optionally `serves` and `relies`. `complete` and `rationale` are optional.

```json
{
  "strategy": "Find the product, add it to the cart, then open the cart.",
  "criteria": [{ "id": "C1", "text": "The user hears that the item is in the cart." }],
  "assumptions": [{ "id": "A1", "text": "The product page has an \"Add to cart\" button." }],
  "phases": [{ "title": "Add the product", "criteria": ["C1"], "tasks": [
    { "goal": "Move to the 'Add to cart' button", "done": "The user hears \"Add to cart, button\"", "cue": "Add to cart, button", "serves": ["C1"], "relies": ["A1"] },
    { "goal": "Activate the 'Add to cart' button", "done": "The user hears that the item was added", "cue": "added to cart", "serves": ["C1"] }
  ] }]
}
```

The plan never changes during a run. Where Rawstep would ask for a new plan, the stuck task is recorded as abandoned and the next task starts. Use it to run plans written by a person, to run a plan saved from a planner model again, and in experiments that hold the plan fixed while the executor, actions or environment vary.

The model's action history includes each action's execution result (`ok`, and for a failure the code `not-editable` or `backend`, never the raw error text) and whether the speech or screenshot changed afterwards (`changed`).

## project

Settings shared by the project that never change a run's outcome.

| Field | Meaning |
|---|---|
| `analysis.model` | Optional `{ connectionId, modelId, reasoningEffort? }` of an `llm` connection. When set (and the combo has no `analysis` of its own), an LLM analysis is added to every run (`rawstep run`, `runTask` and the dashboard). Without it only the rule-based analysis runs, which always does. A missing key skips the analysis and never blocks a run. |
| `analysis.instructions` | Optional analysis focus. A task's `analysisInstructions` override it. |
| `suggestions.model` | Optional `{ connectionId, modelId, reasoningEffort? }` of an `llm` connection that suggests completion checks while a task is written. The analysis model is used when unset. |

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

See [simulation limits](./mock-voiceover.md) and [SystemOne settings](./systemone.md).
