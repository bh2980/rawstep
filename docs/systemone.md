# SystemOne decisions and post-run LLM analysis

SystemOne is a model category, not a Jev-specific API. A decision model answers a question with a probability for every candidate. Runtime choices are constrained candidates, not generated commands. The DecisionPolicy/Backend/Observation/TraceAnalyzer contracts stay the extension points; the decision client is exported from rawstep/systemone and @rawstep/policies/systemone.

## Registering a decision model

Models are configured in `rawstep.config.json` (see [config](./config.md)), normally through the dashboard (`npx rawstep ui`: type, then provider, then model). A decision model is a `models[]` entry with `kind: "decision"` and the `decision` role. Its `provider` says where it runs:

| `provider` | Server | Images | Key variable |
|---|---|---|---|
| `typesafe` | TypeSafe Jev, `https://api.typesafe.ai/v1` (`POST /v1/systemone`) | yes | `RAWSTEP_TYPESAFE_API_KEY` |
| `gateway` | Vercel AI Gateway, through the AI SDK's gateway provider | text only | `RAWSTEP_AI_GATEWAY_API_KEY` |
| `openrouter` | `https://openrouter.ai/api/v1` (`POST /api/v1/systemone`) | yes | `RAWSTEP_OPENROUTER_API_KEY` |
| `custom` | any `/systemone`-compatible server you run, `baseURL` such as `http://127.0.0.1:8000/v1` | as declared | optional, `apiKeyEnv` |

Declare the inputs the model accepts (`text`, and `image` for visual models) with `inputs`. Capabilities are explicitly declared or discovered from the provider's model list (OpenRouter lists input modalities; the Gateway lists decision models), never inferred from a model name. There is no hardcoded default decision model.

The API key never goes into `rawstep.config.json`. Each preset provider reads its key from the variable above, and the value lives in `.env.local` (the dashboard writes it with mode 0600) or the process environment. Do not commit `.env.local`.

```json
{
  "models": [
    { "id": "jev", "name": "Jev", "kind": "decision", "provider": "typesafe", "modelId": "jev-latest",
      "inputs": ["text"], "capabilitySource": "manual", "maxChoices": 255, "maxImages": 0,
      "roles": ["decision"], "timeoutMs": 60000 }
  ]
}
```

```dotenv
# .env.local (never commit)
RAWSTEP_TYPESAFE_API_KEY=YOUR_PRIVATE_KEY
```

Run a task with the model:

```sh
npx rawstep run checkout --model jev --mode screenreader
npx rawstep analyze .rawstep/runs/RUN_DIR --model ANALYSIS_MODEL   # optional post-run LLM analysis
npx rawstep report .rawstep/runs/RUN_DIR
```

Libraries use `runTask` (same configuration) or construct `DecisionClient` directly with explicit options; the lower-level classes never read environment variables or config files.

### How decisions are called

Every decision goes through the AI SDK's `experimental_decide` (`ai`, pinned exactly). The decide API is experimental and may change in patch releases, so the versions of `ai` and `@ai-sdk/openai-compatible` are pinned and only `decision-model.ts` and `decision.ts` in `@rawstep/policies` depend on its shape. `DecisionClient` implements the `SystemOneClient` interface the SystemOne policies use. For each call it asks one `choice` question (instructions plus a criteria map of candidate ID to label) against the state, with `maxRetries: 0` and an abort signal that combines the caller's signal and the model's `timeoutMs`. The answer must name a candidate and carry a complete probability distribution.

- `typesafe`, `openrouter`, `custom`: one in-house `DecisionModelV4` adapter (`SystemOneDecisionModel`) for the `/systemone` protocol. Images are not part of the SDK's call options, so they travel in `providerOptions.rawstep.images` and the adapter puts them on the wire. For `typesafe` and `custom` that is the [OneJev-compatible media contract](https://omnijev.github.io/OneJev/) (`media` entries referenced from `state.screens` as `<image:N>`; caller-authored media references are rejected). For `openrouter` it is image content parts inside `state`, with `provider.allow_fallbacks: false`.
- `gateway`: the gateway provider's own decision model (`createGateway(...).decisionModel`). Text only. The client checks the Gateway's model list for a decision or evaluation model before inference and sends no fallback configuration.

The adapter keeps the checks of the original clients: responses are capped at 1 MB; the response must name the pinned model (a silently switched model, including a generative fallback, is rejected); probabilities must be finite, in 0 to 1 and sum to 1 within 0.01 (they are normalized before the SDK checks them); a response that echoes the key is rejected. Provider text never reaches an error: callers only see a `RawstepError` with code `decision-cancelled`, `decision-timeout` or `decision-failed` and a fixed message.

### OpenRouter native text and image decisions

Register the model with `provider: "openrouter"` and `kind: "decision"`. The key is the same `RAWSTEP_OPENROUTER_API_KEY` that OpenRouter LLM models use.

Real Clef Flash probes established image delivery through **content parts inside `state`**. Red and blue were correctly distinguished, reversing the image order changed the answer to a first-image question, and a broken image returned HTTP 422. See [image delivery investigation and repair](./openrouter-image-delivery.md).

Jev on OpenRouter is text-only: register it with `inputs: ["text"]` (for example `modelId` `typesafe/jev-1.13`). A visual model such as `cloudflare/clef-flash` is registered with `inputs: ["text", "image"]`.

