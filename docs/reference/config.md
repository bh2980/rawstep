# Configuration Reference (`rawstep.config.json`)

Complete specification for `rawstep.config.json` (`version: 7`, defined in [`packages/project/src/config.ts`](../../packages/project/src/config.ts)) and `.env.local`.

---

## 1. Top-Level Structure

```json
{
  "version": 7,
  "connections": [],
  "profiles": [],
  "tasks": [],
  "project": {
    "analysis": {
      "instructions": ""
    },
    "suggestions": {}
  },
  "machine": {
    "atEndpoints": {
      "voiceover": "",
      "nvda": ""
    },
    "browserExecutablePath": "",
    "headless": true,
    "browserEndpoint": "",
    "proxyServer": "",
    "parallelRuns": 1
  }
}
```

`version` (must be `7`), `connections`, `profiles` (at least one), `tasks`, and `machine` are required (`connections` and `tasks` may be empty arrays, and `machine` may be `{}` since every field in it has a default). `project` is optional. Unknown keys are rejected everywhere.

---

## 2. Connections (`connections[]`)

Each entry in `connections` (max 100) defines where models are reached. Connections hold no model ID of their own—profiles and project settings pick a `modelId` on a connection.

| Field | Type | Default | Constraints & Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | *(Required)* | Unique ID matching `/^[A-Za-z0-9._-]{1,100}$/`. |
| `name` | `string` | *(Required)* | Display name (`1–16384` chars). |
| `provider` | `ProviderId` | *(Required)* | One of: `'openai'`, `'anthropic'`, `'google'`, `'openrouter'`, `'claudeCode'`, `'codex'`, `'opencode'`, `'grok'`, `'antigravity'`, `'custom'`. |
| `baseURL` | `string` (URL) | *(Preset)* | **Required** when `provider === 'custom'`; **forbidden** on all other providers. |
| `apiKeyEnv` | `string` | *(Preset)* | Environment variable name (`/^[A-Z][A-Z0-9_]{0,100}$/`) holding the API key. **Allowed only** when `provider === 'custom'`. |
| `timeoutMs` | `number` | `60000` (API)<br>`180000` (Agent CLI) | Per-call model timeout in milliseconds (`100–600000`). |

### Provider Presets & Environment Variables (`PROVIDERS`)

API keys live in `.env.local` (file mode `0600`) or your shell environment—never in `rawstep.config.json`.

| `provider` | Type | Default `baseURL` / Command | Primary Key Env Var | Fallback Env Var Aliases |
| :--- | :--- | :--- | :--- | :--- |
| `openai` | Cloud API | `https://api.openai.com/v1` | `RAWSTEP_OPENAI_API_KEY` | `OPENAI_API_KEY` |
| `anthropic` | Cloud API | `https://api.anthropic.com/v1` | `RAWSTEP_ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` |
| `google` | Cloud API | `https://generativelanguage.googleapis.com/v1beta/openai` | `RAWSTEP_GOOGLE_API_KEY` | `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` |
| `openrouter` | Cloud API | `https://openrouter.ai/api/v1` | `RAWSTEP_OPENROUTER_API_KEY` | `OPENROUTER_API_KEY` |
| `claudeCode` | Agent CLI (ACP) | `npx -y @agentclientprotocol/claude-agent-acp@0.89.1` | *(None — uses `claude` login)* | — |
| `codex` | Agent CLI (ACP) | `npx -y @agentclientprotocol/codex-acp@2.2.2` | *(None — uses `codex login`)* | — |
| `opencode` | Agent CLI (ACP) | `opencode acp` | *(None — uses `opencode auth login`)* | — |
| `grok` | Agent CLI (ACP) | `grok agent stdio` | *(None — uses `grok` login)* | — |
| `antigravity` | Agent CLI (ACP) | `agy_acp_server.par` | *(None — OAuth sign-in in UI)* | — |
| `custom` | OpenAI-compatible | *(Set via `baseURL`)* | *(Optional `apiKeyEnv`)* | — |

---

## 3. Run Profiles (`profiles[]`)

Each entry in `profiles` (`1–500` entries) defines a complete set of experiment conditions under a single name. `id` (same pattern as connection IDs), `name`, and `actions` are required; `planner`, `page` (`"default"`), `screenReader` (`"simulation"`), and `runRules` (all defaults) are optional. A profile without a `planner` passes validation but cannot run until one is set.

```json
{
  "id": "by-headings",
  "name": "By Headings",
  "planner": {
    "connectionId": "openai-main",
    "modelId": "gpt-4.1",
    "reasoningEffort": "medium",
    "instructions": ""
  },
  "actions": {
    "keys": [],
    "intents": ["next", "previous", "activate", "heading.next", "heading.previous", "headings.list"],
    "typeText": true,
    "replaceText": true
  },
  "page": "default",
  "screenReader": "simulation",
  "runRules": {
    "repetitionGuard": true,
    "maxUnchangedTransitions": 4,
    "confirmationGrace": 5,
    "maxPlannerCalls": 40,
    "reviewEvery": 60,
    "stepActionLimit": 12,
    "failureLimit": 2,
    "noChangeLimit": 3,
    "plannerHistoryLimit": 60,
    "survey": "headings"
  }
}
```

