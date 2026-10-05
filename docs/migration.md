# Migrating to the Rawstep workspace

## Current physical monorepo

The repository root is a private development workspace. Shipped implementation lives in seven real packages: `@rawstep/core`, `@rawstep/policies`, `@rawstep/browser`, `@rawstep/screenreaders`, `@rawstep/reports`, `@rawstep/cli`, and the backward-compatible `rawstep` facade. Each owns its source, compiled output, export map and dependency manifest. `npm run build` compiles in dependency order; `npm run pack:all` produces local tarballs in `artifacts/`. No npm publication is required or performed.

Existing `rawstep` and `rawstep/*` imports and the `rawstep` executable remain available. The facade reexports package APIs; no implementation is copied into root `src/`, and no package imports sibling/root source. Workspace source dependencies use `workspace:*`; packed manifests contain concrete matching versions. For an unpublished local installation, install the selected package's sibling tarball dependency closure in the same command, or install all `artifacts/*.tgz`. See [local development](./local-development.md).

This is a physical ownership split of the retained implementation, not a restoration of the retired Guidepup/virtual backends, registry, generated capability catalogs, LLMAgent/provider SDKs, prompt templates or mandatory TypeScript config loader. The earlier migration accounting below remains historical background.

Script/custom-policy paths do not load provider env. Explicit --decision systemone and analyze --llm load separate RAWSTEP namespaces; libraries use injected config. Legacy AI_* keys and rawstep.config.ts remain removed. Playwright is the only third-party runtime dependency. See [SystemOne 0.2 configuration](./systemone.md).

0.2 removes legacy command/backend/exports after porting keyboard/input/privacy/cancellation regression coverage. Guidepup is not restored; historical trace schemas 2.0/2.1 remain readable.

```sh
rawstep screenshot-run task.json --script decisions.json --out ./runs/keyboard
# Optional visible browser, or a trusted compatible executable:
rawstep screenshot-run task.json --policy ./policy.mjs --headed --browser-executable /path/to/chromium
# From a checkout:
npm run rawstep -- screenshot-run task.json --script decisions.json --out ./runs/keyboard
```

Use runScreenshotTask and ScreenshotKeyboardBackend from rawstep/screenshot. SCREENSHOT_KEYS replaces historical raw edit chords; named replaceText remains supported. Input gates, verification, privacy, budgets and cleanup stay runner responsibilities.

## Task and command migration

New task JSON contains `url`, `goal`, and a nonempty `verify.all` array. Optional fields are `id`, `maxSteps` (default 40), `timeoutMs` (default 120000), `input` (named string values), and `navigation`. Relative file URLs are resolved against the task JSON directory. Supported URL schemes are HTTP, HTTPS, and file.

Native run rejects keyboard tasks; use screenshot-run and explicitly convert task mode if needed. Legacy configuration is not translated. Unknown flags are rejected.

```sh
rawstep run task.json --policy ./policy.mjs --backend voiceover --endpoint ws://127.0.0.1:4382/session --out ./runs/run-1
rawstep run task.json --script ./decisions.json --backend nvda --endpoint ws://127.0.0.1:3031/session --out ./runs/run-2
rawstep analyze ./runs/run-1
rawstep analyze ./runs/run-1 --analyzer ./analyzer.mjs --out ./analysis/run-1
rawstep report ./runs/run-1 --analysis ./analysis/run-1/analysis.json --out ./reports/run-1
rawstep doctor --backend voiceover --endpoint ws://127.0.0.1:4382/session
```

Endpoints are required for runs and never guessed. Use the address configured by your server. `--policy` and `--script` are mutually exclusive. Local modules may export `default` or a named `policy`/`analyzer` object; loading a module executes trusted JavaScript. Module paths are resolved from the current working directory, not the task file's directory.

