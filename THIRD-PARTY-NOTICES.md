# Third-party notices

Rawstep's own code is under the [MIT license](./LICENSE). The screen reader evidence bundled with it (the corpus summary behind `rawstep/evidence` and the simulator's wording references) comes from the third-party sources below and keeps their notices. This project does not declare all upstream content MIT.

## Accessibility Supported

The observation data was extracted from [Accessibility Supported](https://github.com/accessibilitysupported/a11ysupport.io) (a11ysupport.io), created by Michael Fairchild and maintained by Accessibility Supported contributors.

- Pinned revision: `6730ad42e83dd780f63555ab3f14f1c26ea0fae5`
- Collected: 2026-10-01

The public site's footer offers its **text and data** under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) ([pinned notice](https://github.com/accessibilitysupported/a11ysupport.io/blob/6730ad42e83dd780f63555ab3f14f1c26ea0fae5/client/layout/SiteFooter.tsx)).

There is a second, inconsistent notice: the repository's LICENSE is GPL-3.0-or-later for the program, and the FAQ also describes its data and software as GPL 3.0. Both are recorded here rather than treating the repository as MIT or as CC-only:

- https://github.com/accessibilitysupported/a11ysupport.io/blob/6730ad42e83dd780f63555ab3f14f1c26ea0fae5/LICENSE
- https://github.com/accessibilitysupported/a11ysupport.io/blob/6730ad42e83dd780f63555ab3f14f1c26ea0fae5/FAQ.md#who-runs-this
- https://www.gnu.org/licenses/gpl-3.0.html

The extracted corpus relies on the explicit text/data grant in the footer. It contains observation data, not copied application code. The upstream program and HTML are not copied into this project.

Changes made by this project: VoiceOver and NVDA command records were selected; metadata fields were joined and renamed; source IDs, URLs, hashes, caveats and quality classifications were added; selected outer quote marks were removed in a separate field while the original output was kept. The formatter inputs in the regression cases are hand-written semantic abstractions, not native accessibility tree dumps. Derived templates and train/heldout grouping are project modifications, not new native observations. No original output spelling, capitalization or punctuation was corrected.

## ARIA-AT

ARIA-AT data and copied reference material remain attributed to W3C and ARIA-AT contributors under the [W3C Document License](https://www.w3.org/copyright/document-license-2023/), with report status kept in the evidence archive. The compact catalog includes source-derived coverage metadata; it does not embed the full reference pages.

## No endorsement

No endorsement by Apple, NV Access, Accessibility Supported, its maintainers or W3C is claimed. Current VoiceOver and NVDA behaviour and the accuracy of the reported results are not warranted.
