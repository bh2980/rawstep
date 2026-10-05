# Model-free AT Driver examples

These examples and `fixtures/simple-cta.html` are bundled in the npm package. `task.json` resolves the fixture relative to its own directory, so run it from its installed location or preserve the same directory layout when copying it. Your own task JSON can use an absolute HTTP(S) URL or a file path relative to that JSON file.

Start the appropriate native AT Driver server yourself, then substitute its actual WebSocket URL. For real VoiceOver runs, use macOS on the same host as the server and visible browser; for NVDA, use Windows. `doctor` probes the endpoint but does not establish native speech readiness.

## Running the example

Set `machine.backend` to `voiceover` (macOS) or `nvda` (Windows) and `machine.atEndpoint` to the server's WebSocket URL in `rawstep.config.json` (for example `ws://127.0.0.1:4382/session`; `npx rawstep ui` edits it). Register a decision model in the same file; see [SystemOne](../../docs/systemone.md) and [config](../../docs/config.md). Then check the setup and run the bundled task in screen-reader mode:

```sh
npx rawstep doctor
npx rawstep run node_modules/rawstep/examples/v2/task.json --mode screenreader --model MODEL --out .rawstep/example
npx rawstep analyze .rawstep/example/run-1
npx rawstep report .rawstep/example/run-1
```

From a repository checkout use `npm run rawstep -- ...` and `examples/v2/task.json`. These `node_modules` paths assume npm's ordinary local layout; use the actual installed package path if your package manager uses a different layout. Run `npx rawstep --help` for the full command interface.

`policy.mjs` and `decisions.json` are library fixtures: pass them to `runTask` from `rawstep/runner` (with `loadPolicy` or `ScriptedPolicy`) to try a predetermined action sequence. The script is a fixture example; tab order and native focus still need to be checked. The independent verifier decides whether the task actually succeeded. Each run writes a fresh output directory; an existing one is never silently replaced.

The policy only receives genuine screen reader output, not DOM labels or screenshots. This example is not a production policy or a demonstration of successful native validation.

## Inspecting an unsuccessful run

The CLI prints the outcome, run-level hints and the saved run directory, and `npx rawstep doctor` checks the AT connection. The HTML report contains action results, per-rule verifier grounds, privacy counts, and expandable raw events. Earlier verification checks can be unmet while a later check succeeds; the final run outcome is authoritative. A report or analysis never changes that outcome.

Press Ctrl+C to cancel a running task gracefully. SIGINT and SIGTERM stop the task, close resources, and save an `aborted` outcome with its signal, stage and step. The CLI exits with 130 for SIGINT or 143 for SIGTERM. The saved partial trace can still be analyzed or reported. Re-run to get a fresh run directory; an existing run is never silently replaced.
