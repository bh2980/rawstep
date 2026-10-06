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

The UI manages connections by type (LLM or decision), provider and key (sidebar page 연결), run profiles with the model each runs and an optional analysis LLM (page 실행 프로필), discovered models, Task JSON files, task-owned prompt variants, global and per-task keyboard/screenreader permissions, environment profiles and policy limits. Experiments run sequentially as independent task/prompt/run profile combinations. History includes comparison, saved snapshots, events, screenshots, reports and reviewed retries. A retry pins the original public conditions and reads fresh input values from the task file. Unsupported profile/mode/backend combinations have explicit preflight reasons.

| Location | Responsibility |
|---|---|
| `src/web/components/ui` | Local shadcn source components |
| `components.json` | Pinned CLI aliases and theme configuration |
| `src/web/pages` | One page per route: home, tasks, task, run, new task, run history, settings |
| `src/web/lib` | Pure logic with unit tests: completion-check editor mapping, finding text, step dots, route parsing |
| `src/web/styles.css` | Shared theme tokens |
| `src/server` | File storage, API, model adapters and execution queue |
| `src/shared/config.ts` | Dashboard-only experiment and request contracts |
| `@rawstep/project/config` | `rawstep.config.json` schema and types |

Pages and domain components compose local shadcn React components. The route lives in the URL (`?view=`, `?task=&tab=`, `?task=&run=&step=`, `?task=new`), so reload and the back button restore the page. A task page shows the recurring findings of its runs (`GET /api/tasks/:id/findings`), the completion-check editor (its element picker uses `POST /api/page-elements`) and the task settings. A task is edited from its header (**작업 수정** opens a sheet for name, start URL, goal and run profile; **복제** copies it; **삭제** removes it from `rawstep.config.json` and deletes its `tasks/*.json` file, leaves a file linked from elsewhere in the project in place and never touches `.rawstep` run records: `DELETE /api/tasks/:id` with the revision). Connections and settings can check a setup on request: `POST /api/connections/check` asks a provider's model list once (a minimal decision for a custom decision server, or one named model) and answers by reason kind, `POST /api/browser/check` starts the browser once to read its version, and `POST /api/backend/check` talks to the screen reader driver, starting the AT Driver server with the command saved in this computer's `.env.local` (`RAWSTEP_AT_DRIVER_COMMAND`, read and written through `/api/machine/at-driver-command`, never stored in `rawstep.config.json`) when none answers. A run page shows a trace rail and one step at a time, outlines the focused element on the keyboard-mode screenshot from the page observer's focus box, and follows a live run through the SSE run events.

Add components using the pinned workspace CLI:

```sh
corepack pnpm --filter @rawstep/dashboard exec shadcn add dialog
```

`AGENTS.md` preserves these conventions for subsequent development.

Configuration is in `rawstep.config.json`, the same file `rawstep run` and `runTask` read, so tasks, connections and profiles set up in the dashboard run unchanged from the CLI and in tests. Task JSON keeps its engine contract. Keys are stored in `.env.local` and returned only as configured/not-configured status. Runs live in `.rawstep/experiments`. Save conflicts preserve frontend drafts. A server restart marks unfinished runs interrupted and never automatically calls a model again.

Keyboard execution needs a model with confirmed/manual image support; native screenreader execution needs a matching OS and separately prepared AT Driver. Simulated speech is labelled simulation. UI supports simulation, VoiceOver and NVDA; Orca remains available through the library API. Browser zoom and native OS environment controls unavailable to the dashboard are rejected before running.

Verification:

```sh
npm run dashboard:build
npm run typecheck
corepack pnpm exec vitest run tests/dashboard-*.test.ts
RAWSTEP_TEST_BROWSER_PATH=/path/to/chromium npm run test:integration
npm run test:package
```

Local packing includes eight tarballs, including the private dashboard required by the CLI. Install the full documented dependency closure when using unpublished local packages. See `docs/dashboard-plan.ko.md` for the implementation requirements and evidence limits.
