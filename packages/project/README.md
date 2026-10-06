# @rawstep/project

The Rawstep project model: `rawstep.config.json`, task files, credentials in `.env.local` and the assembly and execution of one run. The CLI, the dashboard and `import { runTask } from 'rawstep'` all use it.

- `@rawstep/project/config` is browser-safe (schema and types only, no `node:` imports).
- The other subpaths are Node code: `store`, `plan`, `execution`, `run`, `discover`, `llm`, `errors`.

Part of the Rawstep monorepo. Build locally with `pnpm install` and `npm run build` at the workspace root.
