# Configuration: rawstep.config.json

One file in the project directory configures Rawstep. The dashboard (`rawstep ui`), the CLI (`rawstep run`) and the `runTask` library function read the same file. `rawstep init` writes a default file; `rawstep ui` creates it if it is missing. Task JSON files keep their own contract ([task files](./task.md)).

Commit `rawstep.config.json` with your project. Keep `.rawstep/` (run output) and `.env.local` (credentials) out of git.

## Credentials

The config never contains keys. A connection names an environment variable in `apiKeyEnv`. Put the value in `.env.local` in the project directory (the dashboard writes it with mode 0600) or in the process environment. `.env.example` shows the format. `rawstep doctor` checks that each variable is set without printing it.

## Top-level fields

| Field | Content |
|---|---|
| `version` | Always `1`. |
| `connections` | Model servers. |
| `models` | Models offered by connections. |
| `tasks` | Registered task files with per-mode prompts and permissions. |
| `profiles` | Run profiles. At least one is required. |
| `machine` | Settings of the computer running Rawstep. |

Unknown fields are rejected.

## connections[]

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier (letters, digits, `.`, `_`, `-`) and display name. |
| `provider` | `openai`: any OpenAI-compatible API (OpenAI, OpenRouter, Vercel AI Gateway, LM Studio, Ollama). `systemone`: a native SystemOne server. `screenshot`: a local `/choose` server (`rawstep-screenshot-choice-v1`). |
| `baseURL` | Server URL. |
| `apiKeyEnv` | Optional name of the environment variable that holds the key. |
| `timeoutMs` | Request timeout, 100 to 600000 ms. |

## models[]

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. `--model` accepts either. |
| `connectionId` | The connection that serves this model. |
| `modelId` | The identifier sent to the server. |
| `family` | `SystemOne` or `LLM`. |
| `protocol` | `chat`, `openrouter-decisions`, `vercel-evaluation`, `systemone-http` or `choose`. The connection's provider limits the choices. |
| `inputs` | `text` and/or `image`. |
| `capabilitySource` | `discovery` or `manual`. |
| `maxChoices`, `maxImages` | Candidate and image limits (defaults 255 and 2). |
| `roles` | `decision` models choose actions. `analysis` models (LLMs only) write post-run analysis. |
| `promptEditable` | Whether the dashboard may edit prompts for this model (default true). |

## tasks[]

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier used by `rawstep run <task>`, and display name. |
| `file` | Task JSON path relative to the project. |
| `profileId` | Optional profile used by default. The first profile is used when unset. |
| `policy` | Optional partial policy that overrides the profile for this task. |
| `modes.keyboard`, `modes.screenreader` | Each has `permissions` (`null` uses the profile) and `prompts[]` (`id`, `name`, `version`, `instructions`). |
| `analysisInstructions` | Optional analysis focus that overrides the profile. |

Permissions are `{ keys, intents, typeText, replaceText, inputKeys? }`: the keys and screen reader intents the model may choose, and whether it may type or replace text in named inputs.

## profiles[]

A run profile is a named set of conditions.

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. `--profile` accepts either. |
| `permissions` | `{ keyboard, screenreader }` permissions. |
| `policy` | When a run counts as stuck: `historyLimit`, `maxStateVisits`, `maxUnchangedTransitions`, `focusGate`, `repetitionGuard` (`auto`, `on` or `off`) and `modelGiveUp`. Defaults are 12, 5 and 4; the focus gate is off. |
| `environment` | A built-in environment profile name (`default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text`, ...) or an object. See [environment profiles](./environment-profiles.md). |
| `analysisInstructions` | Optional analysis focus. |

`repetitionGuard: auto` is on for `chat` and `choose` models and off for SystemOne models. `modelGiveUp: false` removes the model's `stop:stuck` and `stop:uncertain` choices.

## machine

| Field | Meaning |
|---|---|
| `backend` | `simulation` (default): a Chromium-backed simulated screen reader, labelled simulation in traces. `voiceover` (macOS) or `nvda` (Windows): a native AT Driver. |
| `atEndpoint` | AT Driver WebSocket URL (default `ws://127.0.0.1:9333`). Loopback only. |
| `browserExecutablePath` | Optional path to a trusted Chromium. Empty uses the bundled one. |
| `headless` | Run the browser without a window (default true). |

See [simulation limits](./mock-voiceover.md) and [SystemOne settings](./systemone.md).
