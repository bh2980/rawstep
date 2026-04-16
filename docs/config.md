# rawstep.config.ts

---

## Basic Structure

`rawstep.config.ts` is the main configuration file that controls execution. This repo already includes a default file.

```ts
import { defineConfig, kb, sr } from "@rawstep/config";

export default defineConfig({
  version: 1,
  defaults: {
    provider: "<anthropic|openai-compatible>",
    model: "<your-model>",
    apiKey: "<your-key>",
    providerOptions: {
      openaiCompatible: {
        reasoningEffort: "medium",
        reasoningSummary: "concise"
      }
    }
  },
  modes: {
    keyboard: {
      maxSteps: 30,
      timeoutMs: 240000,
      headless: true,
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      memory: "all"
    },
    screenreader: {
      maxSteps: 1000,
      timeoutMs: 600000,
      memory: "all",
      headless: false,
      screenReaderBackend: "guidepup-virtual",
      screenshots: "all",
      verifierAutoComplete: true,
      includeRationale: true,
      includeExperienceSummary: true,
      allowedScreenReaderActions: [
        sr.key.arrow.up(), sr.key.arrow.down(), sr.key.arrow.left(), sr.key.arrow.right(),
        sr.key.enter(), sr.key.space(), sr.key.escape(),
        sr.next(), sr.previous(),
        sr.landmark.next(), sr.landmark.previous(),
        sr.heading.next(), sr.heading.previous(),
        sr.button.next(), sr.button.previous(),
        sr.form.next(), sr.form.previous(),
        sr.interact(), sr.stopInteracting(),
        sr.act()
      ]
    }
  }
});
```

---

## Execution Precedence

Higher priority overrides lower priority.

```
CLI flags
  > task.config
    > task top-level (mode, maxSteps, timeoutMs)
      > rawstep.config.ts modes.<mode>
        > environment variables (provider values only)
```

---

## Field Reference

### `defaults`

It only accepts AI provider-related values and the prompt directory.  
If you put execution options such as `outDir`, `timeoutMs`, or `memory` here, RawStep throws an error.

| Field | Description |
|------|-------------|
| `provider` | `anthropic` or `openai-compatible` |
| `apiKey` | Provider API key |
| `model` | Model ID |
| `baseURL` | Used only for an OpenAI-compatible provider |
| `providerOptions` | Vercel AI SDK `providerOptions` object. Example: `openaiCompatible.reasoningEffort` |
| `prompt.dir` | Path to the prompt directory. Default is `./prompt` next to the config file |

### `defaults.providerOptions`

This is the place for provider-specific request parameters.

RawStep passes this object through to the Vercel AI SDK `providerOptions` field when it calls the model.  
In other words, this is the general mechanism for model-provider extras such as OpenAI-compatible reasoning controls.

```ts
defaults: {
  provider: "openai-compatible",
  model: "openai/gpt-5.4-mini",
  baseURL: "https://openrouter.ai/api/v1",
  providerOptions: {
    openaiCompatible: {
      reasoningEffort: "high",
      reasoningSummary: "detailed"
    }
  }
}
```

Why this changed:

- The old `reasoningEffort` field was too provider-specific
- Different providers expose different extra request fields
- `providerOptions` keeps RawStep aligned with the Vercel AI SDK surface instead of inventing a special-case config field

Practical rule:

- Put shared provider-specific options in `defaults.providerOptions`
- Use `task.config.providerOptions` only when one task really needs an override
- Keep credentials and provider selection in `provider`, `apiKey`, `model`, and `baseURL`

### `modes.<mode>`

In this repo, both `keyboard` and `screenreader` use `memory: "all"` and `verifierAutoComplete: true` by default.

If `outDir` is omitted, RawStep uses the mode-specific default output root:
- `keyboard`: `./.rawstep/out/keyboard`
- `screenreader`: `./.rawstep/out/screenreader`

