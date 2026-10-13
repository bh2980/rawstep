# Prompts and policies

Rawstep no longer ships LLM prompt templates, provider adapters, planning/reflection, or a completion client. Supply a trusted local `DecisionPolicy` module, or deterministic scripted decisions. Optional post-run model use belongs in an independent `TraceAnalyzer` module and cannot rewrite the recorded outcome.

See the [current README](../README.md) and the [source map](./editing-map.md). Historical workspace-specific instructions were removed with their implementation.

## Executor and planner instructions

Prompts belong to a run profile in [`rawstep.config.json`](./config.md#profiles): `profiles[].executors.<mode>.instructions` is the instruction text given to the model that picks each action in that mode. Tasks carry no prompts. Each run records the executor instructions as prompt id `<profileId>.<mode>`, with a content hash as its version, so runs with changed instructions can be told apart. To compare prompts, compare profiles that differ only in `instructions`.

A planned profile has its own `profiles[].planner.instructions` (screen reader mode only). They are added to Rawstep's planner rules (the plan document format, planning only from what was heard and with the listed actions), never replacing them, and are fingerprinted (sha256) in the plan evidence. Do not put page knowledge in them that a real user would not have, such as where a button is: that hides the friction Rawstep measures. Strategy or user-type guidance is fine. See [Planner and executor](./config.md#planner-and-executor-orchestration).

Analysis instructions (`project.analysis.instructions`, or a task's `analysisInstructions`) tell the analysis model what to focus on after a run. They never change an outcome.
