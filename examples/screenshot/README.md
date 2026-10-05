# Actual screenshot decision model

For the hosted OpenRouter/Clef Flash sample, register `cloudflare/clef-flash` as an `openrouter-decisions` model with text and image inputs on an `openai` connection to `https://openrouter.ai/api/v1`, with its API key in `.env.local` (see [SystemOne](../../docs/systemone.md)), then run `npx rawstep run examples/screenshot/task.json --model clef-flash --mode keyboard`. This sends screenshots remotely and uses one installed Chrome with keyboard input; it does not enable VoiceOver or invoke an analysis LLM. Images use content parts inside `state`, verified with real color/order/invalid-image probes. See [image delivery investigation and repair](../../docs/openrouter-image-delivery.md). Generic SystemOne HTTP, `/choose`, and the optional local OneJev setup below are alternatives; nothing is installed automatically.

The screenshot runner works with any `ScreenshotModelAdapter`. This optional companion serves **OmniJev/OneJev-0.8B** locally, with pinned official decision-fine-tuned multimodal weights. It is independent of TypeSafe's proprietary Jev. It is not a text-only Laya model or a generic VLM renamed Jev.

The Python server uses standard Transformers with `trust_remote_code=False`. It never calls `generate()`. It uses one forward pass, scores all declared option-letter tokens, computes softmax and returns argmax. Screenshots are actually processed into image tensors. All keyboard choices remain available: prompt instructions do not replace or filter decisions. A uniform-gray-image ablation, keeping task and options identical, produced a different decision in the documented test.

## Optional runtime installation (measured Linux CPU only)

This example was tested with Python 3.11 on cloud Linux CPU. PyTorch packages below are the official CPU index builds. The model is approximately 2.2 GB; allow additional disk/RAM for Python packages and inference. These are separate from Rawstep's npm dependencies. The `+cpu` index command below is Linux-specific; do not treat it as a macOS installation recipe. macOS model execution and Apple acceleration have not been tested in this delivery. Rawstep itself can first be built and its scripted fixture run without any model runtime. See the separate [4B bridge setup](./onejev4b.md) for the other measured model.

```sh
cd examples/screenshot
python3 -m venv .venv
.venv/bin/python -m pip install torch==2.14.1+cpu torchvision==0.29.1+cpu \
  --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python download_model.py
.venv/bin/python onejev_server.py --port 8766
```

The downloader fetches only an explicit data/config/tokenizer allowlist from model revision `c3939d8bf4cad34549a2b13bbb6aee9bcb6afee8`, validates sizes and known LFS SHA-256 values, and creates a local manifest. It never downloads repository Python code. The server loads local files with offline flags and binds only to `127.0.0.1`. No model download, dependency install or server execution happens automatically during npm import/install/build.

Register the server in `rawstep.config.json` (`npx rawstep ui`): a `screenshot` connection with `baseURL` `http://127.0.0.1:8766/choose` and a model on it with protocol `choose` and image input (here called `onejev`). In another shell from the Rawstep repository:

```sh
npm run rawstep -- run examples/screenshot/task.json --model onejev --mode keyboard --out runs/screenshot-01
npm run rawstep -- report runs/screenshot-01/run-1
```

In a shell environment with isolated network namespaces, run the server and Rawstep from the same command/parent process. Standard local terminals do not usually require this. Install Playwright Chromium separately or set `machine.browserExecutablePath` in `rawstep.config.json` to an explicitly selected compatible Chromium.

`task.json` is the natural-focus navigation fixture. `workflow-task.json` is an intentionally easy two-stage wiring test whose single button has HTML autofocus. It proves inference/action/changed-screen integration, not navigation accuracy. Preserve both failures and successes in separate output directories. See [verification](../../docs/screenshot-verification.md).

The default prompt `--guidance keyboard-v2` adds general visible-focus and repetition guidance while preserving OneJev's published template and all options. `--guidance baseline` reproduces the initial generic prompt. Neither performs DOM inspection, action filtering or scripted fallback.

## Provenance and limits

- [Official OneJev project](https://github.com/OmniJev/OneJev), [model card](https://huggingface.co/OmniJev/OneJev-0.8B), Apache-2.0 model license
- Pinned checkpoint: `c3939d8bf4cad34549a2b13bbb6aee9bcb6afee8`
- Weight SHA-256: `cb4b7456703baa26a0cfacf177067200b50021df5a6ba2a2cd1e6f6c868f2244`
- Standard Transformers5.18.0 / PyTorch2.14.1 CPU, BF16, six inference threads
- Whole-frame resize budget:393216 pixels. Small text and thin focus indicators may become hard to recognize
- Choice count:2–26. Additional named input choices can exceed this server's limit and produce an explicit error
- CPU calls take seconds. Publisher GPU latency figures do not describe this setup
- Scores are not calibrated correctness probabilities, accessibility evidence or completion verification

HTTP responses include identity, revision, actual image hashes/tensor dimensions, token count and option logits. Rawstep retains policy evidence separately from its independent verifier. Server request receipts are disabled by default. `--receipts path.jsonl` explicitly enables private local test receipts containing task goal and history; newly created receipt files use0600. Use only synthetic/non-sensitive data. Never confuse trace redaction with anonymization of a live screenshot sent to a model.

The source scripts here are a small standalone integration written for Rawstep. They use the official option-letter prompt format as data; no remote model project code is executed. Model weights and third-party runtime packages retain their own licenses and are not redistributed inside the npm package.
