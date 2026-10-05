# Optional OneJev-4B companion

The source includes `onejev4b_server.py`, a loopback bridge from the Rawstep choice protocol to a separately installed official llama.cpp server. The model, its vision projector, tokenizer, Python packages and executable are not bundled or installed by npm. Source build, scripted browser fixtures and offline report generation need none of these assets.

## Platform scope

The measured runtime was **Linux x86-64 CPU**, official llama.cpp release `b11146` (commit `7fe450e19305b828c199d602c23a8337aaa1f03b`), Python 3.11 and the pinned companion requirements. The Linux binary cannot run on macOS. Apple Silicon/Intel Mac inference and Metal behavior were not verified. On a Mac, use the appropriate official llama.cpp build and its platform instructions; do not run the archived Ubuntu executable or assume the measured CPU timings apply.

Official runtime/source: [llama.cpp b11146](https://github.com/ggml-org/llama.cpp/releases/tag/b11146). Model data: [OneJev-4B](https://huggingface.co/OmniJev/OneJev-4B), [author-linked GGUF quantization](https://huggingface.co/mradermacher/OneJev-4B-GGUF). These are external prerequisites under their own licenses. This delivery does not assert that every pinned Python wheel is available for every platform.

## Data preparation

Requires Python 3.11 or newer. From the repository root:

```sh
python3 examples/screenshot/download_onejev4b.py
```

This explicitly downloads roughly 3.76 GB of pinned data into `examples/screenshot/onejev4b-assets`. Each exact size and SHA-256 is checked before new files replace temporary downloads. Existing mismatched files cause an error. No model-repository code or runtime executable is downloaded/executed. Use `--out /your/assets` for another directory; use `--verify-only` to verify existing data without downloading or writing a manifest.

The bridge uses `AutoTokenizer` and Pillow. Prepare a separate compatible Python environment, install `requirements.txt` explicitly, and verify the actual chosen runtime. The Linux-only PyTorch CPU command in the 0.8B README is not required to run this 4B llama.cpp bridge. Tokenizer loading uses local files and `trust_remote_code=False`.

## Start the two local processes

Run an already installed, trusted compatible `llama-server` in one terminal. Replace its executable path and asset paths with actual local paths. The flags below reproduce the measured Linux CPU configuration; a different platform/runtime may reject them and has not been verified here.

```sh
/path/to/llama-server --host 127.0.0.1 --port 8768 \
  -m examples/screenshot/onejev4b-assets/model/OneJev-4B.Q4_K_M.gguf \
  --mmproj examples/screenshot/onejev4b-assets/model/OneJev-4B.mmproj-f16.gguf \
  --no-mmproj-offload -ngl 0 -np 1 -c 4096 -t 6 -tb 6 -b 512 -ub 128 \
  --image-min-tokens 64 --image-max-tokens 384 --fit off
```

In another terminal from the repository root, using your prepared Python:

```sh
python3 examples/screenshot/onejev4b_server.py --llama-url http://127.0.0.1:8768 --port 8767
```

The default assets directory is next to the bridge. If data was downloaded elsewhere, set `RAWSTEP_ONEJEV_ASSETS` to that directory before starting it. Startup checks that vision is enabled and compares actual runtime tokenization with the pinned official tokenizer. Failure stops startup; it does not switch models.

Then run the built Rawstep source:

```sh
npm run rawstep -- matrix examples/profiles/task.json \
  --profiles default,reflow-text,forced-colors \
  --model-endpoint http://127.0.0.1:8767/choose --out runs/4b-matrix
```

Use a new output directory every time. Stop both local servers yourself after the run. Optional receipts contain task text and history; leave `--receipts` off for private work unless you deliberately need and protect that recording.

## Decision and validation limits

The bridge processes the supplied full screenshot into image data and returns an option selected from one-token distributions. Depending on distribution coverage it makes one or two single-output-token calls with equal option bias; this differs from the 0.8B direct forward pass. It does not generate a prose explanation or use DOM/AX/OCR. Probabilities are uncalibrated scores among the declared choices.

The earlier local environment experiment passed the normal and narrow-plus-200%-text fixtures with four real model-selected actions each. The forced-colors attempt timed out at the task budget; that is not evidence of a page accessibility defect. Those inference receipts predate physical package relocation. The final workspace was separately tested with real-browser/protocol fixtures, not claimed to rerun every historical model experiment or any Mac/native-AT session.
