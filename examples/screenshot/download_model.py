#!/usr/bin/env python3
"""Download pinned official safetensors/tokenizer data, never repository Python code."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
MODEL = "OmniJev/OneJev-0.8B"
REVISION = "c3939d8bf4cad34549a2b13bbb6aee9bcb6afee8"
FILES = {
    "README.md": (4622, "637421876e7b950b4c54dd40e78334aa7f07706f6392fc386d5e28289d26caa5"),
    "chat_template.jinja": (7755, "273d8e0e683b885071fb17e08d71e5f2a5ddfb5309756181681de4f5a1822d80"),
    "config.json": (2730, "09e987471d022500c939c71e06f86bf1239586e491546a8296d855689c022e2a"),
    "generation_config.json": (116, "62153eb6c69f2e1f426beaa8002b7186437e949c7588167085df14e10e9c0a73"),
    "model.safetensors": (2214590296, "cb4b7456703baa26a0cfacf177067200b50021df5a6ba2a2cd1e6f6c868f2244"),
    "processor_config.json": (1220, "bfbc24af59a3e73a9cd0653b8d4ae758dfaec4e3e6c15dfb1c6c8ee8d5683c85"),
    "tokenizer.json": (19989493, "b6d27c11283798debbfbcb1bd3bbdbcebac6c9b20d0be0c5b79231c97de97501"),
    "tokenizer_config.json": (1164, "7488550a894dcf741616126e322ea31d66cf9457b59ec5825f4c7efdced421f8"),
}


def fetch(filename):
    expected_size, expected_sha = FILES[filename]
    destination = ROOT / "model" / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists() or destination.stat().st_size != expected_size:
        temporary = destination.with_name(destination.name + ".part")
        urllib.request.urlretrieve(f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{filename}", temporary)
        if temporary.stat().st_size != expected_size:
            raise RuntimeError(f"Wrong byte count: {filename}")
        temporary.replace(destination)
    sha = hashlib.file_digest(destination.open("rb"), "sha256").hexdigest()
    if expected_sha and sha != expected_sha:
        raise RuntimeError(f"Checksum mismatch: {filename}")
    result = {"file": filename, "bytes": destination.stat().st_size, "sha256": sha}
    print(json.dumps(result), flush=True)
    return result


if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        downloaded = list(pool.map(fetch, FILES))
    (ROOT / "model-manifest.json").write_text(json.dumps({"model": MODEL, "revision": REVISION,
                                                        "files": downloaded}, indent=2) + "\n")
