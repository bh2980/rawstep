# Current task format

Tasks contain `url`, `goal`, nonempty `verify.all`, and optional `id`, `mode`, `maxSteps`, `timeoutMs`, `input`, and `navigation`. `input` maps names to string values; policies refer to names instead of supplying arbitrary literal text. Relative fixture paths resolve from the task file directory. Keyboard tasks use `screenshot-run`; the duplicate `legacy-run` was removed in 0.2.

See the [current README](../README.md), [complete migration/API guide](./migration.md), [source map](./editing-map.md), and [test migration](./test-migration.md). Historical workspace-specific instructions were removed with their implementation.
