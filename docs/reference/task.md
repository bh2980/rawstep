# Task File Reference

Complete specification for task JSON files (`tasks/*.json`), validated by `resolveTask()` in [`packages/core/src/contracts/index.ts`](../../packages/core/src/contracts/index.ts).

---

## 1. Example Task File

```json
{
  "id": "account-login",
  "url": "https://example.com/login",
  "goal": "Sign in to the customer portal using the provided email and password.",
  "context": "ExampleShop customer portal login page.",
  "maxSteps": 40,
  "timeoutMs": 120000,
  "input": {
    "email": "reader@example.com",
    "password": "correct-horse-battery-staple"
  },
  "inputOptions": {
    "email": {
      "sensitive": false,
      "description": "Account email address"
    },
    "password": {
      "sensitive": true,
      "description": "Account password"
    }
  },
  "navigation": {
    "strategy": "same-origin",
    "readOnly": false,
    "denyUrlIncludes": ["/logout", "/delete-account"]
  },
  "browser": {
    "mode": "launch",
    "personCheck": false
  },
  "verify": {
    "all": [
      { "urlIncludes": "/dashboard" },
      {
        "event": {
          "kind": "appeared",
          "role": "heading",
          "name": { "includes": "Welcome" }
        },
        "after": "lastActivation"
      }
    ]
  }
}
```

---

## 2. Top-Level Fields

