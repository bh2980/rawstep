# Versioned screen reader evidence coverage

`rawstep/evidence` provides a read-only corpus summary, explicit coverage gaps,
strict command-aware wording references and source-vs-simulation regressions.
It does not launch NVDA or turn reported observations into native-conformance
results. The existing `rawstep/mock-voiceover` runtime remains a Chromium-based
simulation; this module adds no pretend native NVDA backend.

## Collected data and provenance

The current canonical corpus has **2,914 third-party reported result records**:

- VoiceOver: 1,290, comprising 548 Accessibility Supported command records and
  742 ARIA-AT scenario records
- NVDA: 1,624 Accessibility Supported command records across 377 test/browser
  sets: Chrome 530, Edge 523, Firefox 557, IE 14

The NVDA date range is 2018-07-21 through 2026-05-03. This is not a count of unique
utterances or independent test repetitions. All normalized NVDA records were
compared with the exact pinned source JSON and their original output retained.
The supplemental dataset is delivered separately; the npm module contains a
compact grouped catalog and 25 regression cases, not all copied source HTML.

Source commit: `6730ad42e83dd780f63555ab3f14f1c26ea0fae5` of
[Accessibility Supported](https://github.com/accessibilitysupported/a11ysupport.io).
Each normalized record retains the original command/output, source pointer/hash,
version/date, declared setup, unknown settings and quality flags. Test setup and
intended `after` targets are **not captured native focus/cursor telemetry**.
Fields that were not measured remain null. Original data is read using `git show`
for the pinned commit, so uncommitted changes in a research clone are not quietly
assigned the pinned source identity.

NVDA classification results: 1,206 quoted reported outputs, 173 unclassified
outputs, 179 behavioral descriptions, 38 generalized templates, 16 conditional
outputs and 12 reports of no output. These classifications are curation aids,
not automatic endorsements. Some quoted outputs carry additional flags:

- Four aria-expanded rows contradict the selector's declared state; raw source
  is retained, but these rows are excluded from calibrated rules
- Multi-control reading units remain aggregate output, not single-control speech
- Potentially incomplete textarea values are not silently repaired
- VoiceOver ARIA-AT inherited-result, untestable, no-output, vendor-review and
  harness-contamination flags remain in the separate corpus

## API

```ts
import {
  summarizeEvidenceCoverage, compareEvidenceFixtures, selectEvidenceCases,
  formatEvidenceSpeech,
} from 'rawstep/evidence';

const coverage = summarizeEvidenceCoverage({
  profileId: 'nvda-chrome', atVersion: '2025.3.1', browserVersion: '143',
});
// Global totals are separate from compatibleRecords and regressionCaseCount.
// missingCoverage identifies unimplemented state/action cells.
const comparisons = compareEvidenceFixtures({ profileId: 'nvda-chrome' });
const fixture = selectEvidenceCases({ profileId: 'nvda-chrome' })[0]!;
const result = formatEvidenceSpeech({
  profileId: fixture.profileId,
  command: fixture.command,
  node: fixture.node,
  elementKind: fixture.elementKind,
  context: fixture.context,
});
// matched means an evidence-bounded wording rule matched, not native parity.
// Unsupported inputs return { status: 'unsupported', speech: null, reason, ... }.
```

Summary filters accept AT families (`voiceover`, `voiceover-safari`, `nvda`),
browser families (`nvda-chrome`, `nvda-edge`, `nvda-firefox`), known VoiceOver/mock
backend-name aliases, and exact calibrated profile IDs. `atVersion`,
`browserVersion` and optional `osVersion` further restrict the filter. Unknown or
conflicting profiles return `no-compatible-evidence`; no nearest-version or
all-data fallback is used. A mock formatter's version `2` is not VoiceOver's OS/AT
version and should not be supplied as a native version filter.

Formatting requires an **exact calibrated profile**, command, element type,
explicit semantic flags and isolated English-control context. That context is a
simulation premise, not an observed source setting. Unknown reading units,
group context, descriptions, additional states, protected fields, filled
single-line fields, wrong element types and unmodeled actions return unsupported.
Names are parameterized; only the existing textarea rule also parameterizes its
value. Full source versions and assumptions remain attached to every case.

## Calibrated cases and honest gaps

- 13 existing VoiceOver navigation-wording cases retain their recorded versions
- 12 NVDA cases: two plain input-button cases (2025.3.1 / Chrome 143), six toggle
  cases (2025.1.1 / Chrome 137), two simple-link and two empty-text-field cases
  (2021.1 / Chrome 92)

NVDA next-item and Tab order are distinct. For example, the observed plain button
is role/name under next-item and name/role under Tab. A mixed toggle has the
reported `not pressed` plus `half checked` wording; the tab transcript's hyphen is
retained. Space activation, menu behavior, grouping, caret/selection, password
output, radio position, live-region timing and other cells are not inferred from
these cases.

The coverage backlog is a finite list of state/action cells spanning navigation,
basic controls, form editing, composite controls and dynamic responses. Missing
cells remain in the report even when all 25 chosen wording tests pass. A pass
cannot establish reading order, cursor movement, focus, application behavior,
actual OS settings, native speech output or accessibility conformance.

Comparisons ignore only case, whitespace, commas and full stops. They retain
all state/role/value words, hyphens and order. The reference formatter computes
wording from semantic input; it does not return the expected transcript. Tests
alter expected state words and names, exercise unsupported combinations and
mutate returned fixtures to ensure false positives and data corruption are not
silently accepted.

## Reproduce the normalization

```sh
python scripts/collect-screenreader-evidence.py \
  --source /path/to/pinned/a11ysupport-checkout --at nvda --out /path/to/corpus/nvda
python scripts/collect-screenreader-evidence.py \
  --source /path/to/pinned/a11ysupport-checkout --at vo_macos \
  --out /path/to/corpus/a11ysupport/normalized-v2
python scripts/build-evidence-catalog.py --evidence-root /path/to/corpus --repo .
```

The catalog builder also reads the retained ARIA-AT dataset and earlier curated
VoiceOver fixtures in that corpus. These are source data inputs, not native test
runs or requirements fetched at package import. Model/AT software is not installed
or executed by these scripts.

## Attribution

Accessibility Supported was created by Michael Fairchild and its contributors.
Its explicit text/data [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
notice appears in the pinned
[site footer](https://github.com/accessibilitysupported/a11ysupport.io/blob/6730ad42e83dd780f63555ab3f14f1c26ea0fae5/client/layout/SiteFooter.tsx).
The repository LICENSE and FAQ also contain GPL notices; both are retained in
`tests/fixtures/screenreader-evidence/THIRD-PARTY-NOTICES.md` and the corpus. This
project does not declare all upstream content MIT. Data selection, classification,
field joining and semantic abstractions are modifications made by this project.

ARIA-AT data and copied reference material remain attributed to W3C and ARIA-AT
contributors, with the [W3C Document License](https://www.w3.org/copyright/document-license-2023/)
and report status retained in the evidence archive. No endorsement by Apple,
NV Access, Accessibility Supported or W3C is implied.

## Whole-corpus template analysis and heldout evaluation

The supplementary pipeline now processes all 2,914 records, without silently
turning unknown input state into known state. Static fixture parsing yielded563
unambiguous navigation targets. It never runs upstream scripts or downloads page
resources. ARIA-AT sequence-to-target alignment, ambiguous selectors, dynamic
state, ancestor context, descriptions, templates and other unsupported inputs
remain explicit exclusions in the denominator.

The original filename-family split is retained:230 heldout records,0 supported
predictions. Accuracy among predictions is **undefined**, not0% or100%.
After inspecting that outcome, a separate exploratory analysis merged near-clone
fixtures using output-independent semantic signatures. It keeps browser/version
siblings together and forces all previously hand-calibrated families to training.
Templates and allowed version tuples are fitted only on the training side.

- Refined exploratory fixed holdout:509 total,4 predictions,4 exact wording
  matches,505 unsupported. Coverage is0.79%;4/4 is far too narrow for a high
  accuracy claim
- Exploratory leave-one-unseen-family-out:2,606 evaluated records,18 predictions,
  8 exact matches and10 mismatches;2,588 unsupported. Conditional exact agreement
  is44.4% and total coverage0.69%. The308 previously hand-calibrated records are
  explicitly excluded from this unseen-family cohort
- The original strict result is not replaced. These later designs are labeled
  exploratory, not an untouched confirmatory test. Token-bag agreement is only
  an order-insensitive lexical proxy, not screen-reader semantic correctness

Only8 multi-family-correlated plain-button templates survived the final bounded
training analysis, across the recorded VO/Safari and NVDA browser/version tuples.
There is no basis here for universal high-accuracy VoiceOver/NVDA emulation.
The point of the module is to make the usable evidence and the gaps executable.

### Abstaining corpus mock

`createCorpusMockBackend` and `runCorpusMockTask` connect learned wording to the
existing real-Chromium mock mechanics. They operate on live sanitized AX names
and real Tab actions. Every output remains simulation and records its source rule,
reference environment and command. They are **not native AT backends**.

```ts
import { runCorpusMockTask } from 'rawstep/evidence';
await runCorpusMockTask(task, {
  policy, outDir,
  corpus: {
    profile: {
      at: 'nvda', browser: 'chrome', atVersion: '2025.3.1',
      browserVersion: '143', osVersion: 'Windows 11 version 21H2',
    },
    sourceFixturePath: 'data/tests/html/html/buttons.html',
  },
});
```

This opt-in backend is intentionally source-fixture-bounded. At present only
`next` and `Tab` navigation are exposed. Unsupported activation/text entry is
refused before dispatch. Unknown roles, extra AX states, ancestor groups, novel
fixture families, async changes and unknown version tuples abstain with
`UNSUPPORTED_CORPUS_PATTERN`; they do not fall back to plausible VoiceOver text.
The first isolated object uses an explicitly recorded initial-as-next-item wording
convention, not a claim that a native navigation command occurred.

The ordinary VoiceOver-inspired mock retains its earlier broader heuristic scope.
The strict corpus mock and the exploratory formatter are separate choices.
`formatCorpusSpeech({allowExploratoryGeneralization:true,...})` is an explicit
research opt-in; the deployed mock does not enable it. Use
`summarizeCorpusEvaluation()` and `listCorpusRules()` to inspect frozen results.

Reproduction, in order:

```sh
node scripts/extract-evidence-patterns.mjs --evidence-root CORPUS \
  --source PINNED_CHECKOUT --out CORPUS/pattern-analysis/features-family-v2.json
python scripts/evaluate-evidence-consensus.py --evidence-root CORPUS --repo .
python scripts/build-learned-evidence.py --evidence-root CORPUS --repo .
```

The original strict split and extractor snapshot are retained under
`pattern-analysis/strict-fixed-split/`. Full per-reader/role denominators,
unsupported reasons, raw expected output, predictions, rule IDs and family split
manifests remain in the corpus archive. No favorable-only subset or hidden test
transcript lookup is used by the deployed formatter.
