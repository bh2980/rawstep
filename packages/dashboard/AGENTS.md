# Dashboard development rules

This file is for anyone changing `packages/dashboard`, people and coding agents alike. It lists the rules to follow. How the code is laid out and what the API offers is in the [README](./README.md). The look, wording and layout principles are in [design-language.ko.md](./design-language.ko.md); read that before changing a screen.

## Setup

- Use pnpm 10.12.1 from the root `packageManager` field (`corepack pnpm ...`).
- Work from the repository root. Build the other workspaces first (`npm run build`); the dashboard imports them through their `dist`.
- Develop the UI with `npm run dashboard:dev` (API on 4318, Vite on 5173). Set `RAWSTEP_DASHBOARD_PROJECT` to edit a project other than the repository root.

## Before you finish

- Run `npm run dashboard:build` and `npm run typecheck`.
- For logic changes, run `corepack pnpm exec vitest run tests/dashboard-*.test.ts`. The dashboard's pure logic is tested from the root `tests/`.
- Check an interactive change in a real browser, with the keyboard as well as the mouse. A passing build does not show that a dialog traps focus or that a timeline moves with the arrow keys.

## Components

- Use shadcn/ui for controls and product components. The local sources are in `src/web/components/ui`. Compose these primitives for domain components. Keep the existing theme tokens in `styles.css`, the spacing scale, the Geist font and Lucide icons.
- Add a component with the pinned CLI in this workspace: `corepack pnpm --filter @rawstep/dashboard exec shadcn add <component>`. Do not run `shadcn init --monorepo` or regenerate the setup.
- Where things go: pages in `src/web/pages` (one per route), domain components in `src/web/components`, pure logic in `src/web/lib` with a unit test, hooks in `src/web/hooks`.
- The route lives in the URL (`?view=`, `?task=&tab=`, `?task=&run=&step=`, `?task=new`). A new screen gets a URL, and reload and the back button must restore it.

## Language

- The dashboard is in Korean and English. Every visible string goes through react-i18next and exists in both `src/web/i18n/locales/ko` and `src/web/i18n/locales/en`. Do not write user-facing text, in any language, in a component. Each English file is typed as its Korean file, so a key missing in either fails typecheck; `tests/dashboard-i18n.test.ts` also checks keys and placeholders.
- The language follows the browser (any `ko*` in `navigator.languages` is Korean, anything else English) until the person picks one with the switch in the top bar; the choice is kept in `localStorage`. `<html lang>` follows it. Dates and relative times use the language shown (`currentLanguage()`), never a fixed locale.
- Counts in English: a key that takes `{{count}}` may have a `<key>_one` singular next to it in the English file. Korean has none.
- The server sends message codes with their values, never sentences (`src/shared/messages.ts`); the web app words them with `serverText()`. A new server message adds a code there and its text to `serverMessages` in both languages. Text the server writes to the terminal is English, like the CLI.
- Write plain Korean and plain, short English, and keep one word for one thing. Use the words the screens already use: 행동 수 (moves), 가장 빨랐던 실행 (the fastest run), 살펴볼 지점 (places worth a look). English uses the CLI's and the docs' terms: reached the goal, gave up, said it was done, but the goal was not reached, not measured, run profile, connection, planner, plan file, way of finding things, item by item. The Settings sections are named as the CLI points to them: Settings › AI connections, Settings › Run profiles. Search the locale files before you add a new term.
- Labels name what the person sees, not an internal field name.

## Facts, not conclusions

- Show what happened: counts, steps, what was heard, where a run slowed down. A hint points at a place to look; it is not a verdict. Reaching the goal is one fact among others, not a pass or a fail.
- Text written by an LLM (LLM commentary, LLM 해설) is shown only as a labelled hypothesis, below the evidence, with the steps it cites, and it never changes a run's result or its hints. Do not add an AI-written conclusion anywhere else.
- Never present a scripted or fixture response as real model inference. Never present simulated speech as native screen reader output: a simulation run is always labelled as one.
- Keep batches of runs apart. Results of different batches are not added together, because the page may have changed between them.

## Accessibility

The dashboard is a tool for accessibility work, so it has to be usable with a keyboard and a screen reader.

- Use real buttons and links, not clickable `div`s. Every field has a label. Every icon-only control has an accessible name.
- Focus is always visible. A dialog or sheet moves focus in and returns it on close.
- The dot timeline of a run is one tab stop; arrow keys move between steps.
- A live run is announced through a polite live region that is throttled (`useThrottledMessage`), so a fast run does not bury the reader in speech.
- Do not carry meaning by colour alone. Every status glyph also has a text name.
- Check both colour schemes.

## Data and API

- Persisted configuration and execution go through the project API. `rawstep.config.json` is shared with the CLI and `runTask`. Its schema types come from `@rawstep/project/config`. Only dashboard-only experiment and request types live in `src/shared/config.ts`.
- The Runner's validation and the task's permissions stay authoritative. The UI may explain a refusal early; it does not decide.
- Keep frontend drafts apart from file revisions. On a save conflict (409), keep the person's edits and show the difference.
- API keys never go into `rawstep.config.json`, a response body or a log. The UI learns only whether a key is configured. A key is revealed only through `POST /api/credentials/reveal`, on the person's request.
- Do not add polling. The UI refetches on the `changed` event and follows live runs through `run-event`.
- Anything that starts a browser or calls a provider runs only when the person asks for it (a check button, a run, a suggestion).
- The server listens on loopback only and checks `Host` and `Origin`. Do not loosen either.
- Page text, element names and model output are untrusted. Render them as text, never as HTML.
