# Screenshot-only keyboard exploration

Screenshot-only keyboard exploration (task mode `keyboard`) is separate from native or simulated screen-reader runs. No scripted fallback replaces inference failures or poor actions. See [SystemOne](./systemone.md) for multimodal model connections.

## Boundaries

- **Observation:** actual Chromium viewport PNG pixels, optionally the preceding PNG. The model receives the goal, allowed choice labels, named input keys, a bounded keyboard-action history and image-derived repetition counts
- **Model:** `ScreenshotModelAdapter.choose(request, { signal })`. It returns one declared choice ID, model identity/runtime and optional normalized probabilities/focus assessment. `ScreenshotDecisionPolicy` validates the response and never accepts coordinates, selectors, arbitrary input text or screen-reader intents
- **Actuation:** only `page.keyboard` presses/type calls. Tab, Shift+Tab, Enter, Space, Escape, arrows, Home/End, PageUp/PageDown, Backspace/Delete and task-provided named input are supported. No click, locator activation, DOM focus assignment or mouse fallback is used by this backend
- **Runner:** the existing budgets, navigation guard, focused-editability gate, cancellation, trace-persistence fail-closed behavior and independent verifier remain in force
- **Verification:** DOM/title/URL/network checks are separate `verifier` evidence. The safety input gate remains a `browser-diagnostic` event. Neither its result nor verifier content is sent to this screenshot model
- **Analysis:** saved images are grouped by exact SHA-256 identity; transitions link actions and the before/after observations. Reports distinguish distinct pixel states from inferred focus identity. Model focus statements remain explicitly uncertain

This is an interface boundary, not a sandbox for a trusted user-provided JavaScript policy or model module. Such code has the same process access as any other loaded local policy. The built-in HTTP path constructs its request from an explicit allowlist and never forwards the browser object, DOM/AX tree, selector, OCR text, verifier rules/results, policy rationale, or raw named input values.

## Run with a local model

Start a server implementing `rawstep-screenshot-choice-v1`, then register it in `rawstep.config.json` (via `npx rawstep ui`): a connection with provider `screenshot` whose `baseURL` is `http://127.0.0.1:8766/choose`, and a model on that connection with family `LLM` or `SystemOne`, protocol `choose`, `inputs: ["text", "image"]` and the `decision` role. Then:

```sh
npx rawstep run examples/screenshot/task.json --model onejev --mode keyboard
npx rawstep report .rawstep/runs/RUN_DIR
```

Each run writes a new directory under `.rawstep/runs/` (or `--out`), and `rawstep run` already writes `hints.json`, `analysis.json` and `report.html` there. Install Chromium with `npx playwright install chromium`, or set `machine.browserExecutablePath` to a trusted installed Chromium; `machine.headless` controls whether the browser is shown (headless is the default).

The HTTP adapter only accepts loopback endpoints by default, refuses credentials/query/fragment in endpoint URLs, and refuses redirects. A remote HTTPS endpoint requires `allowRemote: true` in the API. This explicitly transmits screenshot contents, the goal, choice labels and keyboard history to that server. Review the destination and visible page content before enabling it. No endpoint is contacted or model downloaded merely by importing Rawstep.

Custom decision policies are library code (`ScreenshotDecisionPolicy` or your own policy passed to `runScreenshotTask`, see API below). The [example policy](../examples/screenshot/policy.mjs) configures a model and repetition/history limits. Deterministic fixture adapters in the automated tests are labelled as test doubles, not real model runs.

## Real OneJev example

[OneJev-0.8B](https://huggingface.co/OmniJev/OneJev-0.8B) is an independently published multimodal decision fine-tune of Qwen3.5, separate from TypeSafe's proprietary Jev. The companion in [examples/screenshot](../examples/screenshot/README.md) uses pinned official weights with standard Transformers and `trust_remote_code=False`. One forward pass scores every declared option token; softmax/argmax picks the choice. It never generates a plan or silently replaces the decision with an action sequence.

Model weights and Python runtime dependencies are installed separately. They are not in the npm dependency graph or tarball. Small-model navigation quality is a limitation, not a reason to claim a scripted success. See [measured verification](./screenshot-verification.md) for both the failed natural-navigation attempt and the easy wiring-check result.

## API

```ts
import { runScreenshotTask, ScreenshotDecisionPolicy, HttpScreenshotModel } from 'rawstep/screenshot';
const policy = new ScreenshotDecisionPolicy({
  model: new HttpScreenshotModel({ endpoint: 'http://127.0.0.1:8766/choose', timeoutMs: 120000 }),
  maxStateVisits: 5,
  maxUnchangedTransitions: 4,
  historyLimit: 12,
});
await runScreenshotTask(task, { policy, outDir: 'runs/visual-01' });
```

Task mode is `keyboard`. The standard `Task` schema, mandatory independent verification, `maxSteps`, `timeoutMs`, named inputs and navigation policy apply. A `screenreader` task is rejected before browser launch. Unsupported choices, malformed probabilities or inference failures fail the run rather than falling back to a script. Model-declared success is checked independently.

The custom HTTP request/response types are exported from `rawstep/screenshot`; this endpoint is not the OpenAI chat-completions protocol. Its response declares `choiceId`, `model: { id, runtime, revision? }`, optional `probabilities` (in exactly request-choice order), `inferenceMs` and `focusAssessment`. These are recorded as `policy.evidence`, not independent ground truth.

## Limits and privacy

Repetition guards compare exact PNG bytes. `repetitionGuard: false` disables the stop (visual state is still reported) and `modelGiveUp: false` removes the model's stuck/uncertain choices. By default the policy stops at four consecutive unchanged transitions or when a state would be visited more than five times. It never substitutes an Escape/Tab action. Model stops and repetition-guard stops have distinct structured stopSource values, so a guard stop cannot be mistaken for the model giving up. A focus trap, invisible focus movement, failed activation, static content and legitimate focus cycling can all produce repeated images. Animation can defeat exact-repeat detection; the runner's step/time budgets still bound execution.

PNG observations and model receipts can expose page contents. After named text entry, the default trace omits screenshots, model evidence and free-text diagnostics because of delayed echoes. The live model still needs current pixels for the requested task; trace redaction does not anonymize data sent to that model. The explicit `includeSensitiveInputValues` API opt-in retains sensitive evidence and should only be used for safe test data. The HTTP adapter never directly sends raw input values, but they may appear in subsequent screenshots.

Focus visibility is uncertain unless explicitly assessed from images; the built-in OneJev action scorer currently reports focus assessment as `uncertain`. No hidden `document.activeElement` lookup is used to improve policy choices. A passing task, a model confidence score, changed pixels or an unchanged-pixel stop does not establish accessibility conformance, coverage of all controls or native screen-reader usability.

Schema 2.2 stores each run's screenshots as `blobs/<sha256>.png` next to `trace.json`; observation events keep `{ sha256, blob, bytes, viewport }` references. Replay export reads those hashes directly, stop diagnostics hydrate the final screenshot from the run directory, and `hydrateScreenshots` from `@rawstep/core/trace` restores pixels for other consumers. Screenshots in `blobs/` carry the same privacy caveats as any other screenshot evidence.
