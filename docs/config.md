# Configuration: rawstep.config.json

One file in the project directory configures Rawstep. The dashboard (`rawstep ui`), the CLI (`rawstep run`) and the `runTask` library function read the same file. `rawstep init` writes a default file; `rawstep ui` creates it if it is missing. Task JSON files keep their own contract ([task files](./task.md)).

Commit `rawstep.config.json` with your project. Keep `.rawstep/` (run output) and `.env.local` (credentials) out of git.

## Credentials

The config never contains keys. A preset provider keeps its key under a fixed environment variable (the table below); a `custom` connection may name its own in `apiKeyEnv`. Put the value in `.env.local` in the project directory (the dashboard writes it with mode 0600) or in the process environment. `.env.example` shows the format. `rawstep doctor` checks that each variable is set without printing it.

## Top-level fields

| Field | Content |
|---|---|
| `version` | Always `2`. |
| `connections` | Where models are reached: a provider preset or a custom server. |
| `tasks` | Registered task files, with the agent and environment each uses by default. |
| `agents` | Who performs a task: the executor of each mode and an optional planner. At least one is required. |
| `environments` | Page conditions a task runs in. At least one is required. |
| `analysis` | Post-run LLM analysis settings. |
| `machine` | Settings of the computer running Rawstep. |

Unknown fields are rejected. `rawstep init` writes one agent `Default` (no executors yet) and one environment `Default` (`profile: "default"`).

A project written with `version: 1` (run profiles) is converted once with `node scripts/migrate-config-v2.mjs <project-dir>`. It keeps `.v1.bak` copies of the config and of each `.rawstep/experiments/*/experiment.json`.

## connections[]