The adapter calls native [`/api/v1/systemone`](https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request), not Chat Completions. Preflight reads `models?output_modalities=decisions`, confirms declared inputs, resolves `canonical_slug`, and pins inference to that ID. Only that exact response ID is accepted. Thus `typesafe/jev-1.13` can resolve to a dated Jev ID without weakening the identity check. Provider fallback is disabled; credentials and server error bodies are never trace evidence.

For image-capable native models such as Clef Flash, the adapter serializes state as `[{type:"text",text:JSON.stringify(state)},{type:"image_url",image_url:{url:"data:image/png;base64,..."}}, ...]`. Current then previous image ordering is retained. It never sends a remote image URL or a local file path. Requests are capped at 4 MiB and 16 megapixels per PNG and 8 MiB total decoded bytes. Text-only requests retain the original state object. A model whose catalog lacks the required modality fails preflight before browser startup. Screenshots are sent to the remote service, so use this only with pages you may share.

### Prompt configuration without a UI dependency

`SystemOneSpeechPolicy(client, historyLimit, prompt)` and `SystemOneScreenshotAdapter(client, prompt)` accept a copied `{ id, version, instructions }` configuration. Defaults are available as `SPEECH_DECISION_PROMPT` and `SCREENSHOT_DECISION_PROMPT`. In the dashboard, a task's per-mode `prompts` supply the same prompt objects. Prompts cannot introduce arbitrary execution candidates or change runner permissions.

Each SystemOne policy inference records prompt ID/version and a SHA-256 over instructions plus candidate wording, separately from requested/resolved model identity. Live observations and API keys are excluded from this hash. Custom prompt versions must be retained by the caller to reproduce their content; the hash is a fingerprint, not storage of the prompt itself.

Remote screenshots require HTTPS. `/systemone` responses must report the requested model identity; configure aliases using the returned identity instead of silently accepting a model switch. Default capabilities cap choices at 255 and visual images at two; a model entry's `maxChoices` and `maxImages` can declare stricter limits. Services, weights, Python/CUDA, AT servers and browsers remain separately installed prerequisites.

## Ownership and privacy

- core: task/contracts, append-only trace, redaction and finalization.
- policies/systemone: decision client and `/systemone` adapter, capabilities, typed candidates, speech policy, screenshot bridge, explicit fake.
- browser: lifetime, keyboard actuation, budgets, named-input gates, independent verifier.
- screenreaders: native AT transport/profiles and separately labelled simulation.
- reports: local summaries or explicit LLM interpretation with validated evidence IDs.
- project: rawstep.config.json, credentials in `.env.local`, run assembly and execution shared by the dashboard, CLI and `runTask`.
- cli: the `rawstep` commands and cancellation; rawstep is the facade.

Speech policies send goal, speech and decision-only history. Visual policies send goal, current/previous inline PNG and decision-only history. Built-in adapters exclude DOM/AX, verifier feedback, raw input values and external image paths/URLs. Candidate input names are allowed; values stay with the runner. Values may nevertheless appear in subsequent speech/images. Saved trace redaction does not anonymize live model requests.

SystemOne chooses navigation, activation, named entry or stop. It does not prove actual focus, conformance or final success. Independent verification remains authoritative. Focus gates only narrow choices; repeat guards only stop and never invent replacement actions. The visual repetition guard (`repetitionGuard`) is `auto` by default and can be set `on` or `off` per run profile, and the model's `stuck`/`uncertain` choices can be removed with the profile's `modelGiveUp` setting; see [config](./config.md). Probability is not measured accuracy; native speech association remains temporal-only.

`rawstep analyze --model` requires a finalized input-redacted trace. Every saved event is included; PNG bytes are explicitly omitted, never captioned. Oversized input fails without silent truncation. Invalid IDs/JSON, timeout and analysis errors cannot change the original trace or outcome. `rawstep run` and `runTask` never automatically invoke this LLM analyzer; the local deterministic summary is the default. Trusted custom modules remain caller-controlled.

## Tests and remaining evidence gates

```sh
npm run build
npm run typecheck
npm test                  # browser-free
npm run test:integration  # real browsers, one worker, serial, fail-fast
npm run test:all
npm run test:package      # installs only the rawstep tarball into a temp project; no publication
```

Set RAWSTEP_TEST_BROWSER_PATH to an already installed Chrome executable for integration/package/native harness runs if no Playwright browser is installed. This does not download or install a browser. On macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

Pending/late test browser launches are owned and closed. Cleanup failure prevents another launch; forced process termination cannot guarantee finalization. User browsers are never globally killed.

Rawstep, not Playwright's process-exiting SIGINT handler, owns SIGINT/SIGTERM cancellation. CLI cancellation finishes owned resource cleanup and trace finalization before returning 130/143. Programmatic embedders should supply their own AbortSignal when handling process signals.

Mac Chrome's OS-native collapsed select popup did not respond to Playwright/CDP keys in headed or headless checks. That specific integration case is skipped on macOS; renderer-owned listbox arrow navigation is tested instead. This is a transport/platform limitation, not evidence of an accessibility defect or native VoiceOver behavior.

Native VoiceOver runs need macOS, prepared Automation Voice/permissions and a loopback AT Driver (`machine.backend` `voiceover`; `npx rawstep doctor` checks the endpoint). NVDA remains experimental pending Windows evidence.

Native VoiceOver evidence is separate from screenshot evidence. The OpenRouter image probes used real configured inference, whereas browser regression tests with fake HTTP models prove only transport/action/verifier wiring. Neither proves model accuracy or accessibility conformance. No Guidepup restoration, model download or publish is used to bypass a native evidence gate.

Trace schema 2.2 stores screenshots under `blobs/`.
