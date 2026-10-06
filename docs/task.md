# Current task format

Tasks contain `url`, `goal`, nonempty `verify.all`, and optional `id`, `mode`, `maxSteps`, `timeoutMs`, `input`, `inputOptions`, and `navigation`. `input` maps names to string values; policies refer to names instead of supplying arbitrary literal text. Relative start URLs resolve from the project root for tasks registered in `rawstep.config.json`, and from the task file's directory for a task file run directly. Keyboard tasks run on the screenshot backend (`npx rawstep run <task> --mode keyboard`).

## Inputs

`input` maps names to string values. The task author decides what is typed; the decision policy (usually a model) decides when and into which field. The policy sees each input's name, whether it is sensitive and an optional description. It never sees a sensitive value; the value of an input marked `sensitive: false` (a search term) is shown in its candidate, such as `Type "Thor Hammer" (input searchTerm: product to search for)`, so the model knows what it would type. The runner types the real value when the policy asks to enter a named input.

`inputOptions` configures individual inputs. Each key must be a name from `input`, and each entry accepts only:

- `sensitive` (boolean, default `true`): the value is kept out of what the policy observes. In keyboard mode the field is shown as dots in screenshots, and in screen reader mode the value is replaced with `[REDACTED]` in speech, and the speech right after typing it is withheld. Set `false` for harmless values such as a search term, which are then not masked.
- `description` (string, 1 to 200 characters): shown to the model next to the input name, so it knows what the input is for.

```json
{
  "url": "fixtures/login.html",
  "goal": "Sign in with the stored email and password",
  "input": { "email": "traveler@example.com", "password": "super-secret", "query": "red shoes" },
  "inputOptions": {
    "email": { "description": "Account email address" },
    "query": { "sensitive": false, "description": "Product search term" }
  },
  "verify": { "all": [{ "titleIncludes": "Welcome" }] }
}
```

Here `password` has no entry, so it is sensitive. `resolveTask` rejects the task when `goal` contains the value of a sensitive input that is 4 or more characters long, because the goal is sent to the model as written. Refer to the input by name instead, as above. A goal may contain a value shorter than 4 characters, or the value of an input with `sensitive: false`.

Masking is best effort. Values shorter than 4 characters are only covered by withholding the typing step's speech. A value shown elsewhere on the page (for example "Hello Alice") is not masked in screenshots; the focused field itself is, including inside open shadow roots. The model may also infer a value from page behavior. See [Hiding input values from the policy](#hiding-input-values-from-the-policy).

## Hiding input values from the policy

The decision policy (usually a model) must not learn sensitive input values. Inputs are sensitive unless the task sets `inputOptions.<name>.sensitive: false`; `resolveTask` also rejects a goal that contains the value (4 or more characters) of a sensitive input. The runner passes `sensitive` on every `typeText`/`replaceText` backend action and builds a policy-facing view of observations. The saved trace is unchanged and keeps its own redaction rules (see [report](./report.md)).

- **Screenshots (keyboard mode).** Before typing a sensitive value, the screenshot backend marks the focused field with `data-rawstep-mask`. While capturing an observation it sets `-webkit-text-security: disc !important` on marked fields through the CSSOM (so a page CSP cannot block it) and restores the field's previous inline value right after the capture. The field shows dots in the policy's screenshot and its real value in the page.
- **Speech (screen reader mode).** Sensitive values of 4 or more characters, including their URL and form-encoded forms, are replaced with `[REDACTED]` in observation speech, both in the current observation and in `history`. The observation right after a successful sensitive `typeText`/`replaceText` has its whole speech replaced with `[typed input withheld]`, because a screen reader may echo the value character by character.

Limitations:

- Values shorter than 4 characters are not substring-masked in later speech, since that would damage unrelated text. Only withholding the typing step's speech covers them.
- The screenshot mask covers only the typed field. The same value re-rendered elsewhere on the page (for example "Hello Alice" after sign-in, or a form summary) is visible in screenshots; in speech it is masked only when the value has 4 or more characters.
- The mask follows the field that was focused when typing started, including fields inside open shadow roots; text the page copies into other elements is not masked.
- The model can still infer a value from page behavior, such as validation messages, search results, or which page the form leads to.

## Verification rules

`verify.all` lists independent rules, all of which must hold. The basic rules read the page directly: `titleIncludes`, `urlIncludes`, `textVisible`, `textVisibleExact`, `domEventSeen`, `requestSeen`, `responseSeen` and `activatedAnnouncementIncludes`. Timeline goal rules ask what changed on the page, not only what it looks like when the run ends.

| Rule | Passes when |
| --- | --- |
| `{ "event": { "kind": ..., "role"?, "name"?, "text"?, "attr"?, "value"?, "url"? }, "after"?: "start" \| "lastActivation" }` | The page observer recorded a change of that `kind` whose other listed fields all match. |
| `{ "focused": { "role"?, "name"? } }` | Keyboard focus is now on an element with that role and/or name. At least one of the two is required. |
| `{ "not": <rule> }` | The inner rule does not hold. |
| `{ "any": [<rule>, ...] }` | At least one of 1 to 20 inner rules holds. |
| `{ "script": { "source": "...", "description": "..." } }` | The reviewed function in `source` returns `true`. See below. |

