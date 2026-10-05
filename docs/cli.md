# Current commands

Use --policy, --script, --decision systemone, or (screenshots only) --model-endpoint, exactly one. Native run also needs a backend/endpoint or Orca pairing. legacy-run is removed. Only analyze --llm selects the built-in network analyzer. See [SystemOne settings](./systemone.md) and rawstep --help.

`mock-run <task.json> --policy <module>|--script <decisions.json>` explicitly selects the browser-backed simulated VoiceOver profile. It prints a simulation warning, uses headless Chromium by default, accepts `--headed`, `--browser-executable`, `--diagnostic-screenshots`, and `--out`, and needs no native AT Driver endpoint. Native `run` still accepts only `voiceover` or `nvda`; `--backend mock` is not an alias. See [simulation support and limitations](./mock-voiceover.md).

All four run commands handle SIGINT (Ctrl+C) and SIGTERM by cancelling execution, closing resources, and saving an `aborted` outcome with its signal, stage and step. Signal handlers are removed when execution finishes. The CLI exits with 130 for SIGINT, 143 for SIGTERM, 1 for an unsuccessful run, and 2 for invalid command usage. A forced process kill cannot perform graceful cleanup or finalize the trace.

Unsuccessful saved runs print the reason, stage, any recorded error, and commands for creating a report and analyzing the trace. Native runs also print an AT Driver connection check. `doctor` reports the underlying connection cause and keeps it visible if cleanup also fails. A successful doctor probe establishes only a protocol connection; real speech and native host readiness still need to be verified. Retry a run with a fresh `--out` directory to preserve prior evidence.

`hints <trace.json|run-dir> [--reference <trace.json|run-dir>]` lists friction hints for a saved run, such as "succeeded, but took 23 Tabs". Hints point at steps worth a human look; they are not a pass/fail verdict. It prints the hint count, whether the goal was reached and the step count (plus the reference step count with `--reference`), one line per hint, and writes `hints.json` next to the trace. `analyze` also writes `hints.json` (without a reference), and `report` adds a "Friction hints" section when a `hints.json` sits next to the trace.

See the [bundled examples](../examples/v2/README.md) for separate installed-package (`npx rawstep`) and repository-checkout (`npm run rawstep --`) commands.

See the [current README](../README.md), [complete migration/API guide](./migration.md), [source map](./editing-map.md), and [test migration](./test-migration.md). Historical workspace-specific instructions were removed with their implementation.

## Explicit network proxy

Browser run and matrix commands accept `--proxy-server <url>`. Programmatic browser and run options use `proxyServer`. Only credential-free HTTP, HTTPS, SOCKS4 or SOCKS5 server URLs are accepted, with no path, query or fragment. This forwards the explicitly selected route to Playwright; it does not read ambient proxy settings, bypass access barriers or relax TLS/sandbox protections. A certificate or access error remains a blocker.
