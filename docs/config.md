# Current configuration

Configuration is explicit task JSON plus CLI/programmatic options. Legacy AI_* variables and rawstep.config.ts are not restored. Only --decision systemone and analyze --llm load RAWSTEP_DECISION_* / RAWSTEP_ANALYSIS_*. Precedence: CLI overrides > process env > .env.local > .env. Files and process.env are never overwritten; libraries use injected configuration. See [SystemOne](./systemone.md) and root .env.example.

See the [current README](../README.md) and the [source map](./editing-map.md). Historical workspace-specific instructions were removed with their implementation.
