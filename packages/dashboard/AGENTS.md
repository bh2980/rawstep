# Dashboard development

This workspace owns the local Rawstep dashboard. Use pnpm 10.12.1 from the root packageManager field. The application uses a local Node API, project files and the existing Runner. See docs/dashboard-plan.ko.md for the full requirements and remaining verification.

- Use shadcn/ui for controls and product components. Local components live in src/web/components/ui. Compose these primitives for domain components and keep the existing theme tokens, spacing, Geist font and Lucide icons consistent.
- For JSON-driven UI, use @json-render/core, @json-render/react and @json-render/shadcn. Register components in src/shared/ui-catalog.ts and src/web/json-ui/registry.ts. Every registered implementation must use shadcn/ui. Keep static navigation and the application shell as ordinary React components.
- Validate external JSON with parseDashboardSpec before rendering. Define both catalog props and the matching implementation for new component types. Do not use arbitrary HTML, eval or generated JSX as a substitute for the catalog.
- Keep the catalog independent of Node APIs so the local service can use its prompt and schema. JSON UI actions must call explicitly implemented handlers; Runner validation and task permissions remain authoritative.
- Use the project API for persisted configuration and execution. `rawstep.config.json` is shared with the CLI; its schema types come from `@rawstep/project/config`, and only dashboard-only experiment and request types live in src/shared/config.ts. Never present automated fixture responses as real model inference or simulated speech as native screenreader evidence. Keep frontend drafts separate from file revisions and preserve edits on a save conflict.
- Run npm run dashboard:build and npm run typecheck after changes. For catalog changes, run corepack pnpm exec vitest run tests/dashboard-catalog.test.ts. Verify interactive changes in a browser.
- Add source components with pnpm --filter @rawstep/dashboard exec shadcn add <component>. Use the pinned CLI in this workspace. Do not regenerate the existing monorepo with shadcn init --monorepo.