### 3.1 `planner`
Either an **LLM planner** or a **file planner**:
- **LLM Planner:**
  - `connectionId` (`string`, required): References an entry in `connections`.
  - `modelId` (`string`, required): Model identifier on that connection.
  - `reasoningEffort` (`string`, optional): Reasoning/thinking level (e.g., `"low"`, `"medium"`, `"high"`).
  - `instructions` (`string`, default `""`, up to `16384` chars): Extra instructions appended to Rawstep's planner rules. Must not contain page knowledge a real first-time user wouldn't have (such as where a button is), since that removes the difficulty of finding the way, which is what is being measured.
- **File Planner:**
  - `planFile` (`string`, required): Project-relative path ending in `.json` (supports `{task}` placeholder, e.g., `"plans/{task}.json"`).

### 3.2 `actions` (`Permissions`)
Controls what the simulated user is allowed to do:
All of `keys`, `intents`, `typeText`, and `replaceText` are required (no defaults); `inputKeys` is optional. `keys` and `intents` each take up to 100 entries.
- `intents` (`string[]`): Allowed screen-reader intents:
  - Linear: `'next'`, `'previous'`, `'activate'`, `'readCurrent'`, `'readFocused'`
  - Headings: `'heading.next'`, `'heading.previous'`, `'headings.list'`
  - Form controls: `'form.next'`, `'form.previous'`, `'formControls.rotor'`
  - Links: `'link.next'`, `'link.previous'`, `'links.list'`
- `keys` (`string[]`): Allowed physical keyboard keys. The simulation (`screenReader: "simulation"`) supports `'Tab'`, `'Shift+Tab'`, `'Enter'`, `'Space'`, `'Escape'`, `'ArrowUp'`, `'ArrowDown'`, `'ArrowLeft'`, `'ArrowRight'`, `'Home'`, and `'End'`. Native AT Driver backends (`voiceover`, `nvda`) also support `'Backspace'`, `'Delete'`, `'PageUp'`, `'PageDown'`, `'Shift+Enter'`, and `'Mod+A'`.
- `typeText` (`boolean`): Allow typing declared task inputs.
- `replaceText` (`boolean`): Allow clearing and replacing field text with a declared task input.
- `inputKeys` (`string[]`, optional): Restricts which named inputs from `task.input` may be typed.

### 3.3 Page Environments (`page`)

