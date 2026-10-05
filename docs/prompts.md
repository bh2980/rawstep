# Model-neutral policies

Rawstep no longer ships LLM prompt templates, provider adapters, planning/reflection, or a completion client. Supply a trusted local `DecisionPolicy` module, or deterministic scripted decisions. Optional post-run model use belongs in an independent `TraceAnalyzer` module and cannot rewrite the recorded outcome.

See the [current README](../README.md), [complete migration/API guide](./migration.md), [source map](./editing-map.md), and [test migration](./test-migration.md). Historical workspace-specific instructions were removed with their implementation.
