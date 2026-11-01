# Task file

Look-up reference for the task JSON file: what a task may contain, how its goal is checked, how named inputs are hidden, where the simulated user may navigate, and what the site needs of the browser. For how a task fits into a run see [concepts.md](../concepts.md); to write your first one see [getting-started.md](../getting-started.md). Registering a task in the config is in [config.md](config.md#tasks).

A task says what to do and what the site needs: the start page, the goal, how Rawstep recognises that the goal is reached, and what the site needs of the browser. Who the user is and how they move is the run profile's job.

## Fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `url` | text | required | Start page. See [how URLs resolve](#how-urls-resolve). |
| `goal` | text | required | What the user wants, in plain words. The planner reads it as written. |
| `verify` | `{ "all": [rule, ...] }` | required, at least one rule | How Rawstep recognises the goal is reached. See [completion checks](#completion-checks-verify). |
| `context` | text, up to 1000 characters | none | What the user knows before starting, as the person who sets up the task: the kind of site and page ("an online store; a product page"), or what a search result said. Not this page's structure, which a user only learns by moving through it. The planner reads it. |
| `id` | text | none | Free-form label. A registered task is identified by its `id` in `rawstep.config.json`, not by this one. |
| `maxSteps` | integer, at least 1 | `40` | Most steps the run takes. One step is one action. |
| `timeoutMs` | integer 1 to 3600000 | `120000` | Time limit for the run's page time, in milliseconds. Time spent waiting for the planner does not count (each planner call has its own limit, the connection's `timeoutMs`), nor does time a person spends passing a bot check. |
| `input` | `{ name: value }`, strings | none | Named values the user may type. See [named inputs](#named-inputs). |
| `inputOptions` | `{ name: { sensitive?, description? } }` | none | Per-input handling. Each key must be a name in `input`. |
| `navigation` | object | `{ "strategy": "same-origin" }` | Where the user may go. See [navigation](#navigation). |
| `browser` | object | `{ "mode": "launch" }` | What the site needs of the browser. See [browser](#browser). |
| `profile` | page environment object or built-in name | none | Accepted in the file but ignored by `rawstep run` and the dashboard: a run uses the run profile's `page` ([config.md](config.md#page-environments)). It is still checked like a `page`, so an unknown field or name is an error. |

Unknown fields are rejected. The file is read as JSON; there are no comments.

A run that has not reached the goal when `maxSteps` or `timeoutMs` runs out ends as not measured. A goal that was reached on the very last step counts as reached.

### How URLs resolve

| `url` | Becomes |
|---|---|
| `http://`, `https://` or `file://` URL | Used as it is. Other schemes are an error. |
| Relative or absolute file path (`rawstep/demo/page.html`, `/home/me/page.html`, `C:\pages\a.html`) | A `file://` URL of that file. |

A relative path is resolved from:

| How the task runs | Relative paths resolve from |
|---|---|
| Registered in `tasks` of `rawstep.config.json` (`npx rawstep run demo`, the dashboard) | The project folder (where the config is). |
| Run by file path (`npx rawstep run examples/tasks/simple-cta.json`) | The folder of the task file. |

So the demo task's `"url": "rawstep/demo/page.html"` works because the task is registered. The files in `examples/tasks/` use `../../fixtures/...` because they are run by path from a checkout.

## Completion checks (`verify`)

`verify.all` lists rules that must all hold at once. Rawstep checks them after every action, from the page itself: the planner never sees them, and they do not steer the run. When they hold, the goal is reached.

A rule is an object with exactly one rule key (except `event`, which may add `after`). Text arguments are 1 to 200 characters unless noted. Rules nest at most four levels deep.

### Page rules

| Rule | Holds when |
|---|---|
| `{ "titleIncludes": "text" }` | The page title contains the text (case-sensitive). |
| `{ "urlIncludes": "text" }` | The current URL contains the text. |
| `{ "textVisible": "text" }` | Some visible element contains the text. Matched like Playwright's `getByText`: case-insensitive, whitespace-normalised, substring. An input button counts by its value. |
| `{ "textVisibleExact": "text" }` | Some visible element's whole text equals the text (Playwright `getByText` with `exact`: case-sensitive). |
| `{ "activatedAnnouncementIncludes": "text" }` | The speech heard in the window of the latest activation contains the text. Fails if nothing was activated yet. |
| `{ "domEventSeen": { "selector": "css", "event": "click" } }` | The DOM event happened on an element matching the selector. |
| `{ "requestSeen": { "urlIncludes": "text", "method"? } }` | A network request whose URL contains the text was made (optionally with that HTTP method). |
| `{ "responseSeen": { "urlIncludes": "text", "method"?, "status"? } }` | A response matched likewise (optionally with that status, 100 to 599). |

### Page observer rules

These read what the page observer recorded during the run. Initial focus and changes before the first action are included only where noted.

| Rule | Holds when |
|---|---|
| `{ "event": { "kind": ..., "role"?, "name"?, "text"?, "attr"?, "value"?, "url"? }, "after"?: "start" \| "lastActivation" }` | A change of that `kind` was recorded and every other field you list matches. |
| `{ "focused": { "role"?, "name"? } }` | Keyboard focus is now on an element with that role and/or name. At least one of the two is required. A focus recorded at page load counts. |

`event.kind`:

| Kind | A change of this sort was recorded |
|---|---|
| `focus`, `focus-lost` | Focus moved onto an element; focus left it. |
| `appeared`, `disappeared` | A dialog, alert, status or log region (`dialog`, `[role=dialog]`, `[role=alertdialog]`, `[role=alert]`, `[role=status]`, `[role=log]`) was added or removed, or a `<dialog>` opened or closed. |
| `live-region` | A live region (alert, status, log) got new content. |
| `state` | A checkbox or radio changed `checked`, or an observed attribute changed (`attr`, `value`). |
| `submit` | A form was submitted. |
| `navigation` | The page navigated (`url`). |
| `page-blur`, `page-focus` | Keyboard focus left the page for browser UI or another window; it came back. |

`event.name`, `event.text` and `event.url` take a [text matcher](#text-matchers). `event.role`, `event.attr` and `event.value` are exact strings. `after` defaults to `start`: the initial page load never counts, only changes from the first action on. `lastActivation` counts only changes since the latest activation (it fails if there was none yet).

`event` and `focused` need the page observer, which the browser runs record by default. Without its data they fail.

### Combining rules

| Rule | Holds when |
|---|---|
| `{ "not": rule }` | The inner rule does not hold. Fails when the inner rule could not be checked, so absence is never assumed. |
| `{ "any": [rule, ...] }` | At least one of 1 to 20 inner rules holds. |

`verify.all` is the "and"; use `any` for "or".

### Text matchers

Used by `event.name`, `event.text`, `event.url` and `focused.name`.

| Form | Matches |
|---|---|
| `"text"` | Includes the text. |
| `{ "includes": "text" }` | Includes the text. |
| `{ "equals": "text" }` | The whole text equals it. |
| `{ "regex": "pattern", "flags"?: "i" }` | The pattern matches anywhere. Pattern up to 200 characters; flags only from `i`, `m`, `s`, `u`. |

### Script rule

For goals the rules above cannot express.

| Rule | Holds when |
|---|---|
| `{ "script": { "source": "...", "description": "..." } }` | The function in `source` returns `true`. |

- `source` is a JavaScript function expression, `(context) => boolean` (may be `async`), up to 4000 characters. `description` says in plain words what it checks, up to 300 characters.
- It runs in an isolated world of the page: it reads the DOM but cannot see or change the page's own JavaScript. `context.timeline` lists observer events (`kind`, `step`, `role`, `name`, `text`, `attr`, `value`, `url`, `sameDocument`).
- It has 2 seconds. Timing out, throwing or returning a non-boolean fails the rule.
- Network APIs are removed there, but that is a guard, not a sandbox. Only add code a person has read.
- A script may not contain the value of a sensitive input of 4 or more characters.

```json
{ "script": { "description": "The cart badge shows 1", "source": "() => document.querySelector('[data-cart-count]')?.textContent.trim() === '1'" } }
```

### Choosing checks

- Reaching the goal is one signal among others, not a verdict. A check should say what a person would look for to know it worked.
- Text rules (`textVisible`, `textVisibleExact`, `activatedAnnouncementIncludes`, `titleIncludes`, also inside `any`) double as the words a user could hear when the goal is reached. If none of them is heard after the goal is reached, the run continues for `confirmationGrace` more actions ([config.md](config.md#run-rules)) before it stops. Rules on URLs, requests or scripts give no such words.
- A goal that already holds at page load gives weak evidence about the steps taken.

## Named inputs

`input` maps names to the values the user may type, for example a login. The task author decides what is typed; the plan decides when and where. The planner and its history only ever see the name.

```json
{
  "input": { "email": "traveler@example.com", "password": "super-secret", "query": "red shoes" },
  "inputOptions": {
    "email": { "description": "Account email address" },
    "query": { "sensitive": false, "description": "Product search term" }
  }
}
```

| `inputOptions` field | Type | Default | Meaning |
|---|---|---|---|
| `sensitive` | boolean | `true` | Keep the value away from the planner and out of saved records. Set `false` for harmless values (a search term, a quantity): the planner then sees the value. |
| `description` | text, 1 to 200 characters | none | Shown to the planner next to the name, so it knows what the input is for. |

An input is typed only when the profile's `actions` allow it: `typeText` or `replaceText` on, and the name in `inputKeys` if that is set ([config.md](config.md#actions)).

### How sensitive values are hidden

| Where | What happens |
|---|---|
| Task `goal` and `context` | The file is rejected if either contains the value of a sensitive input of 4 or more characters. Refer to the input by name. |
| Speech given to the planner | The value (also URL-encoded, form-encoded and JSON-escaped) is replaced by `[REDACTED]` when it is 4 or more characters. |
| The speech right after typing a sensitive value | Withheld from the planner: it hears `[typed input withheld]`. |
| Saved run records after the first sensitive typing | Speech, planner evidence, page diagnostics, screenshots and the details of failed checks are replaced by `[REDACTED]` or left out. |
| Non-sensitive inputs | Typed values stay readable in the record. |

Limits:

- Values shorter than 4 characters are not masked in later speech (that would damage unrelated text). Only the withheld speech after typing covers them.
- Text the page copies into other elements is masked only when it contains the whole value.
- A planner can still infer a value from page behaviour, such as validation messages or where a form leads.
- Do not put a real password in a task file you commit. Use a test account.

## Navigation

`navigation` limits where the user may go. A blocked navigation is not followed and is recorded in the run. Default: `{ "strategy": "same-origin" }`.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `strategy` | `same-origin`, `start-url-prefix`, `allow-url-list` | `same-origin` | Which URLs top-level navigation may reach. |
| `allowUrlList` | list of `http(s)` URL prefixes | required for `allow-url-list` | Not allowed with the other strategies. No credentials in the URLs. |
| `readOnly` | boolean | `false` | Browse without changing anything. See below. |
| `denyUrlIncludes` | list of text, up to 100, each up to 200 characters | none | Never go to (or request) a URL containing any of these, compared case-insensitively. |

| Strategy | Allowed |
|---|---|
| `same-origin` | URLs with the same origin as the start page. For a `file://` start page: files in the same folder. |
| `start-url-prefix` | URLs on the same origin that start with the start URL (without its `#` part). |
| `allow-url-list` | URLs on the same origin as, and starting with, one of the listed prefixes. |

In every case only `http`, `https` and `file` URLs without credentials are allowed.

`readOnly: true`:

- Blocks requests other than GET, HEAD and OPTIONS before they are sent, and blocks form submissions other than GET.
- Stops the run when the first response is 401, 403, 407 or 429, or the page looks like a bot check or access-denied page. It does not log in or work around the block.
- Does not protect against a site that changes data through GET.

## Browser

`browser` says what the site needs of the browser. It belongs to the task, like the start page, because it depends on the site and not on who tries it. Leave it out and Rawstep launches its own browser.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `launch` or `connect` | required inside `browser` | `launch`: Rawstep starts a browser for each run. `connect`: the run uses a Chrome you started yourself with `--remote-debugging-port`, at the address in `machine.browserEndpoint` ([config.md](config.md#machine)). A site sees that Chrome as an ordinary browser. Each run gets its own isolated context in it, and your own windows are not touched. |
| `copySignIn` | boolean | `false` | Only with `mode: "connect"` (otherwise the task is rejected). Each run's fresh context starts with a copy of that Chrome's cookies and site storage, so a page behind a sign-in opens signed in. |
| `personCheck` | boolean | `false` | For a site with a human check (a bot check). The run uses a visible window and pauses while you pass the check in it. Rawstep never answers a check itself. With `mode: "launch"` the browser keeps its profile in `.rawstep/browser-profile`, so those runs go one at a time. |

Unknown fields are rejected. The address of your Chrome is not in the task: it belongs to the computer, so it is set once in `machine.browserEndpoint`. A run of a `connect` task while that address is empty does not start (`browser-endpoint-missing`), and `npx rawstep doctor` says so. `machine.proxyServer` does not apply to a Chrome you started yourself, which has its own proxy settings; Rawstep warns when both are set.

A site behind a sign-in, using the Chrome you are already signed in with:

```json
{
  "url": "https://shop.example.com/account",
  "goal": "Open the order history.",
  "verify": { "all": [{ "textVisible": "Your orders" }] },
  "browser": { "mode": "connect", "copySignIn": true }
}
```

A site with a human check, in a browser Rawstep launches:

```json
{
  "url": "https://shop.example.com/",
  "goal": "Open the first product.",
  "verify": { "all": [{ "urlIncludes": "/product/" }] },
  "browser": { "mode": "launch", "personCheck": true }
}
```

In the dashboard this is the Browser choice in the task editor.

## Examples

The demo task `rawstep init` writes (`rawstep/demo/task.json`):

```json
{
  "url": "rawstep/demo/page.html",
  "goal": "Add the Demo mug to the cart.",
  "maxSteps": 20,
  "verify": { "all": [{ "textVisible": "Added to cart" }] }
}
```

A login with named inputs (`examples/tasks/login.json`; `password` has no `inputOptions` entry, so it is sensitive):

```json
{
  "id": "login",
  "url": "../../fixtures/credential-login.html",
  "goal": "Enter the email and password input values into their respective fields, press the Sign in button, and leave the page in a state where the login success message is visible.",
  "maxSteps": 24,
  "timeoutMs": 180000,
  "input": { "email": "traveler@example.com", "password": "super-secret" },
  "verify": { "all": [{ "textVisible": "Signed in." }, { "titleIncludes": "Credential Login Completed" }] }
}
```

Several checks, a non-sensitive input and a navigation limit:

```json
{
  "url": "https://shop.example.com/search",
  "goal": "Search for a mug and open the first result.",
  "context": "An online store; the search page.",
  "input": { "query": "mug" },
  "inputOptions": { "query": { "sensitive": false, "description": "Search term" } },
  "navigation": { "strategy": "start-url-prefix", "readOnly": true, "denyUrlIncludes": ["/checkout"] },
  "verify": {
    "all": [
      { "urlIncludes": "/product/" },
      { "any": [{ "textVisible": "Add to cart" }, { "focused": { "role": "button", "name": { "includes": "cart" } } }] },
      { "not": { "event": { "kind": "navigation", "url": { "includes": "/checkout" } } } }
    ]
  }
}
```

More task files are in [examples/](../../examples/README.md).
