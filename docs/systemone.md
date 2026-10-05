# SystemOne decisions and post-run LLM analysis

SystemOne is a model category, not a Jev-specific API. Runtime choices are constrained candidates, not generated commands. The DecisionPolicy/Backend/Observation/TraceAnalyzer contracts stay the extension points; the SystemOne clients are exported from rawstep/systemone and @rawstep/policies/systemone.

## Registering a SystemOne model

Models are configured in `rawstep.config.json` (see [config](./config.md)), normally through the dashboard (`npx rawstep ui`). A SystemOne model is a `models[]` entry with family `SystemOne` and the `decision` role, attached to a connection:

- `openai` connection: an OpenAI-compatible API root (for example the Vercel AI Gateway at `https://ai-gateway.vercel.sh/v1`, or OpenRouter at `https://openrouter.ai/api/v1`). Use protocol `vercel-evaluation` for the Gateway or `openrouter-decisions` for OpenRouter.
- `systemone` connection: a native SystemOne server (for example `http://127.0.0.1:8000/v1`). Use protocol `systemone-http`.

Declare the inputs the model accepts (`text`, and `image` for visual models) with `inputs`. Capabilities are explicitly declared or discovered from the service's model catalog, never inferred from a model name. There is no hardcoded default decision model.

The API key never goes into `rawstep.config.json`. The connection names an environment variable (`apiKeyEnv`), and the value lives in `.env.local` (the dashboard writes it with mode 0600) or the process environment. Do not commit `.env.local`.

```json
{
  "connections": [
    { "id": "gateway", "name": "Vercel AI Gateway", "provider": "openai",
      "baseURL": "https://ai-gateway.vercel.sh/v1", "apiKeyEnv": "AI_GATEWAY_API_KEY", "timeoutMs": 60000 }
  ],
  "models": [
    { "id": "jev", "connectionId": "gateway", "modelId": "typesafe-ai/jev", "name": "Jev",
      "family": "SystemOne", "protocol": "vercel-evaluation", "inputs": ["text"],
      "capabilitySource": "manual", "maxChoices": 255, "maxImages": 0, "roles": ["decision"] }
  ]
}
```

```dotenv
# .env.local (never commit)
AI_GATEWAY_API_KEY=YOUR_PRIVATE_KEY
```

Run a task with the model:

```sh
npx rawstep run checkout --model jev --mode screenreader
npx rawstep analyze .rawstep/runs/RUN_DIR --model ANALYSIS_MODEL   # optional post-run LLM analysis
npx rawstep report .rawstep/runs/RUN_DIR
```

Libraries use `runTask` (same configuration) or inject client options directly into the lower-level classes; the lower-level classes never read environment variables or config files.

