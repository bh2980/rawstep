# Prompts and policies

Rawstep no longer ships LLM prompt templates, provider adapters, planning/reflection, or a completion client. Supply a trusted local `DecisionPolicy` module, or deterministic scripted decisions. Optional post-run model use belongs in an independent `TraceAnalyzer` module and cannot rewrite the recorded outcome.

See the [current README](../README.md) and the [source map](./editing-map.md). Historical workspace-specific instructions were removed with their implementation.

## Agent instructions

Prompts belong to an agent's executors in [`rawstep.config.json`](./config.md#agents): `agents[].executors.<mode>.instructions` is the instruction text given to the model that picks each action in that mode. Tasks no longer carry prompts. Each run records the executor instructions as prompt id `<agentId>.<mode>`, with a content hash as its version, so runs with changed instructions can be told apart. To compare prompts, compare agents that differ only in `instructions`.

A planner has its own `agents[].planner.instructions` (screen reader mode only). They are added to Rawstep's planner rules, never replacing them, and are fingerprinted (sha256) in the plan evidence. Do not put page knowledge in them that a real user would not have, such as where a button is: that hides the friction Rawstep measures. Strategy or user-type guidance is fine. See [Planner and executor](./config.md#planner-and-executor-orchestration).
