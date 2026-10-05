#!/usr/bin/env python3
"""Explicitly download pinned model/tokenizer data; never install or execute a runtime."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

MODEL_REPO = 'mradermacher/OneJev-4B-GGUF'
MODEL_REV = '5437c6a21a623ed983f9fd45b0ff5ccd2a9b0a80'
TOKENIZER_REPO = 'OmniJev/OneJev-4B'
TOKENIZER_REV = 'c88e18653ceb7a8770716287f55fdefc79d6b588'
FILES = [
    ('model', MODEL_REPO, MODEL_REV, 'OneJev-4B.Q4_K_M.gguf', 3066385728, 'e1389755db1a3f838f39e7a1e4aa25ede720ae9e0311d4e56fb41d2fdd8e588c'),
    ('model', MODEL_REPO, MODEL_REV, 'OneJev-4B.mmproj-f16.gguf', 672423488, 'a8b6e58ee3cc115431876dff502c65dbf3d2ae89c7b3ce278b96ef875b1cb5cb'),
    ('tokenizer', TOKENIZER_REPO, TOKENIZER_REV, 'tokenizer.json', 19989493, 'b6d27c11283798debbfbcb1bd3bbdbcebac6c9b20d0be0c5b79231c97de97501'),
    ('tokenizer', TOKENIZER_REPO, TOKENIZER_REV, 'tokenizer_config.json', 1164, '7488550a894dcf741616126e322ea31d66cf9457b59ec5825f4c7efdced421f8'),
    ('tokenizer', TOKENIZER_REPO, TOKENIZER_REV, 'chat_template.jinja', 7756, 'a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715'),
    ('tokenizer', TOKENIZER_REPO, TOKENIZER_REV, 'processor_config.json', 1220, 'bfbc24af59a3e73a9cd0653b8d4ae758dfaec4e3e6c15dfb1c6c8ee8d5683c85'),
]

def check(path: Path, size: int, expected: str) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(4 * 1024 * 1024):
            digest.update(chunk)
    actual = digest.hexdigest()
    if path.stat().st_size != size or actual != expected:
        raise ValueError(f'Size/SHA-256 mismatch: {path.name}; existing data was not overwritten')
    return actual

def prepare(root: Path, *, verify_only: bool = False):
    receipts = []
    for directory, repo, revision, name, size, digest in FILES:
        path = root / directory / name
        if not path.exists():
            if verify_only:
                raise FileNotFoundError(f'Missing pinned data: {path}')
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + '.part')
            url = f'https://huggingface.co/{repo}/resolve/{revision}/{name}'
            with urllib.request.urlopen(url, timeout=180) as response, temporary.open('wb') as output:
                while chunk := response.read(4 * 1024 * 1024):
                    output.write(chunk)
            check(temporary, size, digest)
            temporary.replace(path)
        actual = check(path, size, digest)
        receipt = {'file': f'{directory}/{name}', 'repository': repo, 'revision': revision, 'bytes': size, 'sha256': actual}
        receipts.append(receipt)
        print(json.dumps(receipt), flush=True)
    if not verify_only:
        (root / 'manifest.json').write_text(json.dumps({'dataOnly': True, 'files': receipts}, indent=2) + '\n')
    return receipts

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parent / 'onejev4b-assets')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    prepare(args.out, verify_only=args.verify_only)
