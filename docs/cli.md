# RawStep CLI

---

## Quick Start

```bash
# 1. Configure the LLM provider
export AI_PROVIDER=anthropic
export AI_API_KEY=<your-key>
export AI_MODEL=<your-model>
# export AI_BASE_URL=<your-base-url> // when using an openai-compatible provider

# 2. Run a task
pnpm rawstep run examples/tasks/simple-cta.json
```

When the run finishes, the CLI prints the actual `report/index.html` path.  
Artifacts are stored under the output root in the `/<taskId>/<runId>/` layout. If you pass `--out`, that directory becomes the output root. Otherwise, RawStep uses `modes.<mode>.outDir` or the mode-specific default output root.
Only runs that had internal runtime warnings or errors produce `diagnostics.jsonl`, and the CLI output list includes that path as well.

Example using a fuller set of options:

```bash
pnpm rawstep run examples/tasks/simple-cta.json \
  --config ./rawstep.config.ts \
  --mode screenreader \
  --headless \
  --max-steps 40 \
  --timeout-ms 240000 \
  --screen-reader-backend guidepup-virtual \
  --allowed-screen-reader-actions sr.next,sr.form.next,sr.heading.next,sr.act \
  --agent-memory-all \
  --include-experience-summary \
  --screenshots important \
  --include-rationale \
  --verifier-auto-complete \
  --provider <your-provider> \
  --model <your-model>
  # --base-url <your-api-url-when-openai-provider>
```

---

## Option Precedence

Higher priority overrides lower priority.

```
CLI flags
  > task.config
    > task top-level (mode, maxSteps, timeoutMs)
      > rawstep.config.ts modes.<mode>
        > environment variables (provider values only)
```

---

## Parameter Reference

### Basic

| Parameter | Description | Default |
|-----------|-------------|---------|
| `<task-file>` | Path to the task JSON file to run **(required)** | — |
| `--config <path>` | Path to `rawstep.config.ts` | Search from the current directory |
| `--mode <keyboard\|screenreader>` | Force the run mode | Value from the task |
| `--out <dir>` | Output root directory. Actual saved path is `<dir>/<taskId>/<runId>` | `modes.<mode>.outDir` or the mode default |
| `--headless` / `--headed` | Whether to show the browser window | Config or backend policy |

### Execution Control

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--max-steps <n>` | Maximum number of steps | Value from the task |
| `--timeout-ms <n>` | Total run timeout in ms | Value from the task |
| `--verifier-auto-complete` / `--no-verifier-auto-complete` | Auto-finish when verifier conditions are satisfied | `true` |

### Screen Reader

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--screen-reader-backend <backend>` | Force the screen reader backend | Value from config |
| `--allowed-screen-reader-actions <sr.x,...>` | Allowed subset of `sr.*` actions, comma-separated | All allowed |
| `--screenshots <all\|important\|failure-only\|none>` | Screenshot saving policy for reports | Value from config |

### Keyboard

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--allowed-keys <key1,...>` | Allowed key subset, comma-separated | Default subset without editing keys |

### Agent Memory

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--agent-memory-window <n>` | Number of recent steps shown to the agent | Value from config |
| `--agent-memory-all` / `--no-agent-memory-all` | Whether to show the full accumulated text memory | Value from config |
| `--include-experience-summary` / `--no-include-experience-summary` | Whether to generate an experience summary | Value from config |
| `--include-rationale` / `--no-include-rationale` | Whether to save agent rationale | Value from config |

### LLM Provider

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--provider <anthropic\|openai-compatible>` | Force the LLM provider | `AI_PROVIDER` environment variable |
| `--model <id>` | Force the model ID | `AI_MODEL` environment variable |
| `--base-url <url>` | Base URL for an OpenAI-compatible provider | `AI_BASE_URL` environment variable |

Provider-specific request options such as OpenAI-compatible reasoning controls are **not** exposed as CLI flags.
Configure them in `rawstep.config.ts` with `defaults.providerOptions`, or override them per task with `task.config.providerOptions`.

```ts
defaults: {
  provider: "openai-compatible",
  providerOptions: {
    openaiCompatible: {
      reasoningEffort: "high"
    }
  }
}
```

This means the old `--reasoning-effort` style of override no longer exists.  
RawStep now follows the Vercel AI SDK pattern and forwards a general `providerOptions` object instead of maintaining a dedicated reasoning-only flag.

> **Note:** If you override values with `--allowed-keys` or `--allowed-screen-reader-actions`, the `hint` configured in `rawstep.config.ts` is not passed into prompts. `hint` cannot be set from the CLI and can only be configured through the `kb.*` / `sr.*` helpers in `rawstep.config.ts`.

---

## LLM Provider Configuration

### Environment Variables

```bash
# Anthropic
export AI_PROVIDER=anthropic
export AI_API_KEY=<your-key>
export AI_MODEL=<your-model>

# OpenAI-compatible
export AI_PROVIDER=openai-compatible
export AI_API_KEY=<your-key>
export AI_MODEL=<your-model>
export AI_BASE_URL=https://your-openai-compatible-base-url
```

The CLI automatically reads the `.env` file in the same directory as `rawstep.config.ts`. It does not overwrite environment variables that are already set in the shell.

### Fallback Order for Provider Values

Each value is resolved in the following order:

| Value | Order |
|-------|-------|
| `provider` | `--provider` → `defaults.provider` → `AI_PROVIDER` |
| `apiKey` | `defaults.apiKey` → `AI_API_KEY` |
| `model` | `--model` → `defaults.model` → `AI_MODEL` |
| `baseURL` | `--base-url` → `defaults.baseURL` → `AI_BASE_URL` |

Provider-specific extras such as `providerOptions.openaiCompatible.reasoningEffort` are resolved from config, not from CLI flags.

---

## Full Allowed Key List

These are the keys you can use in `allowedKeys` / `--allowed-keys` for `keyboard` mode.

```
Tab  Shift+Tab  Home  End
ArrowUp  ArrowDown  ArrowLeft  ArrowRight
Enter  Shift+Enter  Space  Escape
Backspace  Delete
Mod+A  Mod+Backspace  Mod+Delete  Mod+Z  Mod+Shift+Z
```

**Default allowed subset** (without editing keys):

```
Tab  Shift+Tab  Home  End
ArrowUp  ArrowDown  ArrowLeft  ArrowRight
Enter  Space  Escape
```

---

## Full Allowed Screen Reader Action List

These are the stable `sr.*` values you can use in `allowedScreenReaderActions` / `--allowed-screen-reader-actions`. The actual supported subset depends on the backend, and support is determined by `@rawstep/action-catalog`.

**Basic navigation**

```
sr.next  sr.previous  sr.act
sr.interact  sr.stopInteracting
```

**Keyboard input**

```
sr.key.arrow.up  sr.key.arrow.down  sr.key.arrow.left  sr.key.arrow.right
sr.key.enter  sr.key.space  sr.key.escape
```

**Move by element type**

```
sr.heading.next  sr.heading.previous
sr.form.next      sr.form.previous
sr.button.next    sr.button.previous
sr.landmark.next  sr.landmark.previous
```

Which actions are actually allowed is decided by `rawstep.config.ts` and task overrides.  
In this repo, the current default uses a narrower subset based on [rawstep.config.ts](../rawstep.config.ts).