The default output directory is `.rawstep/<timestamp>` beneath the current working directory. `--out` is the actual run directory, not the old `<taskId>/<runId>` root. Every run needs a new directory; an existing trace is not silently overwritten. The CLI requires a visible browser and does not expose `--headless`. Programmatic tests may supply a controlled generic backend/browser factory; headless native AT runs are rejected. `--diagnostic-screenshots` is opt-in and does not give screenshots to the policy.

## DecisionPolicy and runner ownership

```ts
import { AtDriverBackend, ScriptedPolicy, runTask } from "rawstep";

const trace = await runTask({
  url: "https://example.com",
  goal: "Find the Example Domain heading.",
  verify: { all: [{ titleIncludes: "Example Domain" }] }
}, {
  backend: new AtDriverBackend({
    url: "ws://127.0.0.1:4382/session",
    profile: "voiceover"
  }),
  policy: new ScriptedPolicy([
    { action: { kind: "intent", intent: "heading.next" } },
    { stop: "success" }
  ]),
  outDir: "./runs/example"
});
```

This is a wiring example. Its title rule does not prove heading focus; choose verifier rules that actually establish your goal.

`DecisionPolicy.decide(input)` can return a decision synchronously or asynchronously. Input contains:

- `goal`: the task goal
- `observation`: real screen reader speech, evidence-event IDs, and observation-window metadata
- `history`: prior decisions, observations, and execution status
- `allowedActions`: allowed backend intents, keys, named input values, and replace-text support
- `inputs`: for each named task input, `{ sensitive, description? }`: the name, whether it is sensitive (the default) and an optional description from `task.inputOptions`. Values never reach the policy; the runner resolves a named `typeText`/`replaceText` to the real value itself
- `signal`: an AbortSignal for the run's time budget

Decisions are one of:

```ts
{ action: { kind: "intent", intent: "heading.next" }, rationale: "Optional explanation" }
{ action: { kind: "key", key: "Tab" } }
{ action: { kind: "typeText", input: "email" } }
{ action: { kind: "replaceText", input: "email" } }
{ stop: "success" }
{ stop: "stuck" }
```

Text actions refer to a key in `task.input`; a policy cannot supply arbitrary text. The runner applies capability/allowlist checks and an independent editable-focus gate before text entry. It owns browser lifecycle, navigation policy, step/time budgets, persistence, and independent verification. A policy's `success` stop is a claim, not a verified result. DOM/network evidence is used for verification and diagnostics, not synthesized into the screen reader observation. Screenshots and hidden DOM labels are not policy inputs.

Programmatic callers can narrow actions with `allowedActions: { intents, keys, inputKeys }`. The built-in profiles expose a limited explicit raw-key vocabulary such as Tab, Enter, arrows, Shift+Tab, and Mod+A. These keys are delivered through AT Driver, not Playwright keyboard input. Unsupported intents and keys fail before remote execution. A future backend can implement the generic `Backend` contract without bringing in an LLM or changing the analysis boundary.

## Native setup and semantics

