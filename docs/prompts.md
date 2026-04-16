# Prompt Templates

Prompt files are loaded from the root `prompt/` directory by default.  
If you want to use a different directory, set `rawstep.config.ts > defaults.prompt.dir`.

---

## File Structure

RawStep now uses different prompts for different stages.  
The selected prompt directory must contain all of the files below, and empty files are not allowed.

| File | Description |
|------|-------------|
| `keyboard.browse.system.md` | Rules for the keyboard browse stage |
| `keyboard.browse.user.md` | Input template for the keyboard browse stage |
| `keyboard.system.md` | Rules for the keyboard execute stage |
| `keyboard.user.md` | Input template for the keyboard execute stage |
| `screenreader.browse.system.md` | Rules for the screenreader browse stage |
| `screenreader.browse.user.md` | Input template for the screenreader browse stage |
| `screenreader.system.md` | Rules for the screenreader execute stage |
| `screenreader.user.md` | Input template for the screenreader execute stage |
| `planning.system.md` | Planning rules |
| `planning.user.md` | Planning input template |
| `reflection.system.md` | Reflection rules |
| `reflection.user.md` | Reflection input template |
| `experience-summary.system.md` | Experience summary rules |
| `experience-summary.user.md` | Experience summary input template |

`*.system.md` files contain fixed rules, and `*.user.md` files are templates filled with runtime data.  
Markdown comments (`<!-- ... -->`) are removed during loading and are not included in model input.

---

## When Each File Is Used

| File | When it is used |
|------|-----------------|
| `*.browse.*` | Initial context gathering before planning |
| `keyboard.system.md`, `keyboard.user.md` | Keyboard execute stage |
| `screenreader.system.md`, `screenreader.user.md` | Screenreader execute stage |
| `planning.*` | Initial plan generation |
| `reflection.*` | Mid-run strategy checks |
| `experience-summary.*` | Summary generation after the run ends |

In plain words, a run does not use just one prompt all the way through. It swaps templates based on the current stage.

---

## Placeholder List

At runtime, RawStep renders the current state into string blocks and fills the placeholders.

| File | Placeholder |
|------|-------------|
| `keyboard.browse.system.md` | `{{customSystemPrompt}}`, `{{outputExamples}}` |
| `keyboard.browse.user.md` | `{{customUserPrompt}}`, `{{goal}}`, `{{agentMemory}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentObservation}}` |
| `keyboard.system.md` | `{{customSystemPrompt}}`, `{{outputExamples}}` |
| `keyboard.user.md` | `{{customUserPrompt}}`, `{{goal}}`, `{{agentMemory}}`, `{{taskInputs}}`, `{{focusHint}}`, `{{availableActions}}`, `{{currentPlan}}`, `{{currentFocus}}`, `{{strategyNote}}`, `{{lastReflection}}` |
| `screenreader.browse.system.md` | `{{customSystemPrompt}}`, `{{outputExamples}}` |
| `screenreader.browse.user.md` | `{{customUserPrompt}}`, `{{goal}}`, `{{agentMemory}}`, `{{currentObservation}}`, `{{announcement}}`, `{{readbacks}}`, `{{taskInputs}}`, `{{availableActions}}` |
| `screenreader.system.md` | `{{customSystemPrompt}}`, `{{outputExamples}}` |
| `screenreader.user.md` | `{{customUserPrompt}}`, `{{goal}}`, `{{agentMemory}}`, `{{announcement}}`, `{{readbacks}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentPlan}}`, `{{currentFocus}}`, `{{strategyNote}}`, `{{lastReflection}}` |
| `planning.system.md` | `{{outputExamples}}` |
| `planning.user.md` | `{{goal}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentObservation}}` |
| `reflection.system.md` | `{{outputExamples}}` |
| `reflection.user.md` | `{{goal}}`, `{{currentPlan}}`, `{{currentFocus}}`, `{{strategyNote}}`, `{{recentSteps}}`, `{{recentMemory}}` |
| `experience-summary.user.md` | `{{taskSummary}}`, `{{aggregateSummary}}`, `{{stepTimeline}}` |

---

## Required Placeholders

If any of the values below are missing, loading fails immediately.

| File | Required placeholders |
|------|-----------------------|
| `keyboard.browse.system.md` | `{{outputExamples}}` |
| `keyboard.browse.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentObservation}}` |
| `keyboard.system.md` | `{{outputExamples}}` |
| `keyboard.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{taskInputs}}`, `{{availableActions}}` |
| `screenreader.browse.system.md` | `{{outputExamples}}` |
| `screenreader.browse.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{announcement}}`, `{{readbacks}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentObservation}}` |
| `screenreader.system.md` | `{{outputExamples}}` |
| `screenreader.user.md` | `{{goal}}`, `{{agentMemory}}`, `{{announcement}}`, `{{readbacks}}`, `{{taskInputs}}`, `{{availableActions}}` |
| `planning.system.md` | `{{outputExamples}}` |
| `planning.user.md` | `{{goal}}`, `{{taskInputs}}`, `{{availableActions}}`, `{{currentObservation}}` |
| `reflection.system.md` | `{{outputExamples}}` |
| `reflection.user.md` | `{{goal}}`, `{{currentPlan}}`, `{{currentFocus}}`, `{{strategyNote}}`, `{{recentSteps}}`, `{{recentMemory}}` |
| `experience-summary.user.md` | `{{taskSummary}}`, `{{aggregateSummary}}`, `{{stepTimeline}}` |

Values such as `{{customSystemPrompt}}`, `{{customUserPrompt}}`, `{{focusHint}}`, and `{{currentPlan}}` are optional.  
If the task file or runtime state does not provide them, they are rendered as an empty block or an empty-state block.

---

## Action Hints

If you set `hint` on `allowedKeys` or `allowedScreenReaderActions` in `rawstep.config.ts`, that value is also included in `{{availableActions}}`.

```ts
allowedKeys: [
  kb.tab({ hint: "Use this to move to the next focus target." }),
  kb.enter({ hint: "Use this to activate the currently focused element." })
]
```

Rendered result:

```text
- status: present
- items:
  - key.Tab: Use this to move to the next focus target.
  - key.Enter: Use this to activate the currently focused element.
```

If you override values with `--allowed-keys` or `--allowed-screen-reader-actions` from the CLI, the hints written in config are not passed through.

---

## Things to Watch Out For

- If you change a placeholder name, you also need to change the code.
- If even one prompt file is missing, the loader fails immediately.
- Browse, execute, planning, and reflection use different templates, so if you only change one stage and forget the overall structure, prompt behavior can become awkward.

In plain words, the prompt directory is no longer a simple 4-file layout. It is now a template bundle that covers the whole run flow.
