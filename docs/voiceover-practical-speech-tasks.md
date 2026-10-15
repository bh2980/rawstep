# Practical Rawstep speech tasks — 2026-10-16

Three new whole keyboard tasks test the current implementation rather than estimate a completion date: help-article
search, publication preference save/restore/resave, and a supply basket whose decrement button disables at quantity
one. The clean b94ed5b model, actual formatter inputs, complete action histories, task oracles and evaluator were
fixed before either Native profile. Both profiles finished before inspection. All 48 actions per browser were
observed and all three starts aligned. These are small synthetic fixed scripts, not random websites or an agent
decision-quality benchmark. They are now inspected regression evidence.

## First results, unchanged

| Metric | Safari | Chrome |
| --- | ---: | ---: |
| Planned / observed actions | 48 / 48 | 48 / 48 |
| Normally comparable speech windows | 29 | 35 |
| Main Speech Exact | 29/29 | 35/35 |
| Literal Full Speech Exact | 29/29 | 35/35 |
| Main and Full matches / all planned | 29/48 (60.4%) | 35/48 (72.9%) |
| Declared navigation actions with matched visible atomic target | 20/24 | 24/24 |
| Atomic target mismatches / unmeasured navigation actions | 1 / 3 | 0 / 0 |
| State-field matches / planned field slots | 130/145 | 140/145 |
| State fields unmeasured / not applicable because both controls absent | 10 / 5 | 0 / 5 |
| Actual state transitions matched / planned transitions | 27/31 | 31/31 |
| Control-presence matches / planned checks | 105/115 | 115/115 |
| Keyboard-focus matches / mismatches / unmeasured | 40 / 3 / 5 | 48 / 0 / 0 |
| Whole task success | 2/3 | 3/3 |

State slots are repeated measurements, not 145 distinct transitions. There were no observed state-field or transition
mismatches; the missing observations remain missing. Hidden result-button disabled fields are explicitly
not-applicable, not successful comparisons. Keyboard focus is a separate channel. Visible atomic reading targets
are independently joined to AX, without speech or keyboard-focus inference; they are not a direct logical cursor
API or full Navigation Accuracy. The navigation denominator was fixed at 24 Tab/Shift+Tab movements, while the other
24 stationary/editing/activation actions retain their own target-observation counts.

The [losslessly compressed first fixture](../tests/fixtures/voiceover-evidence/native-practical-speech-tasks-2026-10-16.json.gz)
contains the original HTML, commands, predictions, diagnostic events, Native/before AX snapshots and all first
outcomes. Its uncompressed byte hash and archive hash are in
[the export manifest](../packages/vo-corpus/test/practical-speech-first-export.json). Raw source records remain local
and unchanged. Compression changes storage only; it does not remove unknown rows or alter the first scores.

## Concrete blockers and root causes

1. **Safari basket focus path diverges after self-disable.** At step 5, Space reduces quantity to one and disables the
   focused decrement button; both sides still identify that reading object. At step 6, Safari Tab reaches the initial
   marker while Chromium reaches order confirmation. The following Space consequently acts on different controls.
   Later Shift+Tab reaches browser chrome, followed by Tab Overview and five raw AX capture errors. The original
   speech evaluator reports four AX-error issues because its no-single-input branch does not also flag that error;
   the acquisition audit counts all five. The original scores and issue counts remain unchanged. Treat the downstream
   failures as a cascade from the first divergence, not separate wording rules. The final Safari basket state is
   unmeasured, so the third task is not counted as success. Chrome completes the basket and both profiles complete
   search and settings. This is a browser/Rawstep interaction difference, not evidence to change the speech formatter.
2. **Self-disabled-button fallback speech is wrong.** Chrome's two disable transitions are silent in Native, while
   the adapter emits a dimmed-button/table summary after the guarded activation API returns unsupported. Safari's
   first equivalent transition is also silent. These windows have two diagnostic events and were not accepted as
   ordinary speech comparisons. The [separate enabled/disabled × bare/named-form contrast and reserved transfer](./voiceover-button-disable-speech.md)
   now support a bounded plain-button silence rule. The first scores here remain unchanged; arbitrary disabled-control
   receipts are still not established.
3. **Safari exposes a different text-field role.** The same explicit `input[type=text]#query` is an AXSearchField in
   Safari and an ordinary AXTextField in Chrome. Safari says “search text field”; the Chromium-derived model says
   “edit text”. This is an input-projection difference to investigate with contrasts, not a generic wording synonym.
4. **Focus/selection speech needs separate Native evidence.** On Shift+Tab back to the query, both Native AX and DOM
   report selection 0..3. Chrome says contents selected. Safari says insertion at end of text. Equal keyboard
   selection does not prove equal VoiceOver insertion announcements. Do not force the selected-range state to fit
   the Safari speech; previous editing history, role and browser need controlled contrasts.
5. **Editing, Enter and asynchronous receipts are not ordinary object reads.** Seven windows per profile have no
   single formatter diagnostic; two have multiple events. Editing, caret and live outputs retain approximation
   provenance. Some ordinary echoes match, but first-character windows also include extra hints/repetitions. The
   bounded receipt windows do not establish their causal attribution or a completion/queue model. They remain
   unmeasured for speech fidelity even when the actual task succeeds.

## Independent observation, not a second movement engine

The existing cached `getReadingCursorObservation()` diagnostic is now available after a completed `observe()`.
It returns only a copied target/window record, does not move, does not add a policy observation and clears on close.
The evaluator opens its own CDP AX inventory and joins by renderer identity. It rejects stale windows, source role/name
projection differences, aliases, missing identities and structural/end boundaries. Native toggle-button subroles
remain buttons independently of their pressed value. Neither side assigns a target from an utterance or AX focus.

Initial model-only predictions were retained. Adding the cached/CDP observer changes none of the 96 predicted receipt
sequences. The clean installed package passes API/type/CLI/examples, and its JS matches the pre-Native frozen model.

## Replay and next checks

```sh
npm run build
npm test -- tests/mock-voiceover-practical-speech.test.ts
cd packages/vo-corpus
node --import tsx --test test/practical-speech-evaluation.test.ts test/reading-target.test.ts
```

Run these commands from the repository checkout; Native regression fixtures are repository test assets. These
commands verify preserved observations and current pure-API regressions; they do not rerun Native or establish
new independent accuracy. The currently input-verified reading/state-event subset is usable for bounded assertions.
Text-entry fidelity, arbitrary live-event streams and Safari/Chromium focus-path equivalence remain explicit gaps.
Do not report 100% from the conditional speech column as whole-library accuracy or a completed 90% target.

Before inspecting these Native outcomes, two further whole tasks were reserved: selecting/replacing a prefilled code,
and a second query whose result name changes. HTML, complete histories and final oracles are fixed with no declared
template/site/contrast or whole-sequence collision. They are reserved transfer checks for later corrections, not
additional successes already collected.
