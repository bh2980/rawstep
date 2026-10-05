# SystemOne decisions and post-run LLM analysis (0.2)

SystemOne is a model category, not a Jev-specific API. Runtime choices are constrained candidates, not generated commands. Existing DecisionPolicy/Backend/Observation/TraceAnalyzer remain; new APIs are exported from rawstep/systemone and @rawstep/policies/systemone.

## Configuration and commands

Only explicit model commands load env. Precedence: CLI overrides > process env > .env.local > .env. Neither files nor process.env are mutated. Scripts/local analysis/imports need no provider settings. Libraries use injected config. Keys have no CLI flag and are never saved as decision evidence. Copy root .env.example privately; legacy AI_* variables are ignored.

```dotenv
RAWSTEP_DECISION_PROVIDER=vercel-evaluation
RAWSTEP_DECISION_BASE_URL=https://ai-gateway.vercel.sh/v1
RAWSTEP_DECISION_MODEL=typesafe-ai/jev
RAWSTEP_DECISION_API_KEY=YOUR_PRIVATE_KEY
RAWSTEP_DECISION_INPUTS=text
RAWSTEP_ANALYSIS_PROVIDER=openai-compatible
RAWSTEP_ANALYSIS_BASE_URL=http://127.0.0.1:31415/v1
RAWSTEP_ANALYSIS_MODEL=auto
RAWSTEP_ANALYSIS_API_KEY=YOUR_PRIVATE_KEY
```

Provider is a transport identifier, not a URL. The base URL is the API root: evaluate, systemone or chat/completions is appended. A local analysis proxy may use an API root with or without /v1; configure its actual route. There is no hardcoded default decision model.

```sh
rawstep run task.json --decision systemone --backend voiceover --endpoint ws://127.0.0.1:3030 --out runs/native
rawstep screenshot-run task.json --decision systemone \
  --decision-provider systemone-http --decision-base-url http://127.0.0.1:8000/v1 \
  --decision-model MODEL_ID_RETURNED_BY_SERVICE --decision-inputs text,image --out runs/visual
rawstep screenshot-run task.json --script decisions.json --out runs/scripted
rawstep analyze runs/native --llm
rawstep report runs/native --analysis runs/native/analysis.json
```

Matrix accepts the same decision overrides and uses fresh policy/client instances. Native matrices remain programmatic with paired factories. The existing /choose connection, custom policies/analyzers, mock, Orca, profiles, focus gates and replay remain supported.

