# @rawstep/dashboard

This page is for people who work on the local dashboard (`npx rawstep ui`). It answers: how do I run it while developing, how are the server and the web app laid out, and what does the API offer. The rules to follow when you change it are in [AGENTS.md](./AGENTS.md). The visual and writing language is in [design-language.ko.md](./design-language.ko.md). If you only want to use the dashboard, see [Getting started](../../docs/getting-started.md).

The dashboard is a private workspace. It is bundled into the published `rawstep` package, and `rawstep ui` serves it. It has two parts:

- **`src/server`**: a Node HTTP server on `127.0.0.1`. It reads and writes the project's files through `@rawstep/project`, runs experiments through the same code `rawstep run` uses, and serves the built UI. There is no database.
- **`src/web`**: a React 19 single-page app built with Vite and Tailwind 4, using local shadcn/ui components. Every visible string is Korean.

The UI labels it shows are, with English glosses: 작업 (Tasks), 실행 기록 (Run history) and 설정 (Settings). 설정 has three groups: 실행 (Run) with 실행 프로필 (Run profiles), 모델 (Models) with AI 연결 (AI connections), and 이 컴퓨터 (This computer).

## Run it

From the repository root, after `npm run build` (see [CONTRIBUTING](../../CONTRIBUTING.md)):

```sh
npm run rawstep -- ui                    # the CLI starts the dashboard for the current project
npm run dashboard -- --project /path/to/project --port 4318
```

Both print `Rawstep dashboard: http://127.0.0.1:<port>`. The server serves the built UI (`dist/web`) and the API on that one address. The default port is 4318.

For UI work:

```sh
npm run dashboard:dev
```

This starts the API server (through `tsx`, port 4318) and the Vite dev server (port 5173, fixed) together. Open `http://127.0.0.1:5173`. Vite proxies `/api` to 4318, and the server accepts requests whose `Origin` is the dev server. The project it edits is the repository root unless you set `RAWSTEP_DASHBOARD_PROJECT`:

```sh
RAWSTEP_DASHBOARD_PROJECT=/path/to/project npm run dashboard:dev
```

Other commands:

| Command | What it does |
|---|---|
| `npm run dashboard:build` | Typechecks, compiles the server to `dist/server`, builds the UI to `dist/web` |
| `npm run dashboard:preview` | Serves the built app with Node (same as `npm run dashboard`) |
| `corepack pnpm --filter @rawstep/dashboard exec shadcn add <component>` | Adds a shadcn component to `src/web/components/ui` |

The built `dist/web` is copied to `dist/dashboard-web` inside the `rawstep` package. The server finds it in either place.

Tests live in the repository root `tests/` (`tests/dashboard-*.test.ts`). The ones that need a browser are `*.integration.test.ts`. Run one with `corepack pnpm exec vitest run tests/dashboard-server.test.ts`.

## What it stores

| What | Where |
|---|---|
| Connections, run profiles, tasks, machine settings | `rawstep.config.json` in the project (the same file the CLI and `runTask` read) |
| Task definitions | The `tasks/*.json` files the config points at |
| API keys, the AT Driver start command | `.env.local` in the project. Keys are returned to the UI only as configured or not configured. |
| Experiment records | `.rawstep/experiments/<experiment-id>/experiment.json` |
| A run's files | `.rawstep/experiments/<experiment-id>/<run-id>/` (`trace.json`, `trace.jsonl`, `hints.json`, `analysis.json`, `report.html`, `diagnostics/step-<n>.png`) |
| Browser profile for runs | `.rawstep/browser-profile` |

Saves carry the config's revision. A save against a stale revision is refused with 409, and the UI keeps the person's draft separate from the file so a conflict does not lose edits. The server also re-reads the config every 1.5 s and tells the UI when it changed on disk.

On start, the server marks any run still `queued` or `running` as `interrupted`. It never calls a model again by itself.

## Server

`src/server`:

| File | Owns |
|---|---|
| `index.ts` | `startDashboard`: routing, the loopback and origin checks, the event stream, static files |
| `bin.ts` | The `dashboard` executable (`--project`, `--port`) |
| `queue.ts` | `ExperimentQueue`: planning combinations, running them one at a time, cancel, retry, deletion, persistence |
| `views.ts` | `RunViews`: read-only projections of saved runs (steps, hints, findings per task, task summaries) |
| `steps.ts` | Folding a trace into steps and a plan document; bot-check and blocked-navigation notices; the screenshot path rule |
| `checks.ts` | Provider, model and browser checks |
| `suggest.ts`, `structure.ts` | Completion-check suggestions and the page-element picker (both open the start page in a browser) |
| `files.ts` | Listing project files for the plan-file and task-file pickers |
| `http.ts` | `HttpError` and the Korean text for each project error code |

`src/shared` holds types and a Zod schema used by both sides with no Node code: `api.ts` (response shapes) and `config.ts` (experiment and request types).

An experiment is tasks × run profiles × repeats. `POST /api/plan` expands a request into combinations and says for each whether it can run and why not (no planner, no key, an action the screen reader lacks, an unsupported page environment). `POST /api/experiments` stores the supported ones and starts the queue. Runs go one at a time. A retry keeps the original run's public conditions and re-reads input values from the task file.

### Security

- A request is refused unless its `Host` is a loopback name and, when it has an `Origin`, that origin is a loopback address on this server's port (or the dev server's).
- The report is served with a restrictive Content-Security-Policy and `sandbox`.
- Screenshots are served only for trace events of the screenshot kinds, from a path that must match `diagnostics/(step-<n>|start-page).png`, and not when the event was redacted. A path from the client is never used.
- Request bodies over 2 MB are refused.
- `POST /api/credentials/reveal` returns a saved key so the person editing it can see it. It is safe only because the server listens on loopback and checks `Host` and `Origin`.

