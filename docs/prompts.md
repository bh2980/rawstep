# Prompts

For using the package, see the [README](../README.md); for where the source lives, the [source map](./editing-map.md). Tasks run with `rawstep run <task>` or the dashboard (`rawstep ui`), and the settings are in the [configuration reference](./config.md).

## Planner instructions

The planner is the only model that decides anything in a run, and its prompt belongs to a run profile in [`rawstep.config.json`](./config.md#profiles): `profiles[].planner.instructions`. Tasks carry no prompts, and no model picks individual actions. The instructions are added to Rawstep's planner rules (the plan document format, how tasks are shaped so Rawstep can carry them out as written, planning only from what was heard and with the listed actions), never replacing them. Each plan records the full instructions as the prompt `rawstep-planner`, with a sha256 fingerprint and a short version taken from it, so runs with changed instructions can be told apart. To compare prompts, compare profiles that differ only in `instructions`.

Do not put page knowledge in them that a real user would not have, such as where a button is: that hides the friction Rawstep measures. Strategy or user-type guidance is fine. A plan file has no instructions; its own hash is recorded instead. See [Planner and plan](./config.md#planner-and-plan).

Analysis instructions (`project.analysis.instructions`, or a task's `analysisInstructions`) tell the analysis model what to focus on after a run. They never change an outcome.
