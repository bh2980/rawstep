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
