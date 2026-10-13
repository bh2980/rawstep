# vo-corpus

Collects real VoiceOver speech through AT Driver, to calibrate Rawstep's VoiceOver simulator against it. macOS only.

This package lives on a collection branch and is not merged into master. It will move to its own repository with
`git subtree split --prefix=packages/vo-corpus`, so keep it self-contained:

- Import Rawstep only through its public exports (`rawstep/at-driver`, `rawstep/mock-voiceover`), never its internal files
- Collected data goes to `data/` and stays out of git. Copy small, versioned snapshots into Rawstep's `tests/fixtures/` for regression tests
- Rawstep's build, typecheck and tests do not include this package

## Smoke run

Checks the whole chain once: AT Driver server, VoiceOver, browser and capture, including the rotor `headings.list` routine
that has not run on a real VoiceOver yet.

1. Build Rawstep from the repository root (`corepack pnpm build`); this package imports its `dist`
2. Start the [Bocoup macOS AT Driver server](https://github.com/bocoup/macos-at-driver-server) (default `ws://localhost:4382/session`)
3. Turn VoiceOver on (Command+F5)
4. Run, then leave the Mac alone until it finishes. VoiceOver keys go to whichever app is frontmost

```sh
corepack pnpm --filter vo-corpus smoke
corepack pnpm --filter vo-corpus smoke --browser chrome
```

Options: `--url` (AT Driver endpoint), `--browser safari|chrome`, `--out` (default `data/runs`), `--load-wait` (ms to wait after opening the page).

Each run writes `data/runs/<time>/meta.json` (AT Driver session, macOS/browser versions, VoiceOver settings, steps) and
`records.jsonl` (one AT Driver observation per step, with every output's receipt time and the frontmost app at the end of the step).
The console prints the speech per step and flags a step when the browser was not frontmost.

Speech is attributed to a step by time only, as in Rawstep's AT Driver backend: late speech can land in the next step.

## AX tree dump

VoiceOver speaks from the macOS accessibility (AX) tree of the browser's web area, so each speech record needs that tree next to it. `axdump/axdump.swift` prints the frontmost window's `AXWebArea` as JSON (role, subrole, title, description, value, DOM id/classes, state and ARIA attributes, children; only present attributes), plus app, pid, window title, timestamp and `focusedPath` (child indices to the `AXFocusedUIElement`, null when focus is outside the web area).

```sh
swift axdump/axdump.swift --app Safari --max-depth 60 --max-nodes 5000
```

```ts
import { dumpAxTree } from "./src/axdump.js"; // compiles to data/bin/axdump on first use or when the source changes
const tree = await dumpAxTree("Safari");
```

It only reads AX attributes: no activation, keys or clicks, so VoiceOver and focus are undisturbed. Depth or node caps set `truncated` and `childrenTruncated` on the cut nodes.
The terminal app that runs it needs Accessibility permission (System Settings > Privacy & Security); without it the dumper exits 2. Chrome exposes its web tree only while an assistive technology such as VoiceOver is on.

## Case sets

A case set is a directory of small pages plus `cases.json` (types in `src/cases.ts`): each case names a page and the chords to press on it. Every page is a "Before marker" button, the element variant, an "After marker" button; names are unique on the page.

```sh
corepack pnpm --filter vo-corpus generate                 # writes data/cases/elements-v1/{pages/*.html,cases.json}
corepack pnpm --filter vo-corpus generate --out some/dir
```

`elements-v1` (`src/generate/elements.ts`) has one table row per HTML/ARIA element variant (role × state × name source, about 220 pages). Each page is shared by its cases, id `<variant>.<command>`, with the command in `axes.command`:

- `next`: VO+Right through the whole variant (items + 2 presses), then VO+Left. Every variant
- `tab`: Tab, Shift+Tab. Only variants whose target takes keyboard focus
- `activate`: VO+Right, VO+Space. Only buttons, checkboxes, radios, switches, summary, tabs, and links to `#id` on the same page

To add a variant, add a row to the table; `{N}` in the snippet becomes the variant's unique name words.
