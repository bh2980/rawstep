# rawstep.config.json

Look-up reference for every field of `rawstep.config.json` (version 7), for people who edit the file by hand or want to know what a dashboard setting writes. For the ideas behind it see [concepts.md](../concepts.md); for a first run see [getting-started.md](../getting-started.md).

One file in the project folder holds the whole setup. The dashboard (`npx rawstep ui`), the CLI and the library read the same file. Commit it. It never holds API keys.

## Rules for the whole file

- Unknown fields are rejected, at every level.
- Every `id` matches `^[A-Za-z0-9._-]{1,100}$`. Ids are unique within `connections`, `profiles` and `tasks`.
- `name` and other required text is trimmed, 1 to 16384 characters.
- A file with `version` 1 to 6 does not load (error code `old-config`). Start a new project with `npx rawstep init` and copy your task files over.
- A profile's `planner.connectionId`, `project.analysis.model.connectionId` and `project.suggestions.model.connectionId` must name a connection that exists.
- `rawstep init` writes the demo setup: no connections, two profiles, one task. See [the example](#complete-example).

## Top level

| Field | Type | Default | Meaning |
|---|---|---|---|
| `version` | `7` | required | Always the number 7. |
| `connections` | array, up to 100 | required | Where language models are reached. See [connections](#connections). |
| `profiles` | array, 1 to 500 | required | Run profiles. At least one. See [profiles](#profiles). |
| `tasks` | array, up to 500 | required | Registered task files. See [tasks](#tasks). |
| `project` | object | `{ "analysis": { "instructions": "" }, "suggestions": {} }` | Settings shared by the project that never change how a run ends. See [project](#project). |
| `machine` | object | required (may be `{}`) | Settings of the computer running Rawstep. See [machine](#machine). |

## Connections

A connection says where a model lives. It holds no model name: the profile (or the `project` section) picks the model ID on a connection. In the dashboard: Settings › AI connections.

Nothing is connected by default. A connection sends what the simulated user hears to that provider, so you add one yourself.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | Referenced by `connectionId`. |
| `name` | text | required | Shown in the dashboard and in run records. |
| `provider` | one of the [providers](#providers) | required | Preset address and key variable, or a coding-agent CLI, or `custom`. |
| `baseURL` | URL | none | `custom` only, and required there. Must be HTTPS, or HTTP on a loopback host (`localhost`, `127.0.0.1`, `[::1]`), with no credentials, query or fragment. Setting it on another provider is an error. |
| `apiKeyEnv` | env variable name | none | `custom` only. Name of the environment variable that holds its key, matching `^[A-Z][A-Z0-9_]{0,100}$`. Setting it on another provider is an error. |
| `timeoutMs` | integer 100 to 600000 | `60000` | Time limit for one model call. |

### Providers

| `provider` | Kind | Address or command | Key variable | Key needed |
|---|---|---|---|---|
| `openai` | HTTP API | `https://api.openai.com/v1` | `RAWSTEP_OPENAI_API_KEY` | yes |
| `anthropic` | HTTP API | `https://api.anthropic.com/v1` (OpenAI-compatible endpoint) | `RAWSTEP_ANTHROPIC_API_KEY` | yes |
| `google` | HTTP API | `https://generativelanguage.googleapis.com/v1beta/openai` | `RAWSTEP_GOOGLE_API_KEY` | yes |
| `openrouter` | HTTP API | `https://openrouter.ai/api/v1` | `RAWSTEP_OPENROUTER_API_KEY` | yes |
| `claudeCode` | coding-agent CLI | `npx -y @agentclientprotocol/claude-agent-acp@0.89.1` | none | no (the CLI's own sign-in) |
| `codex` | coding-agent CLI | `npx -y @agentclientprotocol/codex-acp@2.2.2` | none | no |
| `opencode` | coding-agent CLI | `opencode acp` | none | no |
| `grok` | coding-agent CLI | `grok agent stdio` | none | no |
| `antigravity` | coding-agent CLI | `agy_acp_server.par` (download it from the ACP registry and put it on `PATH`) | none | no (keeps its own sign-in) |
| `custom` | HTTP API | your `baseURL` (any OpenAI-compatible chat endpoint) | your `apiKeyEnv` | no |

- A coding-agent CLI is started by Rawstep over the Agent Client Protocol. The command is fixed in Rawstep; it is never read from the config, because it runs a program. The `npx` adapters download on first use.
- Being installed is not being signed in. Sign in with the agent's own tool first.

### Where keys live

| What | Where |
|---|---|
| Key value | The variable named in the table above, read first from `.env.local` in the project folder, then from the process environment. |
| `.env.local` format | `NAME=value` lines. The dashboard writes `NAME="value"` (JSON-quoted) with file mode `0600`. |
| AT Driver start command | `RAWSTEP_AT_DRIVER_COMMAND` in `.env.local` or the process environment. Rawstep starts it only when nothing answers at the AT Driver address. See [screen-readers.md](../screen-readers.md). |

`npx rawstep doctor` reports for each connection whether its variable is set.

## Profiles

A run profile says who the simulated user is and how a run goes. A run is a task plus a profile ([concepts.md](../concepts.md)). `rawstep run <task>` uses the project's first profile unless `--profile <id|name>` is given.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | |
| `name` | text | required | Shown in results. `--profile` also accepts it. |
| `planner` | [LLM planner](#planner) or [plan file](#planner) | none | Who writes the plan. A profile without a planner cannot run (`planner-model-invalid`). |
| `actions` | [actions](#actions) | required | What the simulated user may do. |
| `page` | built-in name or object | `"default"` | The page environment. See [page environments](#page-environments). |
| `screenReader` | `simulation`, `voiceover`, `nvda` | `"simulation"` | Which screen reader the run goes through. `simulation` is Rawstep's simulated VoiceOver and is always labelled as simulation. `voiceover` needs macOS and `nvda` needs Windows; both go through an AT Driver server. |
| `runRules` | [run rules](#run-rules) | all rule defaults | When a run stops early and when a new plan is requested. |

The planner is the only model a profile names: Rawstep itself carries out the plan ([planning.md](../planning.md)).

### Planner

One of two shapes.

LLM planner (a model on a connection):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `connectionId` | id | required | A connection in `connections`. |
| `modelId` | text | required | The model ID on that connection. |
| `reasoningEffort` | text, up to 40 characters | none | For coding-agent CLIs only: one of the levels the agent itself offers. Unset keeps the agent's default, which can be slow. An agent that offers no levels ignores it; one that does refuses a level it does not offer. |
| `instructions` | text, up to 16384 characters | `""` | Added to Rawstep's planner rules, never replacing them. Do not put knowledge about the page here: a real first-time user does not have it, and the run would stop measuring how hard the page is to find one's way around. |

Plan file (a plan written by hand, no model):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `planFile` | text, up to 500 characters, ends in `.json` | required | Project-relative path to a plan file ([planning.md](../planning.md) has the format). `{task}` is replaced by the task file's name without `.json`, so one profile can give each task its own plan (`plans/{task}.json`). With `{task}` in the path the task must be registered in `tasks`; a task run by file path stops with `plan-file-task`. The plan never changes during a run; a task that gets stuck is abandoned and the next one starts. |

### Actions

What the simulated user may do. Each entry is checked against the screen reader at run time; an action the screen reader does not offer stops the run before it starts (`unsupported-action`).

| Field | Type | Default (`rawstep init`) | Meaning |
|---|---|---|---|
| `intents` | list of names | `["next", "previous", "activate"]` | Screen reader moves allowed. See the [intents](#intents) table. |
| `keys` | list of key names | `[]` | Keys the user may press. See [keys](#keys). |
| `typeText` | boolean | `true` | May type a task input into the focused field. |
| `replaceText` | boolean | `false` | May replace the text already in the focused field with a task input. |
| `inputKeys` | list of names | all of the task's `input` names | Which of the task's named inputs may be typed. A name the task does not have stops the run (`unknown-input`). Ignored (treated as empty) when neither `typeText` nor `replaceText` is on or the screen reader cannot enter text. |

Each list holds up to 100 names of up to 100 characters. Unknown fields are rejected.

The dashboard groups intents as "ways of finding things". Item by item is the base; each group adds one way:

| Way of finding things | Intents |
|---|---|
| Item by item | `next`, `previous`, `activate` |
| By headings | `heading.next`, `heading.previous`, `headings.list` |
| By form controls (buttons included) | `form.next`, `form.previous`, `formControls.rotor` |
| By links | `link.next`, `link.previous`, `links.list` |

A planner can only plan with the ways listed in `intents`.

#### Intents

| Intent | Simulation | VoiceOver (AT Driver) | NVDA (AT Driver) |
|---|---|---|---|
| `next`, `previous`, `activate` | yes | yes | yes |
| `heading.next`, `heading.previous` | yes | yes | yes |
| `form.next`, `form.previous` | yes | yes | yes |
| `link.next`, `link.previous` | yes | yes | yes |
| `headings.list`, `links.list`, `formControls.rotor` | yes | yes | no |
| `readCurrent`, `readFocused` | yes | no | no |
| `interact`, `stopInteracting` | no | yes | no |

`headings.list`, `links.list` and `formControls.rotor` open the rotor list. `survey: "headings"` (a run rule) only happens when `headings.list` is allowed. Per-backend behaviour and limits are in [screen-readers.md](../screen-readers.md).

#### Keys

| Backend | Keys |
|---|---|
| Simulation | `Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End` |
| VoiceOver, NVDA | `Tab`, `Enter`, `Escape`, `Space`, `Backspace`, `Delete`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home`, `End`, `PageUp`, `PageDown`, `Shift+Tab`, `Shift+Enter`, `Mod+A` |

### Run rules

When a run stops early and when Rawstep asks the planner for a new plan. Each profile holds a full set. The CLI can override fields for one set of runs with `--rule <name>=<value>` (repeatable). Every run records the rules it ran with, because they change how runs end.

| Rule | Type | Default | Range | Meaning |
|---|---|---|---|---|
| `repetitionGuard` | boolean | `true` | | Stop the run as stuck when the same action keeps producing the same speech (for example `next` answering "End of content"). |
| `maxUnchangedTransitions` | integer | `4` | 1 to 10000 | How many times in a row the same action may produce the same speech before the guard stops the run. |
| `confirmationGrace` | integer | `5` | 0 to 100 | After the goal is reached, how many more actions the run continues when the user heard no text saying so (a confirmation that is shown but not announced). `0` stops at once. |
| `maxPlannerCalls` | integer | `40` | 1 to 1000 | Planner calls one run may make (plans, questions about a heard item, retries after an unusable reply). A cost limit: a run that reaches it ends as not measured, never as the user failing. |
| `reviewEvery` | integer | `60` | 1 to 10000 | Moves since the planner last looked before it takes stock of the effort spent (keep going, change approach, or give up). |
| `stepActionLimit` | integer | `12` | 1 to 1000 | Actions on one small task without hearing anything new before a new plan is requested. |
| `failureLimit` | integer | `2` | 1 to 100 | Failed actions in a row on one small task before a new plan is requested. |
| `noChangeLimit` | integer | `3` | 1 to 100 | Actions in a row on one small task that changed nothing before a new plan is requested. |
| `plannerHistoryLimit` | integer | `60` | 1 to 10000 | Past actions given to the planner when it plans, each with what was heard before it. Older ones are forgotten; the plan it wrote stays. Lower it for a user who does not remember the whole page. |
| `survey` | `none` or `headings` | `headings` | | What the simulated user does before the first plan. `headings` opens the headings list first, as one action counted as a step, and only when `headings.list` is allowed. `none` never does. |

How the rules play out in a run is described in [planning.md](../planning.md).

### Page environments

`page` is one of the built-in names below, or an object that starts from the `default` settings and overrides some. A name is a shortcut for the object with that `id`.

| Built-in name | What differs from `default` |
|---|---|
| `default` | Nothing. 1280 x 800 viewport, light colour scheme. |
| `narrow` | Viewport 320 x 800. |
| `text-200` | `textScale: 2`. |
| `spacing` | `textSpacing`: line height 1.5, letter spacing 0.12 em, word spacing 0.16 em, paragraph spacing 2 em. |
| `reflow-text` | Viewport 320 x 800 and `textScale: 2`. |
| `forced-colors` | `forcedColors: "active"`. |
| `contrast` | `contrast: "more"`. |
| `dark` | `colorScheme: "dark"`. |
| `reduced-motion` | `reducedMotion: "reduce"`. |

Object fields (an unknown field is an error, for example `Unknown environment profile field browserZoom.`; an unknown name is `Unknown profile <name>.`):

| Field | Type | Default | Range or values | Meaning |
|---|---|---|---|---|
| `id` | text | `"default"` | `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$` | Name recorded with the run. |
| `viewport` | `{ width, height }` integers | `{ 1280, 800 }` | width 240 to 7680, height 200 to 4320 | Browser window size in CSS pixels. |
| `textScale` | number | `1` | 1 to 4 | Multiplies every computed font size on the page. |
| `textSpacing` | object | none | see below | Forces text spacing. All four fields required. |
| `colorScheme` | text | `"light"` | `light`, `dark`, `no-preference` | `prefers-color-scheme`. |
| `forcedColors` | text | `"none"` | `none`, `active` | `forced-colors` media query. |
| `contrast` | text | `"no-preference"` | `no-preference`, `more` | `prefers-contrast` media query. |
| `reducedMotion` | text | `"no-preference"` | `no-preference`, `reduce` | `prefers-reduced-motion` media query. |
| `at` | `{ name, version?, configuration? }` | none | strings up to 500 characters | The screen reader name, version and configuration you expect. Checked against what the screen reader reports when it connects; a mismatch stops the run while `requireApplied` is on. |
| `diagnostics` | boolean | `true` | | Collect independent page checks for people reading the run (horizontal overflow, focus hidden or outside the viewport, clipped text, overlapping controls, modal focus). They are recorded on a separate channel and are never given to the planner. |
| `requireApplied` | boolean | `true` | | Stop the run when a requested setting did not apply or could not be checked. With `false` the run goes ahead but the environment is still recorded as unsupported. |

`textSpacing` fields: `lineHeight` 1 to 4, `letterSpacingEm` 0 to 1, `wordSpacingEm` 0 to 2, `paragraphSpacingEm` 0 to 5.

#### Limits of page environments

- Colour scheme, forced colours, contrast and reduced motion are browser media emulation, checked with `matchMedia`. They are not Windows High Contrast, not macOS settings, and not a native magnifier. Native OS settings are never changed.
- Text scale and text spacing are page styles Rawstep adds, not the browser's text-only zoom and not OS magnification. Rawstep measures the elements on the page at load; if the page later inserts new elements, the setting is recorded as not applied and (with `requireApplied`) the run stops as not measured (`unsupported-profile`).
- There is no browser zoom, native magnifier or native high contrast setting. Rawstep does not substitute a viewport change, CSS zoom or pinch for them. A config written for an older Rawstep with `browserZoom`, `nativeMagnifier`, `nativeHighContrast`, `zoom-200` or `zoom-400` does not load; remove those keys and names.
- The viewport setting is real: layout reflow at 320 pixels is the browser's own behaviour.
- Page diagnostics are heuristics, not a WCAG verdict.
- Each run records requested and observed settings and their mechanism (`browser.profile` in the trace); see [results.md](results.md).

## Tasks

Registered tasks. The task file itself is described in [task.md](task.md).

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | id | required | What `rawstep run <id>` takes. |
| `name` | text | required | Shown in the dashboard. |
| `file` | text, 1 to 500 characters | required | Project-relative path to the task JSON. Unique across tasks, must stay inside the project (symlinks that leave it are refused), cannot be `package.json`, `rawstep.config.json` or under `.rawstep/`. Relative `url` values inside it resolve from the project folder. |
| `variantOf` | task `id` | none | This task is a broken version of another: the same goal on a copy of its page with one accessibility defect. Results compare its moves with that task. One level only; the target cannot itself be a variant or be this task. |
| `minimalSteps` | integer 1 to 10000 | none | The fewest moves the goal takes, as a person counted or measured it. Results show moves against it. |
| `analysisInstructions` | text, up to 16384 characters | none | Replaces `project.analysis.instructions` for this task. |

A task file that is not registered can still run by path: `npx rawstep run path/to/task.json` uses the project's first profile unless `--profile` is given.

## Project

| Field | Type | Default | Meaning |
|---|---|---|---|
| `analysis.model` | `{ connectionId, modelId, reasoningEffort? }` | none | The model that explains finished runs. Without one only the built-in rule-based analysis runs. It never changes how a run ends. A missing key does not block a run; the run gets the rule-based analysis only. |
| `analysis.instructions` | text, up to 16384 characters | `""` | Extra instructions for the analysis model. |
| `suggestions.model` | `{ connectionId, modelId, reasoningEffort? }` | the analysis model | The model that suggests completion checks (`verify` rules) while you write a task in the dashboard. |

## Machine

Settings that belong to the computer, not to an experiment.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `atEndpoints.voiceover` | text | `""` | AT Driver WebSocket address for VoiceOver. Empty means `ws://localhost:4382/session`. |
| `atEndpoints.nvda` | text | `""` | AT Driver WebSocket address for NVDA. Empty means `ws://localhost:3031/session`. |
| `browserExecutablePath` | text | `""` | Path of the Chrome or Chromium to launch. Empty lets Rawstep pick one. |
| `headless` | boolean | `true` | Run the simulation without a visible browser window. Native screen reader runs always use a visible window. |
| `browserEndpoint` | text | `""` | A Chrome you started yourself with `--remote-debugging-port`, for example `http://localhost:9222`. Runs connect to it instead of launching one, and each run gets its own isolated context there. |
| `personCheck` | boolean | `false` | For real sites with a human check. Runs use a visible Chrome (with a profile kept in `.rawstep/browser-profile`, or your `browserEndpoint`) and pause while you pass the check in that window. Rawstep never answers a check itself. |

Native screen reader addresses must be a `ws:` or `wss:` URL on a loopback host without credentials, otherwise the run is refused (`endpoint-not-loopback`).

## Complete example

All fields in use. It assumes `rawstep/demo/plan.json` exists, as after `rawstep init`; `RAWSTEP_OPENAI_API_KEY` and `LOCAL_LLM_KEY` go in `.env.local`.

```json
{
  "version": 7,
  "connections": [
    { "id": "openai", "name": "OpenAI", "provider": "openai" },
    { "id": "local", "name": "Local server", "provider": "custom", "baseURL": "http://localhost:1234/v1", "apiKeyEnv": "LOCAL_LLM_KEY", "timeoutMs": 120000 }
  ],
  "profiles": [
    {
      "id": "written-plan",
      "name": "Written plan (no model)",
      "planner": { "planFile": "rawstep/demo/plan.json" },
      "actions": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": true, "replaceText": false }
    },
    {
      "id": "headings-and-forms",
      "name": "Headings and forms, model plans",
      "planner": { "connectionId": "openai", "modelId": "gpt-5", "reasoningEffort": "low", "instructions": "" },
      "actions": {
        "keys": ["Tab", "Enter"],
        "intents": ["next", "previous", "activate", "heading.next", "heading.previous", "headings.list", "form.next", "form.previous", "formControls.rotor"],
        "typeText": true,
        "replaceText": false,
        "inputKeys": ["email"]
      },
      "page": "default",
      "screenReader": "simulation",
      "runRules": { "maxPlannerCalls": 20, "survey": "headings" }
    },
    {
      "id": "reflow-text",
      "name": "Reflow, 200% text",
      "planner": { "planFile": "rawstep/demo/plan.json" },
      "actions": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": false, "replaceText": false },
      "page": "reflow-text"
    },
    {
      "id": "custom-page",
      "name": "Phone, dark, reduced motion, text spacing",
      "planner": { "planFile": "rawstep/demo/plan.json" },
      "actions": { "keys": [], "intents": ["next", "previous", "activate"], "typeText": false, "replaceText": false },
      "page": {
        "id": "dark-spacing",
        "viewport": { "width": 390, "height": 844 },
        "colorScheme": "dark",
        "reducedMotion": "reduce",
        "textSpacing": { "lineHeight": 1.5, "letterSpacingEm": 0.12, "wordSpacingEm": 0.16, "paragraphSpacingEm": 2 }
      }
    }
  ],
  "tasks": [
    { "id": "demo", "name": "Demo: add a mug to the cart", "file": "rawstep/demo/task.json", "minimalSteps": 3 }
  ],
  "project": {
    "analysis": { "model": { "connectionId": "openai", "modelId": "gpt-5-mini" }, "instructions": "" },
    "suggestions": { "model": { "connectionId": "openai", "modelId": "gpt-5-mini" } }
  },
  "machine": {
    "atEndpoints": { "voiceover": "", "nvda": "" },
    "browserExecutablePath": "",
    "headless": true,
    "browserEndpoint": "",
    "personCheck": false
  }
}
```

The file `rawstep init` writes is the same shape with `connections` empty, the profiles `written-plan` (plan file `rawstep/demo/plan.json`) and `item-by-item` (no planner yet), and the `demo` task. Fields you leave out are filled with the defaults above when the file is read.

## What to commit

| Path | Commit? | Why |
|---|---|---|
| `rawstep.config.json` | yes | Shared setup. No secrets. |
| `rawstep/` (demo page, task files, plan files) and your own task and plan files | yes | They are the experiment. |
| `.env.local` | no | Holds API keys and `RAWSTEP_AT_DRIVER_COMMAND`. |
| `.rawstep/` | no | Run records (`.rawstep/runs/`) and the kept browser profile (`.rawstep/browser-profile`, which can hold sign-ins). |

`rawstep init` does not write a `.gitignore`. Add:

```
.env.local
.rawstep/
```
