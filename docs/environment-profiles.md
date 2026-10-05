# Reproducible environments and matched-task comparisons

A run profile's `environment` field (in `rawstep.config.json`, edited in the dashboard) is either a built-in profile name or a profile object; `npx rawstep run <task> --profile <id|name>` selects a run profile, overriding the task's own profile. Task JSON may also contain a `profile` object. Profiles record requested settings, observed settings, application mechanism, browser version and unsupported capabilities. Unknown fields and invalid ranges fail before execution.

Built-ins: `default`, `narrow` (320×800), `zoom-200`, `zoom-400`, `text-200`, `spacing`, `reflow-text` (320×800 plus 200% text), `forced-colors`, `contrast`, `dark`, `reduced-motion`.

## Mechanisms are different

| Setting | Implementation and proof | Native equivalence |
|---|---|---|
| Viewport | New isolated Chromium viewport; actual dimensions recorded | Responsive layout only |
| Text scale | Snapshot all initial computed font sizes, multiply and apply page user styles; recheck actual computed sizes | Not browser text-only zoom or OS magnification |
| Text spacing | User-style line/letter/word/paragraph spacing; computed body/paragraph values checked | Page experiment, not OS setting |
| Forced colors/contrast/color scheme/motion | Browser media emulation plus `matchMedia` verification and actual screenshots | Not Windows High Contrast, macOS settings or a native magnifier |
| Browser zoom | `createChromiumTabZoomController` uses actual Chromium extension `tabs.setZoom/getZoom` with exact browser context and tab URL checks; secondary DPR/viewport/pinch checks | Genuine browser zoom only when that paired controller is available |
| Native magnifier/high contrast | Explicit capability entries | Unsupported by the browser adapter |
| AT name/version/configuration | Compared with backend handshake if explicitly requested | Missing/mismatched evidence does not pass |

A viewport change, CSS zoom, device-scale override or CDP pinch is never substituted for browser zoom. Arbitrary callbacks returning a zoom factor are not accepted as proof. On this cloud headless-shell runtime no paired browser-extension controller is available: `zoom-200`/`zoom-400` produce an `unsupported-profile` outcome before model calls. The real extension-based path is implemented but not live-validated here. A supported custom browser factory must prepare a trusted extension page and exact task tab in the same isolated browser context, then use `createChromiumTabZoomController(extensionPage, tabId)` as `nativeZoom`. The package does not silently install extensions or change a user's browser.

`requireApplied` defaults to true. Unsupported or mismatched requested settings stop the run. Setting it false permits a diagnostic attempt, but the environment is still marked unsupported and its success does not count as a valid matched-environment result.

Style probes recheck actual initial nodes rather than a cached success flag. Newly inserted unprofiled nodes cause a mismatch for text-scale/spacing profiles. This is conservative: the tool stops rather than claim that dynamic content was enlarged. Navigations install the styles again. Native OS changes and extension installation are outside the default adapter.

## Independent keyboard and layout evidence

Profile runs collect `browser.accessibility-diagnostic` events separately from screenshots and speech. They never become model inputs or policy history. Diagnostics record stable element identities, focus order/rectangles, style-based indicator hints, sampled-center occlusion, modal focus, horizontal overflow, possible text clipping/control overlap, and invalid/alert-state counts. Reports connect modal opening/closing, Escape, focus restoration and validation-state changes to their before/after events.

These checks are deliberately limited: outline absence does not mean a focus indicator is absent; overlap can be intentional; horizontal scrolling alone is not a failure; error text may be communicated without moving focus. Inspection is bounded to1000 visible elements,300 text leaves and150 controls. Frames/closed shadow roots are not covered. Do not treat any heuristic as a WCAG verdict. Actual fixture checks include skip-link activation, forward/reverse focus, dialog Escape/restoration and form error recovery.

After named text entry, stored diagnostics, profile-check payloads and profile-error payloads are omitted under the existing input-taint rule. Task and profile metadata also follows named-input redaction. An affected profile uses a generated storage directory, and an affected external evidence URL is withheld with an explicit source-redacted marker instead of rendered as a link. The active model continues to receive its permitted modality; diagnostic DOM state is not added to it.

## Comparing environments

Run the same task under each profile and compare the hints. Define one run profile per environment in `rawstep.config.json` (for example `default`, `reflow-text` and `forced-colors`), then:

```sh
npx rawstep run checkout --profile default --repeat 3
npx rawstep run checkout --profile reflow-text --repeat 3
npx rawstep run checkout --profile forced-colors --repeat 3
```

The dashboard's experiment queue runs tasks × models × prompts × profiles in one batch and keeps the history under `.rawstep/experiments/`. Every run uses the same resolved task, independent verifier specification and named inputs, with a separate fresh browser/runner. Native machine backends need an explicit AT Driver endpoint (`machine.atEndpoint`); Rawstep does not guess native window associations. Different model trajectories imply different coverage: a worse action count or failed task is not automatically an environment-caused defect.

Outcomes distinguish task completion, model failure (only with recorded model provenance), runtime errors, unsupported environments and inconclusive outcomes. A model's `success`, `stuck` and `uncertain` stops remain separate from an exploration guard. Independent verification is required for success; uncertainty with unmet verification yields `inconclusive`.

See `docs/native-orca.md` for actual native adapter requirements, and the evidence coverage API for source-backed wording patterns and explicitly missing coverage.

## Read-only public exploration

Task navigation can include `readOnly: true` and `denyUrlIncludes: ["/login", "action=edit", ...]`. The browser blocks mutating HTTP methods before transmission, blocks native/scripted form submissions, and excludes specified URLs from requests and History/navigation paths. Harmless public GET search is supported. These guards are in addition to origin/prefix navigation limits and do not bypass login,403,bot checks or service restrictions. An unusual service that mutates state through GET is outside this mechanical guarantee; choose verified public read-only tasks and fresh unauthenticated contexts.