### API

All paths start with `/api`. Bodies and responses are JSON unless noted. Errors are `{ "error": "<Korean message>" }`.

| Method and path | Purpose |
|---|---|
| `GET /events` | Server-sent events: `changed` (refetch) and `run-event` (one per run per 250 ms at most) |
| `GET /state` | Config, revision, key status, task JSONs, runnable page environments, per-screen-reader action lists |
| `PUT /config` | Save the config (`config`, `revision`, optional `taskWrite`) |
| `POST /credentials`, `POST /credentials/reveal` | Save or read back a key (by provider, or by connection ID for a custom server) |
| `POST /connections/check` | Ask a provider's model list once (or check one model) |
| `POST /connections/models` | List a connection's models |
| `POST /connections/sign-in` | Start a coding-agent CLI's own sign-in, on the person's request |
| `POST /browser/check` | Start the browser once and read its version |
| `POST /backend/check` | Check the Chromium for the simulation, or open an AT Driver session for VoiceOver or NVDA (starts the server with the saved command if none answers) |
| `GET`, `PUT /machine/at-driver-command` | Read and write `RAWSTEP_AT_DRIVER_COMMAND` in `.env.local` |
| `GET /files` | Project files, relative paths |
| `POST /suggest-checks` | Ask the suggestion model for completion checks for a start page and goal |
| `POST /page-elements` | Read a start page's notable elements for the picker |
| `GET /tasks/candidates`, `POST /tasks/import` | Find and read task files not yet in the config |
| `DELETE /tasks/<id>` | Remove a task from the config and delete its file (with `revision`). Refused while it has runs queued or running. |
| `GET /tasks/<id>/findings` | Recurring findings and facts for a task, per batch (`?batch=<experiment-id>`) |
| `GET /tasks-summary` | One summary row per task |
| `POST /plan` | Expand an experiment request into combinations |
| `GET`, `POST /experiments` | List experiments, or create and start one |
| `DELETE /experiments/<id>` or `/experiments/<id>/runs/<run>` | Delete a whole experiment or one run |
| `POST /runs/delete` | Delete many runs |
| `POST /experiments/<id>/cancel`, `.../runs/<run>/cancel` | Stop an experiment or one run |
| `GET`, `POST /experiments/<id>/runs/<run>/retry` | Preview the task changes since the run, or retry with the revision shown |
| `GET /experiments/<id>/runs/<run>/events` | The run's raw trace events |
| `GET /experiments/<id>/runs/<run>/steps` | The steps view, plan document and notices (live while the run records) |
| `GET /experiments/<id>/runs/<run>/hints` | The run's hints |
| `GET /experiments/<id>/runs/<run>/trace`, `.../analysis` | Download `trace.json` or `analysis.json` |
| `GET /experiments/<id>/runs/<run>/report` | `report.html`, once complete |
| `GET /experiments/<id>/runs/<run>/png/<event-id>` | A diagnostic screenshot |

## Web

`src/web`:

| Folder or file | Owns |
|---|---|
| `main.tsx`, `App.tsx` | Entry and the page shell: data loading, the run dialog, the page switch |
| `api.ts` | `fetch` wrapper for `/api` that keeps the HTTP status |
| `pages/` | One component per screen: `TasksPage`, `TaskPage`, `NewTaskPage`, `RunPage`, `RunsPage`, `SettingsPage` (its parts are in `pages/settings/`) |
| `components/` | Domain components. `components/ui` holds the shadcn primitives; `layout`, `conditions` and `trace` group the rest |
| `hooks/` | `useRoute` (the URL is the route), `useDashboardData` (state, experiments, summaries; refetched on `changed`, no polling), `useLiveEvents` (one `EventSource`), `useAnnouncer` (throttled live-region text) and a few more |
| `lib/` | Pure logic: finding and step text, the persona presets, task JSON helpers, step dots, error views. Tested from the root `tests/`. |
| `i18n/` | react-i18next with one Korean namespace. The strings are in `locales/ko/*.ts`; `labels.ts` maps enum values to labels |
| `styles.css` | Theme tokens |

The route lives in the URL, so reload and the back button restore the page:

| URL | Screen |
|---|---|
| `/` | 작업 (Tasks) list |
| `?task=<id>` with `&tab=overview\|runs\|check\|settings` | One task: 개요 (Overview), 실행 기록 (Run history), 완료 확인 (Completion check), 설정 (Settings) |
| `?task=new` | New task |
| `?task=<id>&run=<run-id>&step=<n>` | One run, at a step |
| `?view=runs` | 실행 기록 (Run history) |
| `?view=settings&section=profiles\|connections\|machine` | 설정 (Settings): 실행 프로필, AI 연결, 이 컴퓨터 |

Behaviour worth knowing before you change it:

- A task is run from its page: a run bar (repeats, 실행) and one profile line, with 프로필 편집 (edit profile) to change the shared profile in a side sheet or split off a copy for this task. A new task is only created, never run on creation.
- A run page shows a dot timeline of steps (one tab stop, arrow keys to move), one step at a time, the plan document with its versions and planner calls, and follows a live run through the `run-event` stream.
- A connection holds only where models are reached. The model and effort are picked where they are used: the run profile's planner, the analysis model, the completion-check suggestion model.
- Results show facts and friction hints. The LLM explanation of a run, when the profile has an analysis model, is labelled as such and is never shown as a verdict.
- Settings checks (a connection, a model, the browser, the screen reader driver) run only when the person asks.
