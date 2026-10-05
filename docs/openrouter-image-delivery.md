# OpenRouter image delivery investigation — 2026-10-05

Status: **image connection repaired and verified; sample task inconclusive**. The defect was Rawstep's request encoding, not evidence that Clef lacks vision. No screen reader, model installation, or generative fallback was used.

## Verified repair

OpenRouter consumes inline images as content parts **inside `state`**. The direct Cloudflare top-level `images` extension was not the correct OpenRouter request. The repaired native `/api/v1/systemone` body is:

```json
{
  "model": "cloudflare/clef-flash",
  "state": [
    {"type": "text", "text": "{\"goal\":\"...\",\"imageOrder\":[\"current\",\"previous\"]}"},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
  ],
  "questions": {"next": {"type": "choice", "instructions": "...", "criteria": {"a": "...", "b": "..."}}},
  "provider": {"allow_fallbacks": false}
}
```

Both `/api/alpha/decisions` and `/api/v1/systemone` distinguished solid red and blue with the same text/question/candidates. The actual rebuilt `OpenRouterSystemOneClient` then passed these sequential probes:

| Synthetic image(s) | Returned choice | Probabilities (red, blue) |
| --- | --- | --- |
| red | red | 0.9934, 0.0066 |
| blue | blue | 0.0096, 0.9904 |
| absent (control) | blue | 0.2999, 0.7001 |
| red, blue — ask about FIRST image | red | 0.9923, 0.0077 |
| blue, red — ask about FIRST image | blue | 0.0105, 0.9895 |

A malformed image sent as a state content part was rejected with HTTP **422**, unlike the ignored extension. The saved evidence is `.rawstep/openrouter-image-check-8e743e8e-91ab-435b-ba31-84cc5d131dd0/image-delivery-check.json`. Reproduce after building with `node scripts/check-openrouter-images.mjs`; this is opt-in, contacts the real model, stores only allowlisted results, and never starts a browser.

The blanket image rejection has been removed. Capabilities still require a matching native model catalog entry before browser acquisition. Text-only requests retain their state object; visual requests wrap allowlisted state as a text part followed by current/previous inline PNGs. No Chat Completions, generated JSON decisions, model substitutions, DOM/AX, verifier feedback, raw input values, or external image paths/URLs are added. Image byte/pixel limits, cancellation, candidate validation and exact model identity checks remain in place.

## Real sample after repair

`node scripts/try-openrouter.mjs` ran the unchanged keyboard fixture with one Chrome and four real Clef Flash decisions. Actions were **Tab → Enter → Enter**, then the model chose `stop:uncertain`. Independent verification did not observe the goal, so the finalized outcome is **inconclusive**, not success. Run ID: `b20df355-653d-4140-8804-4b859fdbf0a9`; trace/report: `.rawstep/openrouter-smoke-58b7a920-20aa-4f7b-b401-da14b2b88626/`. This demonstrates live image/decision/keyboard wiring but not reliable navigation or a passed visual task. No task/candidate/prompt tuning or scripted fallback was used to manufacture a pass.

Fake HTTP browser regressions separately cover both generic OneJev media and OpenRouter state-content encoding, including current/previous ordering, independent verification, privacy and one-browser ownership. They are not native model evidence. Old failed runs below remain unchanged.

## Earlier failed encoding (preserved history)

The original keyboard/screenshot sample used `cloudflare/clef-flash` and received five valid native decision responses. It executed Tab, Tab, Tab, Enter, then received `stop:success`. The independent verifier rejected completion: the title stayed `Simple CTA Fixture` and `Started!` was absent. This trace remains a failure, not a model accuracy conclusion or proof of image delivery.

To distinguish visual delivery from a valid HTTP response, requests kept the same state, instructions, model, and red/blue candidates. Only the image varied. Fixtures were valid solid RGB PNGs, 128×128, built locally in memory. No label describing the actual color appeared in the request state. The instructions were: "The attached image is a single solid color. Choose its dominant color. Do not infer the color from the text."

| Route / image field | Input | Result (red, blue) | Input tokens |
| --- | --- | --- | --- |
| `/api/v1/systemone` / top-level `images` | red / blue / absent | identical: 0.4284, 0.5716 | 155 each |
| `/api/alpha/decisions` / `provider.options.cloudflare.images` | red / blue / absent | identical: 0.4284, 0.5716 | 155 each |
| `/api/alpha/decisions` / top-level `images` | invalid PNG data URL | HTTP 200, same probabilities | 155 |
| `/api/alpha/decisions` / `provider.options.cloudflare.images` | invalid PNG data URL | HTTP 200, same probabilities | 155 |

All tested responses identified `cloudflare/clef-flash`; output tokens were zero where measured. Requests were sequential and had ten-second per-request deadlines. Provider fallback was disabled. API keys and response bodies containing arbitrary diagnostic details were not stored.

The unchanged probabilities, unchanged usage, and acceptance of invalid PNG strongly suggest image omission on these routes. This is evidence against treating this connection as verified visual input, not independent proof of where the image is discarded or a benchmark of Clef's vision capabilities. The original three-request evidence is preserved in `.rawstep/openrouter-smoke-ZLCNLD/image-delivery-check.json`.

## Why the earlier encoding failed

[Cloudflare's direct Clef input schema](https://developers.cloudflare.com/workers-ai/models/clef-flash/schema-input.json) defines an inline `images` extension. The [OpenRouter native Decisions schema](https://openrouter.ai/openapi.json) does not define that top-level field. Its provider-options schema permits provider-specific options but warns that unrecognized keys can be dropped. Copying the direct Cloudflare request into OpenRouter was not a validated transport contract.

The OpenRouter [Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request) permits an array in `state`; [image input documentation](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding) defines the `image_url` content part. That documentation's main example is Chat Completions, so native decision use was established by the live probes above rather than inferred from the chat example alone. The earlier investigation failed to test this state-content representation and prematurely blocked all images; that was an implementation/diagnosis error.

Existing TypeSafe/Jev settings, keys, saved traces and generic SystemOne HTTP remain unchanged. No new provider, credentials, security changes, model download, or Python environment is needed for this repair. Restoring ZDR may again make this provider unavailable under those restrictions; the code never silently relaxes them.