The Gateway adapter uses native [Evaluation HTTP](https://vercel.com/docs/ai-gateway/modalities/evaluation), checks the model catalog's evaluation type, and sends no fallback configuration. Its initial capability is text only, not screenshots. Generic SystemOne HTTP uses the [OneJev-compatible SystemOne/media contract](https://omnijev.github.io/OneJev/). Other SDKs/providers implement SystemOneClient without changing the runner.

### OpenRouter native text and image decisions

Register the model with protocol `openrouter-decisions` on an `openai` connection whose `baseURL` is `https://openrouter.ai/api/v1` and whose `apiKeyEnv` names a dedicated OpenRouter key variable in `.env.local`; keys are never shared across connections.

Real Clef Flash probes established image delivery through **content parts inside `state`**. Red and blue were correctly distinguished, reversing the image order changed the answer to a first-image question, and a broken image returned HTTP 422. See [image delivery investigation and repair](./openrouter-image-delivery.md).

Jev remains text-only: register it with `inputs: ["text"]` (for example `modelId` `typesafe/jev-1.13`). A visual model such as `cloudflare/clef-flash` is registered with `inputs: ["text", "image"]`.

The OpenRouter client calls native [`/api/v1/systemone`](https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request), not Chat Completions. Preflight reads `models?output_modalities=decisions`, confirms declared inputs, resolves `canonical_slug`, and pins inference to that ID. Only that exact response ID is accepted. Thus `typesafe/jev-1.13` can resolve to a dated Jev ID without weakening the TypeSafe client's strict identity check. Provider fallback is disabled; credentials and server error bodies are never trace evidence.

For image-capable native models such as Clef Flash, the client serializes state as `[{type:"text",text:JSON.stringify(state)},{type:"image_url",image_url:{url:"data:image/png;base64,..."}}, ...]`. Current then previous image ordering is retained. It never sends a remote image URL or a local file path. Requests are capped at 4 MiB and 16 megapixels per PNG and 8 MiB total decoded bytes. Text-only requests retain the original state object. A model whose catalog lacks the required modality fails preflight before browser startup. Screenshots are sent to the remote service, so use this only with pages you may share.

Libraries inject `OpenRouterSystemOneClient` options directly and never read env.

### Prompt configuration without a UI dependency

`SystemOneSpeechPolicy(client, historyLimit, prompt)` and `SystemOneScreenshotAdapter(client, prompt)` accept a copied `{ id, version, instructions }` configuration. Defaults are available as `SPEECH_DECISION_PROMPT` and `SCREENSHOT_DECISION_PROMPT`. In the dashboard, a model with `promptEditable` and a task's per-mode `prompts` supply the same prompt objects. Prompts cannot introduce arbitrary execution candidates or change runner permissions.

Each SystemOne policy inference records prompt ID/version and a SHA-256 over instructions plus candidate wording, separately from requested/resolved model identity. Live observations and API keys are excluded from this hash. Custom prompt versions must be retained by the caller to reproduce their content; the hash is a fingerprint, not storage of the prompt itself.

Remote screenshots require HTTPS. Generic HTTP responses must report the requested model identity; configure aliases using the returned identity instead of silently accepting a model switch. Default HTTP capabilities cap choices at 255 and visual images at two; a model entry's `maxChoices` and `maxImages` can declare stricter limits. Services, weights, Python/CUDA, AT servers and browsers remain separately installed prerequisites.

## Ownership and privacy

- core: task/contracts, append-only trace, redaction and finalization.
- policies/systemone: client/capabilities, typed candidates, speech policy, screenshot bridge, explicit fake.
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
npm run test:package      # isolated tarballs/consumers; no publication
```

Set RAWSTEP_TEST_BROWSER_PATH to an already installed Chrome executable for integration/package/native harness runs if no Playwright browser is installed. This does not download or install a browser. On macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

Pending/late test browser launches are owned and closed. Cleanup failure prevents another launch; forced process termination cannot guarantee finalization. User browsers are never globally killed.

Rawstep, not Playwright's process-exiting SIGINT handler, owns SIGINT/SIGTERM cancellation. CLI cancellation finishes owned resource cleanup and trace finalization before returning 130/143. Programmatic embedders should supply their own AbortSignal when handling process signals.

Mac Chrome's OS-native collapsed select popup did not respond to Playwright/CDP keys in headed or headless checks. That specific integration case is skipped on macOS; renderer-owned listbox arrow navigation is tested instead. This is a transport/platform limitation, not evidence of an accessibility defect or native VoiceOver behavior.

Native VoiceOver runs need macOS, prepared Automation Voice/permissions and a loopback AT Driver (`machine.backend` `voiceover`; `npx rawstep doctor` checks the endpoint). NVDA remains experimental pending Windows evidence.

Native VoiceOver evidence is separate from screenshot evidence. The OpenRouter image probes used real configured inference, whereas browser regression tests with fake HTTP models prove only transport/action/verifier wiring. Neither proves model accuracy or accessibility conformance. No Guidepup restoration, model download or publish is used to bypass a native evidence gate.

Trace schema 2.2 stores screenshots under `blobs/`.