A connection is where models are reached: a provider preset (fixed address and key variable) or a custom server. It holds no model; an agent picks the model on a connection (see [agents[]](#agents)).

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier (letters, digits, `.`, `_`, `-`) and display name. |
| `kind` | `llm`: a language model that reads the situation and picks a candidate (runs, post-run analysis, completion-check suggestions). `decision`: a model that answers with a probability for every candidate (runs only; fast and cheap). |
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
| `llm` | `custom` | any OpenAI-compatible server (LM Studio, Ollama, ...), `baseURL` | optional, `apiKeyEnv` |
| `decision` | `typesafe` | `https://api.typesafe.ai/v1` (`POST /v1/systemone`) | `RAWSTEP_TYPESAFE_API_KEY` |
| `decision` | `gateway` | Vercel AI Gateway, called through the AI SDK's gateway provider; text only | `RAWSTEP_AI_GATEWAY_API_KEY` |
| `decision` | `openrouter` | `https://openrouter.ai/api/v1` (`POST /api/v1/systemone`) | `RAWSTEP_OPENROUTER_API_KEY` (shared with `llm`) |
| `decision` | `custom` | any `/systemone`-compatible server, `baseURL` | optional, `apiKeyEnv` |

Connections to one preset provider share its key. `llm` models call the provider's chat API through the AI SDK. `decision` models call the AI SDK's experimental `decide` API: an in-house adapter for the `/systemone` protocol serves `typesafe`, `openrouter` and `custom`, and the AI SDK's gateway provider serves `gateway` (see [SystemOne decisions](./systemone.md)). Keyboard mode sends images, so it needs an `llm` with image input or a `decision` model on `typesafe`, `openrouter` or `custom`.

```json
{ "id": "jev", "name": "Jev", "kind": "decision", "provider": "typesafe", "timeoutMs": 60000 }
```

## tasks[]

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier used by `rawstep run <task>`, and display name. |
| `file` | Task JSON path relative to the project. |
| `agentId` | Optional agent used by default. The first agent is used when unset. |
| `environmentId` | Optional environment used by default. The first environment is used when unset. |
| `permissions` | `{ keyboard, screenreader }`, each a permissions object or `null`. `null` uses the agent's; a value replaces the agent's list for that mode. |
| `policy` | Optional partial policy that overrides the agent's for this task. |
| `analysisInstructions` | Optional analysis focus that overrides the project's `analysis.instructions`. |

Permissions are `{ keys, intents, typeText, replaceText, inputKeys? }`: the keys and screen reader intents the model may choose, and whether it may type or replace text in named inputs.

## agents[]

An agent is who performs a task. In the dashboard, experiments are task × agent × environment × mode. To compare models or instructions, compare agents that differ only in that part.

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. `--agent` accepts either. |
| `executors` | `{ screenreader?, keyboard? }`. The model that picks each action in that mode, with its instructions (see below). A mode without an executor cannot run with this agent. |
| `planner` | Optional planner, screen reader mode only for now (see [Planner and executor](#planner-and-executor-orchestration)). |
| `permissions` | `{ keyboard, screenreader }` permissions. |
| `policy` | When a run counts as stuck: `historyLimit`, `maxStateVisits`, `maxUnchangedTransitions`, `focusGate`, `repetitionGuard` (`auto`, `on` or `off`) and `modelGiveUp`. Defaults are 12, 5 and 4; the focus gate is off. With a planner, `maxReplans` (default 4) and `stepActionLimit` (default 12) bound replanning. |

An executor is `{ connectionId, modelId, inputs, maxChoices, maxImages, instructions }`. `connectionId` names a connection, `modelId` is the identifier sent to the provider, `inputs` is `["text"]` or `["text", "image"]`, and `maxChoices` and `maxImages` are the candidate and image limits (defaults 255 and 2). `instructions` is the executor prompt, see [prompts](./prompts.md). A keyboard executor needs image input and a `maxImages` of at least 2.

`repetitionGuard: auto` is on for `llm` models and off for `decision` models. `modelGiveUp` is `false` by default, so the model is offered only `stop:success`; `true` adds its `stop:stuck` and `stop:uncertain` choices.

```json
{
  "id": "careful",
  "name": "Careful",
  "planner": { "connectionId": "openai", "modelId": "gpt-5", "instructions": "Plan like an experienced screen reader user." },
  "executors": {
    "screenreader": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text"], "maxChoices": 255, "maxImages": 2, "instructions": "Reach the goal with the keys you are allowed." },
    "keyboard": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text", "image"], "maxChoices": 255, "maxImages": 2, "instructions": "Reach the goal with the keys you are allowed." }
  },
  "permissions": { "keyboard": { "keys": ["Tab", "Shift+Tab", "Enter", "Space"], "intents": [], "typeText": false, "replaceText": false }, "screenreader": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": false, "replaceText": false } },
  "policy": { "historyLimit": 12, "maxStateVisits": 5, "maxUnchangedTransitions": 4, "focusGate": false, "repetitionGuard": "auto", "modelGiveUp": false, "maxReplans": 4, "stepActionLimit": 12 }
}
```

## Planner and executor (orchestration)

With a `planner` on an `llm` connection, a screen reader run is split in two. The planner LLM plans a rough route (expectations taken from common UI conventions) and small steps. The executor carries out one small step at a time and may say the step is done or ask for a new plan. Rawstep also plans again when actions keep failing, change nothing, or a step runs long (`policy.maxReplans`, `policy.stepActionLimit`). Plans, finished steps and the reason for each new plan are saved as policy evidence in the trace and shown in the dashboard step view. Keyboard runs do not use the planner yet.

`planner.instructions` are added to Rawstep's planner rules, never replacing them. Do not put page knowledge in them that a real user would not have, such as where a button is: that hides the friction Rawstep measures. Strategy or user-type guidance ("plan like an experienced screen reader user") is fine. Planner instructions are fingerprinted (sha256) in the plan evidence.

The model's action history includes each action's execution result (`ok`, and for a failure the code `not-editable` or `backend`, never the raw error text) and whether the speech or screenshot changed afterwards (`changed`).

## environments[]

An environment is the page condition a task runs in.

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. `--environment` accepts either. |
| `profile` | A built-in environment profile name (`default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text`, ...) or an object. See [environment profiles](./environment-profiles.md). |

```json
{ "id": "narrow", "name": "Narrow", "profile": "narrow" }
```

## analysis

Project-level post-run LLM analysis. It never changes a run's outcome, so it is not part of an agent or an environment.

| Field | Meaning |
|---|---|
| `model` | Optional `{ connectionId, modelId }` of an `llm` connection. When set, an LLM analysis is added to every run (`rawstep run`, `runTask` and the dashboard). Without it only the rule-based analysis runs, which always does. |
| `instructions` | Optional analysis focus. A task's `analysisInstructions` override it. |

## machine

| Field | Meaning |
|---|---|
| `backend` | `simulation` (default): a Chromium-backed simulated screen reader, labelled simulation in traces. `voiceover` (macOS) or `nvda` (Windows): a native AT Driver. |
| `atEndpoint` | AT Driver WebSocket URL. Empty (the default) means the usual address of the chosen screen reader's server: `ws://localhost:4382/session` for VoiceOver (Bocoup macOS server) and `ws://localhost:3031/session` for NVDA (PAC server). Loopback only. |
| `browserExecutablePath` | Optional path to a trusted Chromium. Empty uses the bundled one. |
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