`event.kind` is one of `focus`, `focus-lost`, `appeared`, `disappeared`, `live-region`, `state`, `submit`, `navigation`, `page-blur` (keyboard focus left the page for browser UI or another window), `page-focus`. `role` and `attr` are compared exactly, `value` must equal the recorded value, and `name`, `text` and `url` take a text matcher. Every listed field must match the same recorded change. `attr` and `value` apply to `state` changes, `url` to `navigation`, and `text` to changes that carry text such as `live-region`.

**Text matchers.** A plain string means "includes". The object forms are `{ "includes": "..." }`, `{ "equals": "..." }` (the whole text) and `{ "regex": "...", "flags": "i" }` (searched anywhere in the text; flags may only contain `i`, `m`, `s`, `u`). Matching is case-sensitive unless a regex flag says otherwise. A matcher object takes exactly one of the three forms. Strings are at most 200 characters, and an invalid regular expression is rejected when the task is loaded.

**`after`.** The initial page load never counts: by default (`"after": "start"`) only changes recorded after the first action, step 1 onward, are considered, so a page that already shows the goal at load does not satisfy an `event` rule. `"after": "lastActivation"` only counts changes from the latest successful activation step onward, which ties the change to the most recent activation. It fails while no activation has happened yet.

**`focused`.** It reads the most recent focus record, so it is false after a `focus-lost` change until focus lands on an element again. A focus recorded at initial load counts, because the rule describes where focus is now.

**`not` and `any`.** Rules may nest up to four levels deep. A violated `not` fails with the inner rule's witnesses as the evidence; a passing `any` records the witnesses of the alternatives that held. A `not` passes whenever its inner rule does not hold, including when no observer data exists, so pair it with a rule that proves the page was observed.

**Page observer required.** `event` and `focused` rules read the page observer's timeline, which browser backends record by default (`observe: false` turns it off). Without observer data an `event` or `focused` rule fails with "page observer events are unavailable". A `not` or `any` built only on such rules fails too: without observation, absence cannot be established. The timeline is kept unredacted in memory for these rules and is never shown to the decision policy. Witnesses use the new `observer-event` kind; after text entry they are reduced to `kind`, `step` and `role` in the trace.

**Baseline and hint.** Before step 1 the runner evaluates the rules once with the built-in verifier and records a `verifier.baseline` trace event, for example `{ "passed": false, "rules": [{ "ruleIndex": 0, "ruleType": "event", "passed": false }, ...] }`. Only rule indexes, types and pass flags are kept, never witnesses or failure text; if evaluating throws, only the error name is stored. It never decides the outcome, and it is skipped when a custom `verifier` is supplied. `rawstep hints` turns it into a `goal-met-at-start` hint: `observed` when every rule already held before the first action, `suspected` when only some did. `not` rules are ignored because they hold at the start by design. A goal that was already met at load makes the later success weak evidence about the steps taken.

**Screenshot replay export.** `event` rules are accepted for exact-pixel replay export when their final verification carries a matching `observer-event` witness. `focused`, `not` and `any` rules are not accepted for replay export.

**`script`.** For goals the rules above cannot express. `source` is a JavaScript function expression, `(context) => boolean` (it may be `async`), and `description` says in plain words what it checks (at most 300 characters). It runs at verification time in an isolated world of the page: it reads the page DOM but cannot see or change the page's own JavaScript, and `context.timeline` lists the page observer events (`{ kind, role, name, text, attr, value, url }`). Each run is limited to 2 seconds, and a script that times out, throws or does not return a boolean fails the rule. Network APIs are removed from that world, but this is a guard, not a sandbox: the DOM can still load resources. Treat the code as untrusted until a person has read it. Never save a script written by a model or another person without reviewing it, and never put sensitive input values (passwords, tokens) in it. The dashboard shows the code read-only and asks for confirmation before it accepts a suggested script.

```json
{ "script": { "description": "The cart badge shows 1", "source": "() => document.querySelector('[data-cart-count]')?.textContent.trim() === '1'" } }
```

Example, run on `fixtures/friction-lab.html` with the keys `Tab, Tab, Tab, Enter`:

```json
{
  "url": "fixtures/friction-lab.html",
  "goal": "Add the item to the cart",
  "verify": {
    "all": [
      { "event": { "kind": "live-region", "role": "status", "text": "Added to cart" } },
      { "any": [
        { "event": { "kind": "appeared", "role": "alert", "name": { "regex": "cart", "flags": "i" } } },
        { "titleIncludes": "Nope" }
      ] },
      { "not": { "event": { "kind": "focus-lost" } } },
      { "titleIncludes": "Friction" }
    ]
  }
}
```

The run succeeds at step 4. Earlier verifications fail because the announcement has not happened yet, and the baseline shows `titleIncludes` and `not` already true with the `event` rule false, so `hints` reports a suspected `goal-met-at-start`.

See the [current README](../README.md) and the [source map](./editing-map.md). Historical workspace-specific instructions were removed with their implementation.

## Initial focus

The runner never moves focus to an element before the first action: like a real user, a run starts on the document with nothing focused unless the page uses `autofocus`, so skip links and Tab counts are measured as users meet them. It records `browser.initial-focus` (`documentHasFocus`, the focused element if any). If the page does not have keyboard focus, the runner focuses the page window, not an element. A native screen-reader run that still cannot give the page focus is refused, because real OS key presses would reach browser UI or another window. During a run, `page-blur` observer events become `focus-left-page` hints.
