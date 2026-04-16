# Task

A task file is the main task body that says what should be done on which page.

---

## Quick Start

### Minimal Example

```json
{
  "url": "../../fixtures/simple-cta.html",
  "goal": "Find and activate the Get started button, then leave the page in a state where the result message is visible.",
  "verify": {
    "all": [
      { "textVisible": "Started!" },
      { "titleIncludes": "Completed" }
    ]
  }
}
```

### Example with `input`

```json
{
  "id": "login",
  "url": "../../fixtures/credential-login.html",
  "goal": "Enter the `email` and `password` input values into the email and password fields, press the Sign in button, and make the success message visible.",
  "mode": "screenreader",
  "maxSteps": 24,
  "timeoutMs": 180000,
  "input": {
    "email": "traveler@example.com",
    "password": "super-secret"
  },
  "verify": {
    "all": [
      { "textVisible": "Signed in." },
      { "titleIncludes": "Credential Login Completed" }
    ]
  }
}
```

---

## Field Reference

### Task Top-Level Keys

| Key | Required | Description |
|-----|----------|-------------|
| `url` | ✓ | URL of the page to run. Relative paths are resolved from the task file |
| `goal` | ✓ | Natural-language task goal |
| `verify` | ✓ | Success verification rules |
| `id` | | If omitted, RawStep uses a file-name-based ID |
| `prompt` | | Task-specific extra prompt. Can include `system` and `user` |
| `mode` | | `keyboard \| screenreader` |
| `maxSteps` | | Override for maximum steps |
| `timeoutMs` | | Override for timeout in ms |
| `input` | | Named string map, for example `email`, `password`, `otp` |
| `config` | | Task-level execution override (see below) |

### `prompt`

Use this when you want to add a short extra instruction on top of the shared templates for a specific task.

```json
{
  "prompt": {
    "system": "Ignore banners unrelated to checkout or login more aggressively.",
    "user": "For this task, prioritize finding the cart button over searching by product name."
  }
}
```

- `prompt.system`: injected into the system prompt template as `{{customSystemPrompt}}`
- `prompt.user`: injected into the user prompt template as `{{customUserPrompt}}`
- You can provide only one of them if needed
- If omitted, the value is replaced with an empty string

### `input`

This makes the agent type only real values declared by the task instead of inventing text. For example, the prompt can show `email="traveler@example.com"` with both label and value, and the response can return `{"action":"typeText","value":"traveler@example.com"}`.

> **Notes for the `screenreader` + `guidepup-voiceover` combination**  
> In this combination, `typeText` is handled specially. Actual text entry is performed through the browser-side input path, and if the value matches the expected value after input, the next observation provides a synthetic announcement such as `Email, current value traveler@example.com`.  
> This value is not a direct capture of the real VoiceOver speech. It is a stabilized replacement observation meant to reduce instability around text entry and speech collection. `guidepup-virtual` and `guidepup-nvda` keep the existing input/observation path.

### `config` Override

Task `config` accepts execution overrides. You still cannot put `provider`, `apiKey`, `model`, or `baseURL` inside it, but you can provide `providerOptions` when a specific task needs provider-specific request parameters.

If you use `config.outDir`, it is treated as the **output root directory**, not the final folder.  
The actual save location is `config.outDir/<taskId>/<runId>`, and if the path is relative, it is resolved from the task file.

```json
{
  "config": {
    "mode": "screenreader",
    "outDir": "./custom-out",
    "timeoutMs": 600000,
    "memory": "all",
    "headless": true,
    "providerOptions": {
      "openaiCompatible": {
        "reasoningEffort": "high"
      }
    },
    "screenReaderBackend": "guidepup-virtual",
    "allowedScreenReaderActions": ["sr.next", "sr.act"],
    "observe": {
      "silenceWindowMs": 1500,
      "maxObserveMs": 12000
    }
  }
}
```

> It is easier to read if shared execution values live in `rawstep.config.ts > modes.<mode>` and the task file only contains the task body. Use `config` only for exceptional overrides.

### `config.providerOptions`

Use this when one task needs provider-specific request fields that differ from the shared defaults.

Example:

```json
{
  "config": {
    "providerOptions": {
      "openaiCompatible": {
        "reasoningEffort": "high",
        "reasoningSummary": "detailed"
      }
    }
  }
}
```

RawStep merges `task.config.providerOptions` on top of `rawstep.config.ts > defaults.providerOptions` by provider name and option key.

That means:

- shared defaults stay in `rawstep.config.ts`
- task-specific differences can be added in the task file
- you do not need to repeat the entire `providerOptions` object just to override one field

---

## `verify` Reference

`verify` defines the task success rules. It must always be an `all` array, and the task succeeds only when **every** rule in that array passes. Each rule object must have **exactly one** key.

By default, the verifier runs when the agent declares `success`. If you enable `--verifier-auto-complete`, RawStep also checks after actions that may have succeeded.

### Rule Types

| Rule | Description |
|------|-------------|
| `textVisible` | Passes if the text is visibly present on the page. Partial match |
| `textVisibleExact` | Passes if the text appears as exactly matching visible text |
| `activatedAnnouncementIncludes` | Passes if the screenreader announcement right before the most recent successful activation action contains the given string |
| `titleIncludes` | Passes if `document.title` contains the given string |
| `urlIncludes` | Passes if the full current page URL contains the given string |
| `domEventSeen` | Passes if a specific DOM event was observed on a specific selector |
| `requestSeen` | Passes if any observed network request during the run matches the condition |
| `responseSeen` | Passes if any observed network response during the run matches the condition |

`requestSeen` and `responseSeen` accept `urlIncludes`, `method`, and `status`, where `method` and `status` are optional.  
`domEventSeen` accepts `selector` and `event`.

`activatedAnnouncementIncludes` is mainly useful in `screenreader` mode when you want to verify not "which result page did it reach?" but "which item did it activate?". For example, if both Like and Add to cart lead to a login page on a site, adding this together with a login URL verifier reduces false positives.

```json
{ "activatedAnnouncementIncludes": "Add to cart" }
{ "domEventSeen": { "selector": "button.add-to-cart", "event": "click" } }
{ "requestSeen":  { "urlIncludes": "/api/cart", "method": "POST" } }
{ "responseSeen": { "urlIncludes": "/api/cart", "method": "POST", "status": 200 } }
```

### Common Patterns

```jsonc
// Screen state change
{ "all": [{ "textVisible": "Started!" }, { "titleIncludes": "Completed" }] }

// Route change
{ "all": [{ "urlIncludes": "/checkout" }] }

// Form submission
{ "all": [{ "textVisible": "Signed in." }, { "responseSeen": { "urlIncludes": "/api/login", "status": 200 } }] }

// Even if it goes to a login page, confirm that it actually activated the cart item
{ "all": [{ "activatedAnnouncementIncludes": "Add to cart" }, { "urlIncludes": "/store/login/loginForm.do" }] }

// When an actual click event is more trustworthy than UI text
{ "all": [{ "domEventSeen": { "selector": "button.add-to-cart", "event": "click" } }] }

// When the success message must match exactly
{ "all": [{ "textVisibleExact": "Signed in." }] }
```
