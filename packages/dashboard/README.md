# Rawstep local dashboard

A separate `@rawstep/dashboard` workspace in the pnpm monorepo. React, Vite and Tailwind provide the browser UI. A loopback Node service manages project files and calls the existing Rawstep Runner through `@rawstep/project` and public package exports. No database is required.

Run from the repository root with Node 22.12 or later:

```sh
corepack pnpm install --frozen-lockfile
npm run build
npm run rawstep -- ui
# Or: npm run dashboard -- --project /path/to/project --port 4318
```

Open the printed `http://127.0.0.1:4318` URL. Node serves the compiled UI and API together. `npm run dashboard:dev` starts the Node API and Vite on port 5173; set `RAWSTEP_DASHBOARD_PROJECT` to edit another project during development. `npm run dashboard:preview` serves the built application through Node.

The UI manages models by type (LLM or decision), provider and key, discovered models, roles, Task JSON files, task-owned prompt variants, global and per-task keyboard/screenreader permissions, environment profiles and policy limits. Experiments run sequentially as independent task/model/prompt/environment combinations. History includes comparison, saved snapshots, events, screenshots, reports and reviewed retries. A retry pins the original public conditions and reads fresh input values from the task file. Unsupported model/mode/backend combinations have explicit preflight reasons.

| Location | Responsibility |
|---|---|
| `src/web/components/ui` | Local shadcn source components |
| `components.json` | Pinned CLI aliases and theme configuration |
| `src/shared/ui-catalog.ts` | Approved JSON components, runtime validation, generation prompt and JSON Schema |
| `src/web/json-ui/registry.ts` | Official json-render shadcn implementations |
| `src/web/components/PermissionsEditor.tsx` | Catalog-validated, state-bound JSON permission forms |
| `src/web/styles.css` | Shared theme tokens and packaged-component Tailwind scan |
| `src/server` | File storage, API, model adapters and execution queue |
| `src/shared/config.ts` | Dashboard-only experiment and request contracts |
| `@rawstep/project/config` | `rawstep.config.json` schema and types |

Fixed navigation and domain pages compose local shadcn React components. JSON UI uses `@json-render/core`, `@json-render/react` and `@json-render/shadcn`; its catalog and registry both allow Card, Stack, Heading, Text, Badge, Separator, Checkbox, Switch, Button, Input, Textarea, Select, Table, Progress and Alert. Specs pass `parseDashboardSpec` before rendering. `dashboardCatalog.prompt()` and `dashboardCatalog.jsonSchema()` are ready for a future model-generated UI feature; no generation endpoint is enabled. JSON controls use built-in state bindings; saving and running use explicit application API handlers.

Add components using the pinned workspace CLI:

```sh
corepack pnpm --filter @rawstep/dashboard exec shadcn add dialog
```

For a new JSON component, update both the catalog and registry. Keep its implementation based on shadcn and validate its props and structure. `AGENTS.md` preserves these conventions for subsequent development.

Configuration is in `rawstep.config.json`, the same file `rawstep run` and `runTask` read, so tasks, models and profiles set up in the dashboard run unchanged from the CLI and in tests. Task JSON keeps its engine contract. Keys are stored in `.env.local` and returned only as configured/not-configured status. Runs live in `.rawstep/experiments`. Save conflicts preserve frontend drafts. A server restart marks unfinished runs interrupted and never automatically calls a model again.

Keyboard execution needs a model with confirmed/manual image support; native screenreader execution needs a matching OS and separately prepared AT Driver. Simulated speech is labelled simulation. UI supports simulation, VoiceOver and NVDA; Orca remains available through the library API. Browser zoom and native OS environment controls unavailable to the dashboard are rejected before running.

Verification:

```sh
npm run dashboard:build
npm run typecheck
corepack pnpm exec vitest run tests/dashboard-catalog.test.ts tests/dashboard-server.test.ts
RAWSTEP_TEST_BROWSER_PATH=/path/to/chromium npm run test:integration
npm run test:package
```

Local packing includes eight tarballs, including the private dashboard required by the CLI. Install the full documented dependency closure when using unpublished local packages. See `docs/dashboard-plan.ko.md` for the implementation requirements and evidence limits.
