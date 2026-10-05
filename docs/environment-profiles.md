# Reproducible environments and matched-task comparisons

`rawstep profiles` lists built-in profiles. `--profile <name|file.json>` applies a profile to `run`, `mock-run` or `screenshot-run`. Task JSON may also contain a `profile` object. CLI selection overrides the task profile. Profiles record requested settings, observed settings, application mechanism, browser version and unsupported capabilities. Unknown fields and invalid ranges fail before execution.

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

`requireApplied` defaults to true. Unsupported or mismatched requested settings stop the run. Setting it false permits a diagnostic attempt, but matrix classification still marks the environment unsupported and does not count its success as a valid matched-environment result.

Style probes recheck actual initial nodes rather than a cached success flag. Newly inserted unprofiled nodes cause a mismatch for text-scale/spacing profiles. This is conservative: the tool stops rather than claim that dynamic content was enlarged. Navigations install the styles again. Native OS changes and extension installation are outside the default adapter.

## Independent keyboard and layout evidence

Profile runs collect `browser.accessibility-diagnostic` events separately from screenshots and speech. They never become model inputs or policy history. Diagnostics record stable element identities, focus order/rectangles, style-based indicator hints, sampled-center occlusion, modal focus, horizontal overflow, possible text clipping/control overlap, and invalid/alert-state counts. Matrix summaries connect modal opening/closing, Escape, focus restoration and validation-state changes to their before/after events.

These checks are deliberately limited: outline absence does not mean a focus indicator is absent; overlap can be intentional; horizontal scrolling alone is not a failure; error text may be communicated without moving focus. Inspection is bounded to1000 visible elements,300 text leaves and150 controls. Frames/closed shadow roots are not covered. Do not treat any heuristic as a WCAG verdict. Actual fixture checks include skip-link activation, forward/reverse focus, dialog Escape/restoration and form error recovery.

After named text entry, stored diagnostics, profile-check payloads and profile-error payloads are omitted under the existing input-taint rule. Matrix task/profile/human metadata also follows named-input redaction. An affected profile uses a generated storage directory, and an affected external evidence URL is withheld with an explicit source-redacted marker instead of rendered as a link. The active model continues to receive its permitted modality; diagnostic DOM state is not added to it.

## Matrix CLI

```sh
npm run rawstep -- matrix examples/profiles/task.json \
  --profiles default,reflow-text,forced-colors \
  --model-endpoint http://127.0.0.1:8767/choose --out runs/matrix-01
# A JSON array of names or profile objects:
npm run rawstep -- matrix examples/profiles/task.json \
  --profile-set examples/profiles/matrix.json --policy ./policy.mjs --out runs/matrix-02
```

Every row uses the same resolved task, independent verifier specification and named inputs, with a separate fresh browser/runner. The matrix requests a fresh policy instance per row; trusted custom modules remain responsible for external/shared state. Native matrices are available through `runEnvironmentMatrix` with explicit paired backend factories. The CLI supports screenshot and mock modes; it does not guess native window associations. Fixture scripts are permitted for regression testing and are labelled separately from actual model inference.

The manifest is written before execution and after each row. Signal cancellation stops later rows; setup factories have abort signals and time limits. Partial/error/unsupported rows remain visible. `matrix.html` links run reports, exact focus sequences, heuristic findings and deltas against the first profile. Different model trajectories imply different coverage: a worse action count or failed task is not automatically an environment-caused defect.

Categories distinguish task completion, suspected issues, model failure (only with recorded model provenance), runtime errors, unsupported environments and inconclusive outcomes. A model's `success`, `stuck` and `uncertain` stops remain separate from an exploration guard. Independent verification is required for success; uncertainty with unmet verification yields `inconclusive`.

## Real-user evidence

`--human-evidence file.json` imports an array of source-linked reviewer/user-test records with the exact task ID, optional matching profile ID, observed date, reviewer attribution, concise summary, explicit consent and `confirmed-defect`, `no-defect-observed` or `inconclusive` result. The example file is empty: no synthetic records are presented as user research.

The report clearly labels imported claims, links original evidence, and preserves their provenance separately from machine diagnostics. It does not simulate people, infer consent, or automatically certify the claim. Minimize personal data and use sources the intended readers can access. A machine task may pass while a reviewer-reported defect remains linked to it.

See `docs/native-orca.md` for actual native adapter requirements, and the evidence coverage API for source-backed wording patterns and explicitly missing coverage.

## Optional bounded stop hypotheses

`--diagnose-stop` on a screenshot run/matrix optionally calls the configured choice model once after a model `stuck`/`uncertain` or repeated-image guard stop. Use `--stop-reason-endpoint` for a distinct explicitly selected server. The7 candidates are no-visible-focus, unknown-next-action, no-visible-change, apparent-cycle, goal-uncertain, insufficient-visual-info and other-unknown.

This is saved in `stop-reason.json` with option scores, model identity, screenshot hash/reference and original outcome. It is a model hypothesis, not free-generated reasoning or an observed defect. A timeout, malformed response, cancellation or save failure cannot change the already-finalized trace or dispatch a key. Private/redacted final screenshots are not replaced with stale earlier images. Current4B and0.8B examples support `purpose: "stop-reason"`; third-party model adapters must honor that request purpose.

## Read-only public exploration

Task navigation can include `readOnly: true` and `denyUrlIncludes: ["/login", "action=edit", ...]`. The browser blocks mutating HTTP methods before transmission, blocks native/scripted form submissions, and excludes specified URLs from requests and History/navigation paths. Harmless public GET search is supported. These guards are in addition to origin/prefix navigation limits and do not bypass login,403,bot checks or service restrictions. An unusual service that mutates state through GET is outside this mechanical guarantee; choose verified public read-only tasks and fresh unauthenticated contexts.