| Field | Type | Default | Constraints & Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` *(optional)* | *(Omitted)* | Non-empty task identifier recorded in trace metadata. |
| `url` | `string` | *(Required)* | Starting URL (`http://`, `https://`, `file://`, or a local HTML file path). A relative path resolves against the task file's directory when run as `rawstep run <file>`, and against the project root for tasks registered in `rawstep.config.json`. |
| `goal` | `string` | *(Required)* | Plain-language goal given to the planner. **Must not contain the value of any sensitive input ($\ge 4$ chars).** |
| `context` | `string` *(optional)* | *(Omitted)* | Up to `1000` characters describing what a real user already knows before starting (e.g., site type or prior search query). Must not contain sensitive input values or hidden page structure hints. |
| `profile` | `string \| EnvironmentProfile` *(optional)* | *(Unset)* | Page environment profile override (a built-in preset such as `narrow`, `text-200`, or `forced-colors`, or a custom object; see [Page Environments](config.md#33-page-environments-page)) when running the task directly outside a Run Profile. |
| `maxSteps` | `number` *(optional)* | `40` | Maximum actions in a run before stopping as `unmeasured` (`max-steps`). Integer `≥ 1`. |
| `timeoutMs` | `number` *(optional)* | `120000` | Run time budget in milliseconds (integer `1–3600000`). Time spent waiting for a human in `personCheck` does not count against this budget. |
| `input` | `Record<string, string>` *(optional)* | `{}` | Map of named string values the simulated user can type into form fields (`typeText` / `replaceText`). |
| `inputOptions` | `Record<string, { sensitive?: boolean, description?: string }>` *(optional)* | `sensitive: true` | Per-input privacy and description settings. Every key must also exist in `input`; `description` is a non-empty string of up to 200 chars. Every input in `task.input` is **sensitive by default** unless `"sensitive": false` is set. |
| `navigation` | `NavigationPolicy` *(optional)* | `{ "strategy": "same-origin" }` | Origin boundary and HTTP method safety rules. |
| `browser` | `TaskBrowser` *(optional)* | `{ "mode": "launch" }` | Controls whether Rawstep launches a fresh browser or connects to an existing Chrome instance, and whether a human solves bot checks (`personCheck`). |
| `verify` | `{ all: VerifyRule[] }` | *(Required, non-empty)* | Independent completion rules. All rules in `verify.all` must pass simultaneously for the run to end as `reached`. |

---

## 3. Browser Settings (`browser`)

Some sites require an existing signed-in browser session or present human bot challenges (Cloudflare Turnstile, hCaptcha, reCAPTCHA):

```json
"browser": {
  "mode": "connect",
  "copySignIn": true,
  "personCheck": true
}
```

- **`mode` (`'launch' | 'connect'`, default `'launch'`):**
  - `'launch'`: Rawstep starts its own Chromium browser instance.
  - `'connect'`: Connects to a Chrome browser you started yourself with `--remote-debugging-port` (at the address configured in `machine.browserEndpoint` in `rawstep.config.json`, e.g., `http://localhost:9222`). Each run opens an isolated browser context inside that Chrome instance.
- **`copySignIn` (`boolean`, optional, only when `mode === 'connect'`):**
  - Starts the run's isolated browser context with a copy of the connected Chrome's cookies and `localStorage` so the simulated user starts already signed in.
- **`personCheck` (`boolean`, optional):**
  - Opens a visible browser window (`headless: false`). When Rawstep detects a bot challenge page, it pauses the run and waits for a person to pass the challenge in that window, crediting the wait time back to `timeoutMs`. In `launch` mode, `personCheck` keeps a persistent browser profile in `.rawstep/browser-profile` and runs one at a time.

---

## 4. Navigation Policy (`navigation`)

```json
"navigation": {
  "strategy": "same-origin",
  "readOnly": true,
  "denyUrlIncludes": ["/logout", "/billing"]
}
```

- **`strategy`:**
  - `'same-origin'` *(default)*: Only allows URLs matching the exact protocol, hostname, and port of the starting `url`.
  - `'start-url-prefix'`: Only allows URLs beginning with the starting `url`'s path prefix.
  - `'allow-url-list'`: Requires a non-empty `allowUrlList: string[]` of allowed HTTP(S) URL prefixes (without embedded credentials). `allowUrlList` is rejected with the other two strategies.
- **`readOnly` (`boolean`, optional):** When `true`, blocks all state-mutating HTTP requests, allowing only `GET`, `HEAD`, and `OPTIONS`.
- **`denyUrlIncludes` (`string[]`, optional):** Blocks any navigation whose URL contains any listed substring (up to 100 non-empty strings, max 200 chars each).
- **Redirect & Popup Enforcement:** Enforced hop-by-hop across HTTP redirects (up to 10 hops) via CDP `Fetch.requestPaused`. New popup windows (`target="_blank"`, `window.open`) are closed before loading.

---

## 5. Input Privacy (`input` & `inputOptions`)

1. **Sensitive by default:** Every key in `task.input` defaults to `sensitive: true`.
   - For `"sensitive": true` inputs, the planner only sees the input's key name and `description` (never its value).
   - For `"sensitive": false` inputs (such as a product search term), the planner sees the value so it knows what it is typing.
2. **Load-time leak check:** If a sensitive input value has 4 or more characters and appears inside `goal`, `context`, or any `script.source` rule, `resolveTask()` throws an error before the run starts.
3. **Trace & speech redaction:** Once a sensitive input is typed during a run:
   - The speech output for the typing step is withheld (`"[typed input withheld]"`).
   - Any occurrence of the sensitive value ($\ge 4$ chars)—including its `encodeURIComponent`, form-encoded, and JSON-escaped variants—is replaced with `"[REDACTED]"` across all subsequent speech observations, trace events, and reports.
   - Post-input diagnostic screenshots are omitted so unmasked field text is never saved to disk.

---

## 6. Independent Verification Rules (`verify.all`)

Every rule in `verify.all` is evaluated independently in the browser after each step (`not` and `any` may be nested inside each other up to 4 levels deep). Each rule other than `event` has exactly one key; the `event` rule may add `after`. String values must be non-empty.

| Rule Key | Shape | Passes When |
| :--- | :--- | :--- |
| **`urlIncludes`** | `{ "urlIncludes": "/success" }` | Current page URL contains the substring. |
| **`titleIncludes`** | `{ "titleIncludes": "Receipt" }` | `document.title` contains the substring. |
| **`textVisible`** | `{ "textVisible": "Order confirmed" }` | Any visible element on the page contains the substring. |
| **`textVisibleExact`** | `{ "textVisibleExact": "Paid" }` | Any visible element on the page matches the exact string. |
| **`focused`** | `{ "focused": { "role"?: string, "name"?: TextMatcher } }` | Current keyboard focus is on an element matching `role` and/or `name` (at least one is required). |
| **`event`** | `{ "event": { "kind": ObservedEventKind, "role"?, "name"?, "text"?, "attr"?, "value"?, "url"? }, "after"?: "start" \| "lastActivation" }` | Page observer recorded a matching event (`'focus'`, `'focus-lost'`, `'appeared'`, `'disappeared'`, `'live-region'`, `'state'`, `'submit'`, `'navigation'`, `'page-blur'`, `'page-focus'`) since the run started (`"start"`, default) or since the latest activation (`"lastActivation"`). |
| **`activatedAnnouncementIncludes`** | `{ "activatedAnnouncementIncludes": "Added" }` | Screen-reader speech collected in the latest activation window contains the substring. |
| **`domEventSeen`** | `{ "domEventSeen": { "selector": "form#pay", "event": "submit" } }` | Tracked DOM event fired on an element matching `selector`. |
| **`requestSeen`** | `{ "requestSeen": { "urlIncludes": "/api/cart", "method"?: "POST" } }` | Browser sent an HTTP request matching `urlIncludes` (and optional `method`). |
| **`responseSeen`** | `{ "responseSeen": { "urlIncludes": "/api/cart", "method"?: "POST", "status"?: 200 } }` | Browser received an HTTP response matching `urlIncludes`, optional `method`, and optional HTTP `status` (integer `100–599`). |
| **`not`** | `{ "not": VerifyRule }` | Inner `VerifyRule` evaluates to `false` (fails closed if inner evidence is unavailable). |
| **`any`** | `{ "any": VerifyRule[] }` | At least one rule in the `any` array (`1–20` items) passes. |
| **`script`** | `{ "script": { "description": string, "source": "(ctx) => boolean" } }` | `description` is required (up to 300 chars). Function expression `source` (`<= 4000` chars; it must start like a function, e.g. `(ctx) =>`, `async (ctx) =>`, or `function`) returns `true` in isolated CDP world `rawstep-verify` (all network APIs disabled, `2000 ms` timeout). `ctx.timeline` contains the observer events recorded so far. |

### Checking a Task Before Its First Run

A run ending says something about the page only when the task itself holds. Before a batch, check these by hand on the real page:

- **The rules mean the goal, no more and no less.** Open the page where a person would have what the goal asks for, and check that the rules pass there. Then open pages that come close but are wrong (the list instead of the detail, another item with the same name, a different day) and check that they fail. A rule stricter than the goal (a tab selected, when the answer is already read out in a list) turns a reached goal into `mistaken`.
- **The answer does not change between runs.** Avoid rankings, "today's" items and anything else the site reorders.
- **Every input can be entered.** Type each `input` value into its field yourself. On a native screen reader, text the keys cannot type is pasted on VoiceOver and fails on NVDA (see [Screen Readers](../screen-readers.md)).
- **The goal says what the person wants, not how.** Leave out keys, routes and where things are on the page.

### `TextMatcher` Formats
Fields typed as `TextMatcher` (`focused.name`, `event.name`, `event.text`, `event.url`) accept strings up to 200 characters in any of four formats:
- `"Checkout"` (case-sensitive substring)
- `{ "includes": "Checkout" }` (case-sensitive substring)
- `{ "equals": "Checkout" }` (exact match)
- `{ "regex": "^Checkout \\(\\d+\\)$", "flags": "i" }` (regular expression; allowed flags: `i`, `m`, `s`, `u`)
