# Configuration: rawstep.config.json

One file in the project directory configures Rawstep. The dashboard (`rawstep ui`), the CLI (`rawstep run`) and the `runTask` library function read the same file. `rawstep init` writes a default file; `rawstep ui` creates it if it is missing. Task JSON files keep their own contract ([task files](./task.md)).

Commit `rawstep.config.json` with your project. Keep `.rawstep/` (run output) and `.env.local` (credentials) out of git.

## Credentials

The config never contains keys. A preset provider keeps its key under a fixed environment variable (the table below); a `custom` connection may name its own in `apiKeyEnv`. Put the value in `.env.local` in the project directory (the dashboard writes it with mode 0600) or in the process environment. `.env.example` shows the format. `rawstep doctor` checks that each variable is set without printing it.

## Top-level fields

| Field | Content |
|---|---|
| `version` | Always `1`. |
| `connections` | Where models are reached: a provider preset or a custom server. |
| `tasks` | Registered task files with per-mode prompts and permissions. |
| `profiles` | Run profiles. At least one is required. |
| `machine` | Settings of the computer running Rawstep. |

Unknown fields are rejected.

## connections[]

A connection is where models are reached: a provider preset (fixed address and key variable) or a custom server. It holds no model; a run profile picks the model on a connection (see [profiles[]](#profiles)).

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
| `llm` | `claudeCode` | runs `npx -y @agentclientprotocol/claude-agent-acp@0.89.1` | none (CLI login) |
| `llm` | `codex` | runs `npx -y @agentclientprotocol/codex-acp@2.2.2` | none (CLI login) |
| `llm` | `opencode` | runs `opencode acp` | none (CLI login) |
| `llm` | `grok` | runs `grok agent stdio`, no images | none (CLI login) |
| `llm` | `custom` | any OpenAI-compatible server (LM Studio, Ollama, ...), `baseURL` | optional, `apiKeyEnv` |
| `decision` | `typesafe` | `https://api.typesafe.ai/v1` (`POST /v1/systemone`) | `RAWSTEP_TYPESAFE_API_KEY` |
| `decision` | `gateway` | Vercel AI Gateway, called through the AI SDK's gateway provider; text only | `RAWSTEP_AI_GATEWAY_API_KEY` |
| `decision` | `openrouter` | `https://openrouter.ai/api/v1` (`POST /api/v1/systemone`) | `RAWSTEP_OPENROUTER_API_KEY` (shared with `llm`) |
| `decision` | `custom` | any `/systemone`-compatible server, `baseURL` | optional, `apiKeyEnv` |

**Coding-agent CLIs** (`claudeCode`, `codex`, `opencode`, `grok`) are connections to a CLI spoken to over ACP (Agent Client Protocol, JSON-RPC over stdio) instead of an address. The CLI must be installed and logged in; its own subscription pays and there is no API key or `baseURL`. The commands are fixed in `PROVIDERS` and never read from the shared config. The two `npx` adapters are pinned and downloaded on first use, so the first call is slow. `modelId: "default"` keeps the agent's own model choice; the model list (dashboard 확인 and the model picker) starts the agent and shows `default` first. Grok takes no images, so it only fits screen-reader mode and analysis. Every decision runs in a fresh agent session in an empty temporary folder; file and terminal access is refused, permission requests are rejected, and the session is deleted after the call. Agents carry their own large system prompt, so each call uses more tokens and is slower than a direct API (about 4 to 13 s per decision measured).

Connections to one preset provider share its key. `llm` models call the provider's chat API through the AI SDK. `decision` models call the AI SDK's experimental `decide` API: an in-house adapter for the `/systemone` protocol serves `typesafe`, `openrouter` and `custom`, and the AI SDK's gateway provider serves `gateway` (see [SystemOne decisions](./systemone.md)). Keyboard mode sends images, so it needs an `llm` with image input or a `decision` model on `typesafe`, `openrouter` or `custom`.

```json
{ "id": "jev", "name": "Jev", "kind": "decision", "provider": "typesafe", "timeoutMs": 60000 }
```

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
| `model` | The model runs of this profile decide with: `{ connectionId, modelId, inputs, maxChoices, maxImages }`. `connectionId` names a connection, `modelId` is the identifier sent to the provider, `inputs` is `["text"]` or `["text", "image"]`, and `maxChoices` and `maxImages` are the candidate and image limits (defaults 255 and 2). A profile without `model` cannot run. To compare models, compare profiles that differ only in `model`. |
| `analysisModel` | Optional `{ connectionId, modelId }` of an `llm` connection. When set, an LLM analysis is added to every run of this profile (`rawstep run`, `runTask` and the dashboard). Without it only the rule-based analysis runs, which always does. |
| `environment` | A built-in environment profile name (`default`, `narrow`, `zoom-200`, `forced-colors`, `dark`, `reflow-text`, ...) or an object. See [environment profiles](./environment-profiles.md). |
| `analysisInstructions` | Optional analysis focus. |

```json
"model": { "connectionId": "jev", "modelId": "jev-latest", "inputs": ["text", "image"], "maxChoices": 255, "maxImages": 2 }
```

`repetitionGuard: auto` is on for `llm` models and off for `decision` models. `modelGiveUp` is `false` by default, so the model is offered only `stop:success`; `true` adds its `stop:stuck` and `stop:uncertain` choices.

## machine

| Field | Meaning |
|---|---|
| `backend` | `simulation` (default): a Chromium-backed simulated screen reader, labelled simulation in traces. `voiceover` (macOS) or `nvda` (Windows): a native AT Driver. |
| `atEndpoint` | AT Driver WebSocket URL. Empty (the default) means the usual address of the chosen screen reader's server: `ws://localhost:4382/session` for VoiceOver (Bocoup macOS server) and `ws://localhost:3031/session` for NVDA (PAC server). Loopback only. |
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
