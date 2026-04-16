# Editing Map

This document is a reference for quickly finding **which file to open first** based on what you want to change.

For installation and the overall usage flow, start with `README.md`. For detailed specs, see `docs/task.md`, `docs/config.md`, and `docs/cli.md`.  
This file mainly answers one question: "Which file should I edit for this kind of change?"

---

## How to Use This

First, find the row that is closest to your change goal, then open the **source file** listed in the table.  
Do not edit generated files directly. Change the source or generation script first, then regenerate.

---

## Starting Points by Change Type

| Change goal | Source file | Other files you will likely check |
|-------------|-------------|-----------------------------------|
| Add a new keyboard key / change the default allowed key set | `packages/action-catalog/src/source.ts` → `keyboardActionSource` | `packages/action-catalog/scripts/generate.ts` |
| Add a new `sr.*` command / change backend support coverage | `packages/action-catalog/src/source.ts` → `screenReaderActionSource` | `packages/definition/src/backends/`, `packages/runtime/` |
| Change mode names / mode policy | `packages/definition/src/modes/source.ts` → `MODE_SPEC` | `packages/config/src/run-plan/precedence.ts`, `docs/config.md` |
| Change backend id / platform support / headless policy | `packages/definition/src/backends/source.ts` → `BACKEND_SPEC` | `packages/runtime/`, `docs/config.md` |
| Refresh backend capability snapshots | `packages/runtime/scripts/generate-backend-capabilities.ts` | `packages/definition/src/backends/generated-capabilities.ts` |
| Change allowed fields in `rawstep.config.ts` | `packages/config/src/project/source.ts` | `packages/config/src/project/schema.ts`, `docs/config.md` |
| Change config field validation rules | `packages/config/src/project/schema.ts` | `packages/config/src/project/source.ts`, `docs/config.md` |
| Change override precedence | `packages/config/src/run-plan/precedence.ts` | `packages/config/src/run-plan/resolve.ts`, `docs/config.md`, `docs/cli.md` |
| Change how the run plan is assembled | `packages/config/src/run-plan/resolve.ts` | `packages/config/src/run-plan/precedence.ts`, `apps/cli/src/index.ts` |
| Change CLI flags / help text | `packages/config/src/run-plan/cli-manifest.ts` | `apps/cli/src/args.ts`, `docs/cli.md` |
| Inspect CLI argument parsing flow | `apps/cli/src/args.ts` | `packages/config/src/run-plan/cli-manifest.ts`, `apps/cli/src/index.ts` |
| Inspect provider / model / apiKey resolution flow | `packages/config/src/run-plan/precedence.ts` | `apps/cli/src/index.ts`, `packages/agent/src/config.ts`, `docs/cli.md` |
| Change the task spec | `packages/definition/src/task/schema.ts` | `docs/task.md`, example tasks |
| Change verifier rules | `packages/definition/src/verify/` | `docs/task.md`, example tasks |
| Change prompt wording | `prompt/*.system.md`, `prompt/*.user.md` | `docs/prompts.md`, `prompts.json` after running |
| Change example tasks / fixtures | `examples/tasks/`, `fixtures/` | `README.md`, related docs |
| Change report structure / output | `packages/reporter/` | `docs/report.md` |

---

## Common Edit Flows

### Add a CLI Option

In most cases, edit these in this order:

1. `packages/config/src/run-plan/cli-manifest.ts`
2. `apps/cli/src/args.ts`
3. `packages/config/src/run-plan/precedence.ts` or `packages/config/src/run-plan/resolve.ts`
4. `docs/cli.md`

When you add a CLI flag, the help text, actual parsing, run plan application, and documentation should all be updated together.

### Add a Config Field

In most cases, check these together:

1. `packages/config/src/project/source.ts`
2. `packages/config/src/project/schema.ts`
3. `packages/config/src/run-plan/precedence.ts`
4. `docs/config.md`

If you only add the type and forget the schema or precedence, the value may not actually take effect at runtime.

### Change Action Definitions

If you want to change the actions themselves, edit `packages/action-catalog/src/source.ts` and regenerate.

```bash
pnpm generate:actions
```

Or you can rebuild everything:

```bash
pnpm build
```

---

## Generated File Rules

These are representative generated outputs:

- `packages/action-catalog/dist/*`
- `packages/definition/dist/*`
- `packages/config/dist/*`
- `packages/runtime/dist/*`
- `packages/definition/src/backends/generated-capabilities.ts`

Do not edit these files directly.  
Change the source file or generation script first, then regenerate them with a command.

### Frequently Used Commands

| Goal | Command |
|------|---------|
| Regenerate action catalog | `pnpm generate:actions` |
| Full build | `pnpm build` |
| Run tests | `pnpm test` |
| Regenerate backend capability snapshots | `pnpm --filter @rawstep/runtime generate:backend-capabilities` |
| Run an example task | `pnpm rawstep run examples/tasks/simple-cta.json` |

---

## Docs to Recheck After a Change

After code changes, it is a good habit to recheck the related documents too.

| Change | Docs to recheck |
|--------|-----------------|
| CLI option changes | `docs/cli.md` |
| Config schema / precedence changes | `docs/config.md` |
| Task spec changes | `docs/task.md` |
| Report output changes | `docs/report.md` |
| Prompt structure changes | `docs/prompts.md` |

If the code is correct but the docs are left behind, the next person touching the code usually wastes the most time.