`profile.page` can be one of the **9 built-in preset names** or a custom `EnvironmentProfile` object:
- Built-in presets: `'default'` (`1280×800`, no changes), `'narrow'` (`320×800`), `'text-200'` (text 2×), `'spacing'` (WCAG text spacing: line height 1.5, letter spacing `0.12em`, word spacing `0.16em`, paragraph spacing `2em`), `'reflow-text'` (`320×800` and text 2×), `'forced-colors'`, `'contrast'` (`prefers-contrast: more`), `'dark'`, `'reduced-motion'`.
- Custom object fields (all optional; omitted ones keep the `default` values; unknown keys throw): `id` (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/`), `viewport` (`{ width, height }`, both required integers: width `240..7680`, height `200..4320`), `textScale` (`1..4`), `colorScheme` (`'light' | 'dark' | 'no-preference'`), `forcedColors` (`'none' | 'active'`), `contrast` (`'no-preference' | 'more'`), `reducedMotion` (`'no-preference' | 'reduce'`), `textSpacing` (all four keys required: `lineHeight` `1..4`, `letterSpacingEm` `0..1`, `wordSpacingEm` `0..2`, `paragraphSpacingEm` `0..5`), `at` (`{ name, version?, configuration? }`, strings up to 500 chars with a non-empty `name`: the screen reader the run expects, checked against what the backend reports), `diagnostics` (`boolean`, default `true`), `requireApplied` (`boolean`, default `true`: the run stops if a requested setting is not applied or `at` does not match).

### 3.4 `screenReader`
- `'simulation'` *(default)*: Built-in Chromium accessibility-tree simulator (`MockVoiceOverBackend`).
- `'voiceover'`: Native macOS VoiceOver via W3C AT Driver.
- `'nvda'`: Native Windows NVDA via W3C AT Driver.

### 3.5 Run Rules (`runRules`)
Can be set per profile in `rawstep.config.json` and overridden per CLI invocation via `--rule <name>=<value>`:

| Rule Name | Type & Range | Default | Description |
| :--- | :--- | :---: | :--- |
| `repetitionGuard` | `boolean` | `true` | Stops the run as stuck when the same action produces the exact same speech `maxUnchangedTransitions` times in a row. |
| `maxUnchangedTransitions` | Integer `1–10000` | `4` | Consecutive identical action+speech transitions before `repetitionGuard` stops the run. |
| `confirmationGrace` | Integer `0–100` | `5` | Extra moves the run continues after `verify.all` passes when nothing heard on that step announced the change (`0` stops immediately). The run ends as `reached` either way, and these moves are not counted as its cost. |
| `maxPlannerCalls` | Integer `1–1000` | `40` | Maximum calls to the planner model during a run (cost limit; hitting it ends the run as `unmeasured`). |
| `reviewEvery` | Integer `1–10000` | `60` | Moves since the planner last looked before triggering an `effort-review` replan. |
| `stepActionLimit` | Integer `1–1000` | `12` | Maximum actions on a single plan subtask without hearing anything new before requesting a replan (`task-limit`). |
| `failureLimit` | Integer `1–100` | `2` | Consecutive failed actions on a single plan subtask before requesting a replan (`failures`). |
| `noChangeLimit` | Integer `1–100` | `3` | Consecutive actions on a single plan subtask that changed nothing before requesting a replan (`no-change`). |
| `plannerHistoryLimit` | Integer `1–10000` | `60` | Number of recent actions (with what was heard before each) passed to the planner on replans. |
| `survey` | `'none' \| 'headings'` | `'headings'` | When `'headings'` and `headings.list` is in `profile.actions.intents`, lists page headings on step 1 before the first plan. |

---

## 4. Managed Tasks (`tasks[]`)

Registers task files in `rawstep.config.json` (max 500 entries):

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | *(Required)* | Unique task ID (`/^[A-Za-z0-9._-]{1,100}$/`). |
| `name` | `string` | *(Required)* | Display name. |
| `file` | `string` | *(Required)* | Project-relative path to the task JSON file (e.g., `"tasks/checkout.json"`). |
| `profiles` | `string[]` *(optional)* | *(First profile)* | Default profile IDs (`max 20`) used when running this task without `--profile`. |
| `tags` | `string[]` *(optional)* | `[]` | Up to 10 tags for filtering with `rawstep suite --tag`. Each starts with a letter or digit, then letters, digits, `-`, or `_` (up to 30 chars in all, so no spaces). |
| `minimalSteps` | `number` *(optional)* | *(None)* | Minimum moves a human needs to complete the goal (`1–10000`), shown as a benchmark in reports. |
| `variantOf` | `string` *(optional)* | *(None)* | ID of a baseline task that this task is a broken/variant copy of (one level deep: the baseline must be another task that is not itself a variant). Reports compare move counts against that baseline task. |
| `analysisInstructions` | `string` *(optional)* | *(Project's)* | Overrides `project.analysis.instructions` for this task. |

### Validation

Loading the config fails when:
- two connections, two tasks, or two profiles share an `id`, or two tasks share a `file`;
- a task's `profiles` names a profile that does not exist;
- a task's `variantOf` points at itself, at a missing task, or at a task that is itself a variant;
- a profile's `planner`, `project.analysis.model`, or `project.suggestions.model` names a `connectionId` that is not in `connections`.

---

## 5. Project Settings (`project`)

Shared project-level LLM helpers that never alter how a run itself behaves:

- **`project.analysis`:**
  - `model` (`{ connectionId, modelId, reasoningEffort? }`, optional): Default LLM used for post-run trace analysis (`LlmTraceAnalyzer`). When omitted, only the local rule-based analyzer runs.
  - `instructions` (`string`, default `""`): Custom focus instructions passed to the post-run analysis LLM.
- **`project.suggestions`:**
  - `model` (`{ connectionId, modelId, reasoningEffort? }`, optional): LLM used by the Dashboard's **Get AI suggestions** feature when authoring tasks (falls back to `project.analysis.model`, or the first profile's LLM planner).

---

## 6. Machine Settings (`machine`)

Settings specific to the computer executing Rawstep:

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `atEndpoints` | `{ voiceover: string, nvda: string }` | `{ voiceover: "", nvda: "" }` | Loopback WebSocket URLs for native AT Driver servers. Empty strings use defaults (`ws://localhost:4382/session` for VoiceOver, `ws://localhost:3031/session` for NVDA). |
| `browserExecutablePath` | `string` | `""` | Custom Chrome/Chromium binary path. Empty uses Playwright Chromium or installed Google Chrome. |
| `headless` | `boolean` | `true` | Launches browsers in headless mode (always `false` for the native `voiceover` and `nvda` screen readers, and for `personCheck`). |
| `browserEndpoint` | `string` | `""` | Local Chrome DevTools HTTP endpoint (e.g., `"http://localhost:9222"`) used by tasks with `"browser": { "mode": "connect" }`. |
| `proxyServer` | `string` | `""` | Credential-free `http://`, `https://`, `socks4://`, or `socks5://` proxy URL for launched browsers. |
| `parallelRuns` | Integer `1–8` | `1` | Default number of concurrent browser runs for `run` and `suite`. |