The Gateway adapter uses native [Evaluation HTTP](https://vercel.com/docs/ai-gateway/modalities/evaluation), checks the model catalog's evaluation type, and sends no fallback configuration. Its initial capability is text only, not screenshots. Generic SystemOne HTTP uses the [OneJev-compatible SystemOne/media contract](https://omnijev.github.io/OneJev/); capabilities are explicitly declared, never inferred from a model name. Other SDKs/providers implement SystemOneClient without changing the runner.

### OpenRouter native text and image decisions

Keep your current TypeSafe settings. Add just this private key to `.env.local`:

```dotenv
RAWSTEP_DECISION_OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY
```

On 2026-10-05, real Clef Flash probes established image delivery through **content parts inside `state`**. Red and blue were correctly distinguished, reversing the image order changed the answer to a first-image question, and a broken image returned HTTP 422. The earlier direct-Cloudflare `images`/provider-options implementation was wrong; its global image block has been removed. See [image delivery investigation and repair](./openrouter-image-delivery.md).

Jev remains text-only and can be selected explicitly with the existing native `run` command:

```sh
rawstep run task.json --decision systemone --backend voiceover --endpoint ws://127.0.0.1:3030 \
  --decision-provider openrouter-systemone --decision-base-url https://openrouter.ai/api/v1 \
  --decision-model typesafe/jev-1.13 --decision-inputs text \
  --out runs/openrouter-01
```

The OpenRouter client calls native [`/api/v1/systemone`](https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request), not Chat Completions. Preflight reads `models?output_modalities=decisions`, confirms declared inputs, resolves `canonical_slug`, and pins inference to that ID. Only that exact response ID is accepted. Thus `typesafe/jev-1.13` can resolve to a dated Jev ID without weakening the existing TypeSafe client's strict identity check. Provider fallback is disabled; credentials and server error bodies are never trace evidence.

For image-capable native models such as Clef Flash, the client serializes state as `[{type:"text",text:JSON.stringify(state)},{type:"image_url",image_url:{url:"data:image/png;base64,..."}}, ...]`. Current then previous image ordering is retained. It never sends a remote image URL or a local file path. Requests are capped at 4 MiB and 16 megapixels per PNG and 8 MiB total decoded bytes. Text-only requests retain the original state object. A model whose catalog lacks the required modality still fails preflight before browser startup.

`npm run try:openrouter` explicitly selects `cloudflare/clef-flash` and executes the keyboard sample with one installed Chrome. It sends screenshots remotely, never enables VoiceOver, and does not run an analysis LLM. `node scripts/check-openrouter-images.mjs` is the separate opt-in browser-free delivery diagnostic (build first). Generic `SystemOneHttpClient`/OneJev media, the existing `/choose` adapter, fake/scripted screenshot tests, and text TypeSafe/Jev remain unchanged. Past failed traces/reports are preserved; fake success is not claimed as live model evidence.

For one-off CLI overrides, the dedicated OpenRouter key is required; the saved TypeSafe key is **not** reused. If the saved default provider itself is `openrouter-systemone`, `RAWSTEP_DECISION_API_KEY` is also accepted. Libraries inject `OpenRouterSystemOneClient` options directly and never read env.

### Prompt configuration without a UI dependency

`SystemOneSpeechPolicy(client, historyLimit, prompt)` and `SystemOneScreenshotAdapter(client, prompt)` accept a copied `{ id, version, instructions }` configuration. Defaults remain available as `SPEECH_DECISION_PROMPT` and `SCREENSHOT_DECISION_PROMPT`. A future UI can supply the same connection/prompt objects; no database, management server, or UI is introduced now. Prompts cannot introduce arbitrary execution candidates or change runner permissions.

Each SystemOne policy inference records prompt ID/version and a SHA-256 over instructions plus candidate wording, separately from requested/resolved model identity. Live observations and API keys are excluded from this hash. Custom prompt versions must be retained by the caller to reproduce their content; the hash is a fingerprint, not storage of the prompt itself.

Remote screenshots require --allow-remote-model and HTTPS. Generic HTTP responses must report the requested model identity; configure aliases using the returned identity instead of silently accepting a model switch. Default HTTP capabilities cap choices at 255 and visual images at two; programmatic clients can declare stricter limits. Services, weights, Python/CUDA, AT servers and browsers remain separately installed prerequisites.

## Ownership and privacy

- core: task/contracts, append-only trace, redaction and finalization.
- policies/systemone: client/capabilities, typed candidates, speech policy, screenshot bridge, explicit fake.
- browser: lifetime, keyboard actuation, budgets, named-input gates, independent verifier.
- screenreaders: native AT transport/profiles and separately labelled simulation.
- reports: local summaries or explicit LLM interpretation with validated evidence IDs.
- cli: selection/env, cancellation, matrix; rawstep is the facade.

Speech policies send goal, speech and decision-only history. Visual policies send goal, current/previous inline PNG and decision-only history. Built-in adapters exclude DOM/AX, verifier feedback, raw input values and external image paths/URLs. Candidate input names are allowed; values stay with the runner. Values may nevertheless appear in subsequent speech/images. Saved trace redaction does not anonymize live model requests.

SystemOne chooses navigation, activation, named entry or stop. It does not prove actual focus, conformance or final success. Independent verification remains authoritative. Focus gates only narrow choices; repeat guards only stop and never invent replacement actions. Probability is not measured accuracy; native speech association remains temporal-only.

Analyze --llm requires a finalized input-redacted trace. Every saved event is included; PNG bytes are explicitly omitted, never captioned. Oversized input fails without silent truncation. Invalid IDs/JSON, timeout and analysis errors cannot change the original trace or outcome. Matrix rows separately expose analysisStatus/reportStatus and preserve execution metrics after postprocessing failures. Run/matrix never automatically invoke this LLM analyzer. Trusted custom modules remain caller-controlled.

## Tests and remaining evidence gates

```sh
npm run build
npm run typecheck
npm test                  # browser-free
npm run test:integration  # real browsers, one worker, serial, fail-fast
npm run test:all
npm run test:package      # isolated tarballs/consumers; no publication
npm run verify:voiceover -- ws://127.0.0.1:3030 NEW_EVIDENCE_DIRECTORY
npm run verify:multimodal -- examples/screenshot/task.json NEW_EVIDENCE_DIRECTORY \
  --decision-provider systemone-http --decision-base-url http://127.0.0.1:8000/v1 \
  --decision-model MODEL_ID_RETURNED_BY_SERVICE --decision-inputs text,image
```

Set RAWSTEP_TEST_BROWSER_PATH to an already installed Chrome executable for integration/package/native harness runs if no Playwright browser is installed. This does not download or install a browser. On macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

Pending/late test browser launches are owned and closed. Cleanup failure prevents another launch; forced process termination cannot guarantee finalization. User browsers are never globally killed.

Rawstep, not Playwright's process-exiting SIGINT handler, owns SIGINT/SIGTERM cancellation. CLI cancellation finishes owned resource cleanup and trace finalization before returning 130/143. Programmatic embedders should supply their own AbortSignal when handling process signals.

Mac Chrome's OS-native collapsed select popup did not respond to Playwright/CDP keys in headed or headless checks. That specific integration case is skipped on macOS; renderer-owned listbox arrow navigation is tested instead. This is a transport/platform limitation, not evidence of an accessibility defect or native VoiceOver behavior.

The opt-in VoiceOver harness requires macOS, prepared Automation Voice/permissions, loopback AT Driver and configured SystemOne. It runs scripted then real SystemOne sequentially, requires actual captured speech plus title/text/activation witnesses, and saves native-evidence.json. It refuses another browser after failed cleanup. Cancellation/disconnection regressions are covered separately by transport tests; this harness alone does not prove all native failure scenarios. NVDA remains experimental pending Windows evidence.

Native VoiceOver evidence is separate from screenshot evidence. The OpenRouter image probes use real configured inference, whereas browser regression tests with fake HTTP models prove only transport/action/verifier wiring. Neither proves model accuracy or accessibility conformance. No Guidepup restoration, model download or publish is used to bypass a native evidence gate.

## Breaking migration

0.2 removes legacy-run, rawstep/legacy, @rawstep/browser/legacy and their duplicate backend. Use screenshot-run --script/--policy and runScreenshotTask/ScreenshotKeyboardBackend. SCREENSHOT_KEYS replaces the old raw-key set; named replaceText remains available. Explicitly convert screenreader task files to keyboard for screenshot execution.

Saved 2.0/2.1 traces, including historical legacy-keyboard metadata, remain readable. Existing trace/image artifacts are not deleted. Package version 0.2.0 is prepared locally, not published.
