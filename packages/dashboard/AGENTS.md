# Dashboard development

This workspace owns the local Rawstep dashboard. Use pnpm 10.12.1 from the root packageManager field. The application uses a local Node API, project files and the existing Runner. See docs/dashboard-plan.ko.md for the full requirements and remaining verification.

- Use shadcn/ui for controls and product components. Local components live in src/web/components/ui. Compose these primitives for domain components and keep the existing theme tokens, spacing, Geist font and Lucide icons consistent.
- Pages live in src/web/pages, domain components in src/web/components, and pure logic (completion-check editor mapping, finding text, step dots) in src/web/lib with unit tests. All strings go through react-i18next (src/web/i18n/locales/ko). Use plain Korean terms: 행동 수, 가장 빨랐던 실행, 살펴볼 지점. Show facts, never AI-written conclusions; Runner validation and task permissions remain authoritative.
- Keep the dashboard accessible: real buttons and links, labelled fields, one tab stop with arrow keys for the dot timeline, visible focus, and a polite throttled live region for live runs.
- Use the project API for persisted configuration and execution. `rawstep.config.json` is shared with the CLI; its schema types come from `@rawstep/project/config`, and only dashboard-only experiment and request types live in src/shared/config.ts. Never present automated fixture responses as real model inference or simulated speech as native screenreader evidence. Keep frontend drafts separate from file revisions and preserve edits on a save conflict.
- Run npm run dashboard:build and npm run typecheck after changes. For dashboard logic, run corepack pnpm exec vitest run tests/dashboard-*.test.ts. Verify interactive changes in a browser.
- Add source components with pnpm --filter @rawstep/dashboard exec shadcn add <component>. Use the pinned CLI in this workspace. Do not regenerate the existing monorepo with shadcn init --monorepo.
