# Contributing to Rawstep

This page is for people who build and change Rawstep from source. It answers: how do I build and test it, where does a change go, and which repository rules apply. If you only want to use Rawstep, start with the [README](./README.md).

## What you need

- Node.js 22.12 or later (`engines` in the root `package.json`).
- pnpm 10.12.1, the version pinned in the root `packageManager` field. Use it through Corepack, which ships with Node:

  ```sh
  corepack enable
  ```

  Every command below that starts with `corepack pnpm` uses that pinned version. Do not delete `pnpm-lock.yaml` or switch pnpm versions to "fix" an install.
- A Chromium that Playwright can drive, for the browser tests and for runs that use the simulated screen reader. See [Chromium](#chromium).

Real VoiceOver or NVDA, model keys and coding-agent CLIs are not needed to build or test. Nothing here installs or downloads them.

## Install, build, typecheck

```sh
corepack pnpm install --frozen-lockfile
npm run build
npm run typecheck
```

The workspaces import each other through their built `dist` folders, not through source paths. So **build before you typecheck or test**, and rebuild a package after you change it. `npm run build` removes every `dist` first, then builds in dependency order: `core`, `policies`, `browser`, `screenreaders`, `reports`, `project`, `dashboard` (tsc, then Vite), `cli`, and last `rawstep`, which bundles all the others with tsdown.

`npm run typecheck` runs `tsc --noEmit` in each workspace, then once over `tsconfig.tests.json` (all packages plus `tests/`).

## Test

| Command | What it runs |
|---|---|
| `npm test` | Every `tests/**/*.test.ts` except the integration files. Needs no browser. |
| `npm run test:integration` | Every `tests/**/*.integration.test.ts`. These start a real Chromium. |
| `npm run test:all` | `npm test`, then `npm run test:integration`. |
| `npm run test:package` | Packs the `rawstep` tarball, installs only that tarball into a temporary project and checks the CLI, `rawstep ui`, imports and a TypeScript consumer. See [Local tarball](#local-tarball). |
| `npm run check` | `build`, `typecheck`, `test:all`, `test:package`, in that order. This is the full gate. |
| `npm run test:source` | Copies the source to a clean folder, installs with the frozen lockfile and runs `npm run check` there. Slow. Use it before a release, not on every change. |

Vitest is configured to run one file at a time with one worker and to stop at the first failure (`vitest.config.mts`). Keep it that way: the browser suites open real browsers, and several at once can run a machine out of memory.

Run one file:

```sh
corepack pnpm exec vitest run tests/hints.test.ts
npm run test:integration -- tests/mock-runner.integration.test.ts
```

The second form passes its arguments through to Vitest in browser mode.

Do not count a browser suite as passed if it did not run.

### Chromium

Playwright's Chromium is not downloaded when you install. Install it once:

```sh
corepack pnpm exec playwright install chromium
```

If you already have a Chromium you trust, point at it instead:

- For **tests**, set `RAWSTEP_TEST_BROWSER_PATH` to the executable:

  ```sh
  RAWSTEP_TEST_BROWSER_PATH=/absolute/path/to/chromium npm run test:integration
  ```
- For **runs** from the CLI or the dashboard, set `machine.browserExecutablePath` in `rawstep.config.json` (Settings › This computer in the dashboard).

No test or run needs the browser sandbox turned off. In CI (Ubuntu 24.04) the workflow allows unprivileged user namespaces for Chromium's sandbox, and runs the integration suites under `xvfb-run` because some suites open a headed window. See `.github/workflows/ci.yml`.

For an offline machine, `COREPACK_HOME` can point at an existing writable Corepack cache that holds the pinned pnpm. `test:package` normally uses a fresh npm cache. For an explicitly offline run, set `RAWSTEP_SMOKE_NPM_CACHE` to a pre-filled npm cache and `RAWSTEP_SMOKE_OFFLINE=1`. Missing cached packages then fail the check instead of being downloaded.

## Try your build

Use a scratch folder as the project, so the checkout stays clean:

```sh
mkdir -p "$HOME/rawstep-try"
npm run rawstep -- init --project "$HOME/rawstep-try"
npm run rawstep -- run demo --project "$HOME/rawstep-try"
```

`npm run rawstep` runs `packages/cli/dist/cli/bin.js`, so it needs a build first. `rawstep.config.json` at the repository root is git-ignored if you prefer to work in the checkout, and so are `.env.*` files (except `.env.example`) and `.rawstep/`.

For the dashboard:

- `npm run rawstep -- ui` serves the built dashboard for a project.
- `npm run dashboard:dev` starts the API and the Vite dev server for working on the UI. See the [dashboard README](./packages/dashboard/README.md).

## Local tarball

Rawstep is not published to npm yet. The one package people install is `rawstep`. It contains the CLI, the dashboard and the library, with every `@rawstep/*` workspace bundled inside. To make the tarball:

```sh
npm run pack:rawstep
```

`scripts/pack-rawstep.mjs` builds, runs `npm pack` in `packages/rawstep`, and writes `artifacts/rawstep-<version>.tgz` and `artifacts/SHA256SUMS`. It fails if the packed manifest mentions `@rawstep/` or `workspace:`, or if a dependency is not pinned to an exact version. Install the tarball in another project:

```sh
npm install /absolute/path/to/rawstep/artifacts/rawstep-<version>.tgz
npx rawstep --help
```

Three more things to know about the bundle:

- `scripts/bundle-rawstep.mjs` copies the dashboard build to `dist/dashboard-web`, and copies `docs/`, `examples/`, `fixtures/`, `README.md`, `README.ko.md` and `THIRD-PARTY-NOTICES.md` into `packages/rawstep/`. In the copied READMEs, relative links are rewritten to links into the GitHub repository, because the package page shows them away from the repository. Those copies are git-ignored and overwritten on every build. Edit the originals at the repository root.
- The only third-party runtime dependencies of `rawstep` are `ai`, `@ai-sdk/openai-compatible`, `playwright` and `zod`. If a workspace starts importing another third-party package, add it to `packages/rawstep/package.json` and to `deps.onlyImport` in `packages/rawstep/tsdown.config.ts`, or the build and `tests/source-graph-migration.test.ts` fail.
- The public import paths come from the `exports` of `packages/rawstep/package.json` and the `src/<name>/index.ts` files next to it. `tests/public-api.test.ts` pins the export lists.

## Workspaces

Every workspace lives in `packages/<name>/src` and is private except `rawstep`. A workspace may depend only on workspaces earlier in this list, and may import only what the other package lists in its `exports`. `tests/source-graph-migration.test.ts` checks both rules.

| Order | Package | Owns |
|---|---|---|
| 1 | `@rawstep/core` | The contracts everything shares: task, actions, observations, backend and policy interfaces (`contracts/`); the page environment schema and built-in names (`profiles/`); the trace format, redaction and persistence (`trace/`); defaults and errors. No dependencies. |
| 2 | `@rawstep/policies` | Who decides. The plan document, the planner interface, how Rawstep carries out a plan, plan files (`policy/`); every model call and the planner's standing instructions (`llm/`); coding-agent CLIs over ACP (`acp/`). |
| 3 | `@rawstep/browser` | The browser and the run: opening pages and keeping navigation in scope (`browser/`), the runner with its budgets, input gates and cancellation (`runner/`), the independent verifier (`verify/`), applying page environments (`profiles/`) and the page observer (`observer/`). |
| 4 | `@rawstep/screenreaders` | The two screen reader backends and the evidence behind the simulation: the AT Driver client (`at-driver/`), the simulated VoiceOver (`mock-voiceover/`) and the reported-speech corpus (`evidence/`). |
| 5 | `@rawstep/reports` | Reading a saved trace: friction hints (`hints/`), how a run ended (`endings/`), analysis (`analyze/`) and the HTML and JSON reports (`report/`). |
| 6 | `@rawstep/project` | What the CLI and the dashboard share: the `rawstep.config.json` schema (`config.ts`), the project store and `.env.local` credentials (`store.ts`), turning a task and a run profile into a run (`plan.ts`, `execution.ts`, `run.ts`), model discovery (`discover.ts`), the demo written by `init` (`demo.ts`) and the AT Driver server starter (`atdriver.ts`). |
| 7 | `@rawstep/dashboard` | The local dashboard: a Node API (`server/`), the types shared with the browser (`shared/`) and the React UI (`web/`). |
| 8 | `@rawstep/cli` | The commands: `init`, `ui`, `run`, `hints`, `report`, `analyze`, `doctor` (`cli/`). It starts the dashboard for `ui`. |
| 9 | `rawstep` | The published package. `src/` holds only re-exports (one folder per public import path) and the executable. `tsdown` bundles everything into `dist/`. |

## Where a change goes

| You want to change | Look in |
|---|---|
| A field of `rawstep.config.json`, its defaults or its validation | `packages/project/src/config.ts` |
| The task file format or completion checks | `packages/core/src/contracts/`, `packages/browser/src/verify/` |
| How a run turns a task and a profile into a result | `packages/project/src/plan.ts`, `execution.ts`, `run.ts` |
| What the planner is told, or how a plan is followed | `packages/policies/src/llm/rules.ts`, `packages/policies/src/policy/` |
| Moves, presses, typing, limits and cancellation | `packages/browser/src/runner/` |
| Simulated VoiceOver wording or behaviour | `packages/screenreaders/src/mock-voiceover/` ([internals](./packages/screenreaders/src/mock-voiceover/README.md)) |
| Real VoiceOver or NVDA keys and routines | `packages/screenreaders/src/at-driver/` ([notes](./packages/screenreaders/src/at-driver/README.md)) |
| Hints, endings, reports | `packages/reports/src/` |
| A CLI command or its output | `packages/cli/src/cli/` |
| The dashboard | `packages/dashboard/src/` ([README](./packages/dashboard/README.md)) |
| A new public import path or export | `packages/rawstep/src/<name>/index.ts` and `packages/rawstep/package.json` |
| Build, pack and smoke scripts | `scripts/` |

`fixtures/` holds the HTML pages that tests and examples use. `examples/` holds runnable task files ([examples/README.md](./examples/README.md)). `tests/` holds all tests, with helpers in `tests/helpers/`.

The generated files `packages/screenreaders/src/evidence/data.ts` and `learned-data.ts` come from the scripts in `scripts/` (see the [simulator README](./packages/screenreaders/src/mock-voiceover/README.md#reproducing-the-corpus-data)). Do not edit them by hand, and never change recorded speech.

## Git hooks and commits

`npm install` runs `husky` (the `prepare` script) and installs two hooks:

- `commit-msg` runs commitlint on the message.
- `pre-push` runs `npm run build`, `npm run typecheck` and `npm test`. It checks only. It does not run the browser suites or `test:package`, because they are slow; run `npm run check` before you open a pull request.

Commit messages follow Conventional Commits, as configured in `commitlint.config.mjs`:

```text
type(scope): subject
```

- `type` is a standard Conventional Commits type, for example `feat`, `fix`, `refactor`, `docs`, `chore`. Add `!` for a breaking change (`feat!:`).
- `scope` is optional. If you give one, it must be one of `core`, `policies`, `browser`, `screenreaders`, `reports`, `project`, `cli`, `dashboard`, `rawstep`, `deps` or `repo`.
- The header is at most 100 characters. The subject in this repository's history is written in Korean, and the subject-case rule is switched off for that reason.
- Bodies and footers have no line-length limit.

CI (`.github/workflows/ci.yml`) runs build, typecheck, `npm test` and the integration suites on every pull request.

## Repository rules

- **Never name a real company or a real website.** Not in code, tests, fixtures, docs, commit messages or pull requests. Write "a real site". Test pages are the local files in `fixtures/`.
- **Experiments stay outside the repository.** Lab configs, experiment projects, throwaway scripts and internal plan documents live on your machine, not in a commit. Use `.git/info/exclude` to keep them out of `git status`. This repository holds the library, its tests, fixtures, examples and docs.
- **No secrets.** API keys go in `.env.local` or the process environment. `.env.*` files other than `.env.example` are git-ignored. A task file's input values are examples only.
- **Keep the claim honest.** Simulated speech is never presented as native screen reader output, and a hint is never presented as a verdict. When you add wording, a table or a message that touches this, say what the evidence is.
- **Use the terms the product uses.** The dashboard UI is in Korean and English, and every visible string goes through the locale files of both languages ([dashboard rules](./packages/dashboard/AGENTS.md#language)). Docs are in English and name dashboard screens by their English labels.
- **Do not edit generated or copied files.** `dist/`, `artifacts/`, the copies under `packages/rawstep/` and the evidence data files are produced by scripts.

## Documentation

User docs are in `docs/` and the root README; look-up pages are in `docs/reference/`. Contributor docs sit next to the code they describe:

- [Simulated VoiceOver internals](./packages/screenreaders/src/mock-voiceover/README.md)
- [AT Driver key mapping and rotor routines](./packages/screenreaders/src/at-driver/README.md)
- [Dashboard README](./packages/dashboard/README.md) and [dashboard development rules](./packages/dashboard/AGENTS.md)
- [Third-party notices](./THIRD-PARTY-NOTICES.md)
- [Examples](./examples/README.md)

When you change behaviour a doc states, change the doc in the same pull request. Check each claim against the code, not against another doc.