Rawstep does not install, start, configure, or obtain permissions for a native server. The current profiles target [Bocoup's macOS AT Driver server](https://github.com/bocoup/macos-at-driver-server) and [Prime Access Consulting's NVDA automation server](https://github.com/Prime-Access-Consulting/nvda-at-automation). VoiceOver requires macOS 13+ and the Bocoup Automation Voice selection. NVDA requires its add-on, Capture Speech synthesizer, and companion Go server. Verified upstream defaults are `ws://localhost:4382/session` for the macOS server and `ws://localhost:3031/session` for the NVDA server; explicit configured URLs always take precedence. Follow each project's own setup and security guidance. Keep AT Driver endpoints private; they permit interaction with the host.

The browser launched by the runner and the controlled screen reader must be on the same native desktop. Default runs reject nonloopback endpoints and known profile/OS mismatches. A remote endpoint does not transport the browser to that machine or forward its accessibility tree. A Linux runner does not become a VoiceOver/NVDA test environment by changing `--backend`. Advanced programmatic harnesses can explicitly pair their backend and `browserSessionFactory`; this is not automatic remote support. `doctor` remains a connection probe and may test remote endpoints.

The historical `activatedAnnouncementIncludes` verifier name is retained, but it matches output collected in the activation observation window. It does not prove that activation caused that speech or that speech finished. DOM text verification checks every matching node for visibility.

Navigation guarding starts before the initial navigation. Context routing blocks new windows, and a Chromium CDP request boundary checks every primary-document request and redirect hop before sending it. Allowed redirects use native browser handling so method/body, cookies, history and final URLs follow browser semantics; an out-of-scope hop is blocked. The redirect chain is bounded to 10 hops.

Known assumptions and limits:

- Node 22+ provides the built-in WebSocket client. The transport follows the [AT Driver draft](https://w3c.github.io/at-driver/) and uses `session.new`, `interaction.userIntent` with `pressKeys`, and streamed output events
- A command acknowledgement confirms protocol handling, not correct UI focus, text entry, speech completion, or task success
- VoiceOver uses Control+Option and default commands; NVDA navigation assumes browse mode. `next`/`previous` move by VoiceOver object versus NVDA browse-mode line, respectively
- NVDA does not expose `interact`/`stopInteracting` mappings. Mode toggling is not equivalent to an idempotent interaction action
- Both profiles assume a US keyboard layout. VoiceOver text entry supports printable ASCII using the macOS server's key names. NVDA is limited to letters, digits, spaces, shifted digits, semicolon, colon, equals, and plus by its server parser. Unsupported characters, including general Unicode, fail before any text or replace action is dispatched
- There is no DOM/clipboard text-entry fallback, invented speech, automatic focus repair, or model-selected native setup
- Default collection waits for 500 ms of silence, with a 3000 ms observation deadline. These windows are heuristics; late, duplicate, or unrelated output must not be interpreted as causally owned by a command
- Screen reader version/platform values are recorded when reported; locale, keyboard layout, settings, and unsupported metadata remain explicitly unknown
- `doctor` tests a protocol session only. Its success does not establish native speech behavior

Mock tests exercise protocol correlation, timeouts, errors, duplicate/delayed output, action mapping, runner gates, and privacy. Package tests exercise installation and API/CLI boundaries. Neither substitutes for macOS+VoiceOver or Windows+NVDA tests with a real visible browser. Native verification is still required; this change does not claim those checks passed.

## Cancellation and independent evidence

`runTask` and `runLegacyKeyboardTask` accept an optional `signal: AbortSignal`. The runner passes its combined cancellation/budget signal to backend `start`, `execute`, and `observe` operations. Custom backends should honor this optional second `execute` argument and operation options before every physical dispatch. Cancellation is cooperative: a command already sent to a native server cannot be undone.

The AT Driver transport journals a command attempt before sending it, then checks cancellation again. A trace-write failure therefore prevents that command and later characters from being sent. A `backend.command` event alone is not proof of physical dispatch; its response is separate evidence. Both AT and screenshot keyboard adapters check cancellation between characters.

The CLI handles SIGINT and SIGTERM during execution, records an `aborted` outcome with the signal, stage and step, closes resources, and prints commands to inspect the saved evidence. Exit codes are 130 and 143 respectively. A forceful SIGKILL cannot run cleanup; the append-only journal can still be read by `report` for recovery when available.

Each default-verifier rule now returns observed witnesses. The runner stores them as `verifier.evidence` and links their event IDs from `verifier.result.rules`. These records contain observed title/URL/text, request/response or DOM-event records, or a temporal activation speech window, never invented success evidence. Unobserved matches have no witness. After input, free-text witness content and failure details are suppressed while rule identity, result, evidence IDs and safe typed metadata remain. Witnesses are never passed to the decision policy. Legacy custom verifiers returning only `{ passed, failures }` remain compatible but provide no per-rule evidence.

Rejected policy decisions are stored before validation terminates the run. The local analyzer recognizes both these rejections and browser navigation blocks and distinguishes screen-reader from screenshot evidence. Reports summarize action results, verifier grounds and privacy omissions, with raw events collapsed for inspection.

## Explicit browser-backed VoiceOver simulation

`rawstep mock-run` and `runMockVoiceOverTask` opt into a limited English DOM-navigation simulation. It reads Chromium accessibility names, roles and states, maintains a cursor separate from actual DOM focus, and executes guarded browser actions. The default `run` command remains native AT Driver. Simulation is never selected as a native fallback.

Policies receive text observations with `provenance: "simulation"`; they do not receive the raw accessibility tree or DOM. Trace events use source `simulation`, the environment records the same provenance, and reports label simulated evidence separately. Native VoiceOver speech, Safari/macOS behavior, rotor/group navigation, speech timing and earcons are not reproduced. See the [supported behavior matrix](./mock-voiceover.md).

## Trace v2, privacy, analysis, and reporting

New runs write trace schema `2.2`: screenshots are stored once per distinct image as content-addressed blobs instead of inline base64. Schema `2.1` added explicit simulation provenance; readers still accept saved `2.0` and `2.1` traces (inline PNGs and all), and simulated evidence is not valid under the `2.0` schema. A run writes:

- `trace.json`: run/task/environment/privacy metadata, ordered events, and final outcome
- `trace.jsonl`: append-only event journal, also usable to recover interrupted-run evidence
- `blobs/<sha256>.png`: screenshot pixels, deduplicated by hash
- Optional `diagnostics/` images, never policy observations

In 2.2 an event such as `keyboard.observation` keeps a reference `{ sha256, blob: "blobs/<sha256>.png", bytes, ...siblings like viewport }` in place of `{ pngBase64, viewport }`; `trace.json` and `trace.jsonl` contain no base64 PNGs. Redaction never rewrites a reference. `@rawstep/core/trace` exports `isScreenshotRef`, `screenshotSha256(value)` (works for a reference or an inline screenshot), `hydrateScreenshots(trace, dirOrSink)` (a copy with `pngBase64` added back where the blob exists and its hash matches; missing or mismatched blobs stay references), `extractScreenshots`, `writeJsonAtomic` and `traceFilePath`. Code that needs pixels from a saved trace should hydrate it first; live policy observations are unchanged and stay inline. `TraceRecorder` writes through a `TraceSink` (`FileTraceSink(dir)`, or `MemoryTraceSink` for tests and embedding without a filesystem); its constructor accepts a directory or a sink. The `onEvent(event)` option (also `RunOptions.onEvent` for `runTask`) receives each stored, already-redacted event; a throwing listener cannot affect the run. Reports written next to the trace reference `blobs/<sha256>.png` relatively; `rawstep report` and the dashboard hydrate first, so their reports embed the images.

Events carry stable IDs and sequence order, source, timestamps, payloads, redaction flags, and optional command/window association. Temporal association does not assert that a particular command caused speech. Output order and duplicates are retained rather than summarized away. Unknown environment values are represented as unknown.

Task input values and their URL/form-encoded forms are redacted from persisted payloads before analyzers can read them. Whole-value matching alone cannot remove characters spoken individually. After text entry starts, the runner therefore conservatively redacts subsequent protocol payloads, speech observations, related diagnostic content, and outcome details and suppresses later diagnostic screenshots. This privacy boundary stays active through cleanup because delayed echoes can arrive after an acknowledgement. Policies refer to inputs by name and never receive their values; they are not a trusted holder of input values (see below).

This is a deliberate evidence/privacy tradeoff: an input-heavy trace may lose much of its later raw speech. It does not claim comprehensive anonymization of arbitrary page content or screenshots captured before input. Review artifacts before sharing them. Programmatic `runTask` callers may explicitly set `includeSensitiveInputValues: true` to retain sensitive evidence; it exposes values in saved artifacts and to custom analyzers. The CLI provides no opt-out flag.

### Hiding input values from the policy

The decision policy (usually a model) must not learn input values. Inputs are sensitive unless the task sets `inputOptions.<name>.sensitive: false`; `resolveTask` also rejects a goal that contains the value (4 or more characters) of a sensitive input. The runner passes `sensitive` on every `typeText`/`replaceText` backend action and builds a policy-facing view of observations. The saved trace is unchanged and keeps its own redaction rules above.

- **Screenshots (keyboard mode).** Before typing a sensitive value, the screenshot backend marks the focused field with `data-rawstep-mask`. While capturing an observation it sets `-webkit-text-security: disc !important` on marked fields through the CSSOM (so a page CSP cannot block it) and restores the field's previous inline value right after the capture. The field shows dots in the policy's screenshot and its real value in the page.
- **Speech (screen reader mode).** Sensitive values of 4 or more characters, including their URL and form-encoded forms, are replaced with `[REDACTED]` in observation speech, both in the current observation and in `history`. The observation right after a successful sensitive `typeText`/`replaceText` has its whole speech replaced with `[typed input withheld]`, because a screen reader may echo the value character by character.

Limitations:

- Values shorter than 4 characters are not substring-masked in later speech, since that would damage unrelated text. Only withholding the typing step's speech covers them.
- The screenshot mask covers only the typed field. The same value re-rendered elsewhere on the page (for example "Hello Alice" after sign-in, or a form summary) is visible in screenshots; in speech it is masked only when the value has 4 or more characters.
- The mask follows the field that was focused when typing started, including fields inside open shadow roots; text the page copies into other elements is not masked.
- The model can still infer a value from page behavior, such as validation messages, search results, or which page the form leads to.

`analyzeSavedTrace` reads the saved trace and writes only `analysis.json`. An analyzer has this independent interface:

```ts
import type { TraceAnalyzer } from "rawstep/analyze";

const analyzer: TraceAnalyzer = {
  id: "my-analyzer",
  async analyze(trace) {
    return { summary: `Reviewed ${trace.events.length} events`, findings: [] };
  }
};
export default analyzer;
```

The built-in analyzer is deterministic and local. Custom analyzers receive the full persisted trace and can partition it for model calls, while explicit analyze --llm uses injected OpenAI-compatible configuration without a model SDK. Findings must reference valid evidence events. An analyzer failure is recorded as an analysis failure; it does not change the run's outcome. Reports validate that the analysis belongs to the same trace and preserves its recorded outcome. Old legacy trace files are not silently treated as schema v2.

## Release verification

```sh
npm run check
# Or run each boundary independently:
npm run build
npm run typecheck
npm test
npm run test:integration
npm run test:package
```

`test:package` builds and packs the root package, installs it into an isolated temporary project, checks every public JavaScript export, runs help/version/doctor and offline analyze/report commands, checks consumer TypeScript declarations, and enforces the release file allowlist. It also runs the installed CLI, AT Driver adapter, runner, trace and analysis modules against a real localhost WebSocket mock with an explicitly supplied fake browser/verifier. It also injects a journal failure during installed AT text entry and verifies that remaining key dispatch stops. When RAWSTEP_TEST_BROWSER_PATH is set, it executes an installed-package screenshot task in real Chromium, checks its verifier evidence/report, sends real SIGINT/SIGTERM to CLI child processes, and verifies aborted traces, exit codes and recovery guidance. It does not run VoiceOver or NVDA; actual native screen-reader validation remains a separate requirement before a stable release.

The default test command includes every `tests/**/*.test.ts` suite, including mandatory real Chromium fixture tests. Install Chromium with `npx playwright install chromium`, or set `RAWSTEP_TEST_BROWSER_PATH` to a trusted compatible executable. No browser-unavailable skip is used. `tsconfig.tests.json` also typechecks every test/helper. See [test migration accounting](./test-migration.md) and [source editing map](./editing-map.md).

The new [screenshot-only mode](./screenshot-keyboard.md) is implemented independently under `packages/browser/src/screenshot/` and `packages/policies/src/screenshot/` and does not restore the removed LLM/provider/prompt workspace.
