# Model-free AT Driver examples

These examples and `fixtures/simple-cta.html` are bundled in the npm package. `task.json` resolves the fixture relative to its own directory, so run it from its installed location or preserve the same directory layout when copying it. Your own task JSON can use an absolute HTTP(S) URL or a file path relative to that JSON file.

Start the appropriate native AT Driver server yourself, then substitute its actual WebSocket URL. For real VoiceOver runs, use macOS on the same host as the server and visible browser; for NVDA, use Windows. `doctor` can probe another host but does not establish native speech readiness.

## Installed package

From a project where you installed `rawstep` with `npm install /absolute/path/to/artifacts/*.tgz`, use the bundled task and policy:

```sh
npx rawstep doctor --backend voiceover --endpoint ws://127.0.0.1:4382/session
npx rawstep run node_modules/rawstep/examples/v2/task.json --policy node_modules/rawstep/examples/v2/policy.mjs --backend voiceover --endpoint ws://127.0.0.1:4382/session --out .rawstep/example
npx rawstep analyze .rawstep/example
npx rawstep report .rawstep/example --analysis .rawstep/example/analysis.json
```

Use `--script node_modules/rawstep/examples/v2/decisions.json` instead of `--policy ...` for the predetermined sequence. These paths assume npm's ordinary local `node_modules` layout; use the actual installed package path if your package manager uses a different layout. Run `npx rawstep --help` for the full command interface.

## Repository checkout

From the repository root, after installing its development dependencies, use the source CLI:

```sh
npm run rawstep -- doctor --backend voiceover --endpoint ws://127.0.0.1:4382/session
npm run rawstep -- run examples/v2/task.json --policy examples/v2/policy.mjs --backend voiceover --endpoint ws://127.0.0.1:4382/session --out .rawstep/example
npm run rawstep -- analyze .rawstep/example
npm run rawstep -- report .rawstep/example --analysis .rawstep/example/analysis.json
```

Use `--script examples/v2/decisions.json` instead of `--policy ...` to try a predetermined action sequence. The script is a fixture example; tab order and native focus still need to be checked. The independent verifier decides whether the task actually succeeded. Use a fresh output directory for every run.

For NVDA choose `--backend nvda` and the actual URL of the Windows NVDA server. The policy only receives genuine screen reader output, not DOM labels or screenshots. This example is not a production policy or a demonstration of successful native validation.

## Inspecting an unsuccessful run

The CLI prints the recorded reason and stage, the saved trace path, and commands for inspecting evidence or checking the AT connection. The HTML report contains action results, per-rule verifier grounds, privacy counts, and expandable raw events. Earlier verification checks can be unmet while a later check succeeds; the final run outcome is authoritative. A report or analysis never changes that outcome.

Press Ctrl+C to cancel a running task gracefully. SIGINT and SIGTERM stop the task, close resources, and save an `aborted` outcome with its signal, stage and step. The CLI exits with 130 for SIGINT or 143 for SIGTERM. The saved partial trace can still be analyzed or reported. Re-run using a fresh `--out` directory; an existing run is never silently replaced.
