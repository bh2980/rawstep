# Attribution and license evidence

The observation data was extracted from Accessibility Supported / a11ysupport.io,
originally created by Michael Fairchild and maintained by Accessibility Supported
contributors: https://github.com/accessibilitysupported/a11ysupport.io

Pinned revision: `6730ad42e83dd780f63555ab3f14f1c26ea0fae5`
Collected: 2026-10-01

The public site's footer explicitly offers its **text and data** under Creative
Commons Attribution 4.0 International:
https://creativecommons.org/licenses/by/4.0/

Pinned notice: https://github.com/accessibilitysupported/a11ysupport.io/blob/6730ad42e83dd780f63555ab3f14f1c26ea0fae5/client/layout/SiteFooter.tsx

There is a second, inconsistent notice: the repository's LICENSE is
GPL-3.0-or-later for the program, and the FAQ also describes its data and software
as GPL 3.0. These notices are preserved here, rather than silently treating the
entire repository as MIT or unambiguously CC-only:
- https://github.com/accessibilitysupported/a11ysupport.io/blob/6730ad42e83dd780f63555ab3f14f1c26ea0fae5/LICENSE
- https://github.com/accessibilitysupported/a11ysupport.io/blob/6730ad42e83dd780f63555ab3f14f1c26ea0fae5/FAQ.md#who-runs-this
- https://www.gnu.org/licenses/gpl-3.0.html

This extracted corpus relies on the explicit text/data grant in the footer.
Attribution, source links, and modifications are retained. It contains observation
data, not copied application implementation. The separate upstream checkout is
research material under its original notices; do not copy its program or HTML
implementation into an MIT project under an assumed MIT license.

Changes made in this corpus: only VoiceOver/macOS command records were selected;
metadata fields were joined and renamed; source IDs, URLs, hashes, caveats and
quality classifications were added; selected outer quote marks were removed in a
separate field while the original output was preserved. The 13 formatter inputs
are manually authored semantic abstractions from the tests, not native AX dumps.
No original output spelling, capitalization or punctuation was corrected.

No endorsement by Apple, Accessibility Supported, its maintainers, or W3C is
claimed. Current VoiceOver behavior and accuracy are not warranted.
