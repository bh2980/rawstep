# Keyboard mode task examples

Task files for keyboard mode (`--mode keyboard`), where the model chooses keyboard actions from viewport screenshots. Keyboard mode needs a model with image input: an `llm` model with images, or a `decision` model on the `typesafe`, `openrouter` or `custom` provider (see [config](../../docs/config.md) and [SystemOne decisions](../../docs/systemone.md)). Nothing is installed or downloaded automatically.

Register a task in `rawstep.config.json` (`npx rawstep ui`), or pass the file directly:

```sh
npx rawstep run examples/screenshot/task.json --model MODEL --mode keyboard
npx rawstep report .rawstep/runs/RUN_DIR
```

- `task.json` is the natural-focus navigation fixture.
- `workflow-task.json` is an intentionally easy two-stage wiring test whose single button has HTML autofocus. It proves inference/action/changed-screen integration, not navigation accuracy.
- `openrouter-task.json` is the small call-to-action page used with a hosted OpenRouter decision model such as `cloudflare/clef-flash` (`kind: "decision"`, `provider: "openrouter"`, inputs `text` and `image`). It sends screenshots remotely and uses one installed Chrome with keyboard input; it does not enable VoiceOver or invoke an analysis LLM. Images use content parts inside `state`, verified with real color/order/invalid-image probes. See [image delivery investigation and repair](../../docs/openrouter-image-delivery.md).

Preserve failures and successes in separate output directories. See [verification](../../docs/screenshot-verification.md). Install Playwright Chromium separately or set `machine.browserExecutablePath` in `rawstep.config.json` to an explicitly selected compatible Chromium.

Screenshots can expose private page content, and a remote model receives them. Never confuse trace redaction with anonymization of a live screenshot sent to a model.