| Field | Description | Default |
|------|-------------|---------|
| `outDir` | Output root directory. Actual saved path is `<outDir>/<taskId>/<runId>` | `keyboard`: `./.rawstep/out/keyboard`, `screenreader`: `./.rawstep/out/screenreader` |
| `headless` | Whether to show the browser window | Mode/backend default policy |
| `maxSteps` | Maximum step count | — |
| `timeoutMs` | Total execution timeout in ms | — |
| `maxVerificationRetries` | Maximum number of times success can be rolled back after verifier failure | — |
| `screenshots` | `all \| important \| failure-only \| none` | `important` |
| `verifierAutoComplete` | Whether to run the verifier even after actions that might have succeeded | — |
| `includeExperienceSummary` | Whether to include the post-run experience summary | `false` |
| `includeRationale` | Whether to save action rationale for each agent step | `false` |
| `memory` | Number or `"all"` | — |
| `allowedKeys` | Allowed key subset (`keyboard` mode only) | Default subset |
| `allowedScreenReaderActions` | Allowed `sr.*` action subset | All allowed |
| `screenReaderBackend` | `guidepup-voiceover \| guidepup-nvda \| guidepup-virtual` | — |
| `observe` | Observation timing override for screenreader mode | See below |
| `voiceOver` | VoiceOver-specific options | — |
| `planning` | Planning / reflection control | Mode-specific defaults |
| `navigation` | Navigation guard policy | `same-origin` |

### `observe`

This can only be used in `screenreader` mode.
 
| Field | Description | Default |
|------|-------------|---------|
| `pollIntervalMs` | Interval for checking new announcements in ms | `100` |
| `silenceWindowMs` | How long silence must last to count as silence | `500` |
| `maxObserveMs` | Maximum observation time in ms | `3000` |
| `allowFallback` | Whether to allow a fallback sentence when the log is empty | `false` |

`task.config.observe` partially overrides `rawstep.config.ts > modes.screenreader.observe`.  
For example, if the config has `silenceWindowMs` and the task only provides `maxObserveMs`, the runtime merges the two values.

The same idea applies to `providerOptions`: task-level values are merged on top of `defaults.providerOptions` by provider name and option key, instead of replacing the whole object.

### `planning`

Planning controls the initial plan and the reflection cadence during the run.

| Field | Description |
|------|-------------|
| `enabled` | Whether planning / reflection is used |
| `reflectionCadence` | How many steps between reflections |
| `initialDelaySteps` | How many steps to wait before starting planning |
| `firstReflectionDelaySteps` | Delay before the first reflection |

Defaults vary by mode.

- `keyboard`: planning starts immediately, reflection cadence 10
- `screenreader`: planning starts after 3 steps, reflection cadence 10

### `navigation`

The navigation guard is the policy that prevents movement outside the task boundary.

| Field | Description |
|------|-------------|
| `strategy: "same-origin"` | Allow only the same origin |
| `strategy: "start-url-prefix"` | Allow only the start URL prefix |
| `strategy: "allow-url-list"` | Allow only prefixes listed in `allowUrlList` |

In plain words, this is the safety device that prevents the run from jumping to an external page or outside the task scope by mistake.

---

## Action `hint`

You can attach a `hint` to each item in `allowedKeys` or `allowedScreenReaderActions`.

```ts
keyboard: {
  allowedKeys: [
    kb.tab({ hint: "Use this to move to the next focus target." }),
    kb.enter({ hint: "Use this to activate the currently focused element." })
  ]
},
screenreader: {
  allowedScreenReaderActions: [
    sr.next({ hint: "Use this to move to the next item." }),
    sr.act({ hint: "Use this to run the default action on the current item." })
  ]
}
```

The configured `hint` is rendered into the `availableActions` list in the user prompt for each step.  
Example: `sr.act: Use this to run the default action on the current item.`

> **Note:** If values are overridden with CLI flags such as `--allowed-keys` or `--allowed-screen-reader-actions`, the `hint` configured in the file is not passed into prompts. `hint` can only be configured through the `kb.*` / `sr.*` helpers in `rawstep.config.ts`.
