# Screenshot keyboard verification

> Historical snapshot. The current seven-workspace delivery and its validation limits are recorded in [V5 completion](./completion-v5.ko.md).
Date: 2026-10-01 UTC. Cloud Linux only; no user Mac, native VoiceOver, paid model endpoint, push, PR or publication.

## Important finding: navigation quality remains weak

The actual **OmniJev/OneJev-0.8B** model failed the natural-start keyboard-navigation fixture. The initial page had no focused control. With all17 actions available, the model selected Enter four times and produced no visual change. The independent repeated-image guard stopped the run on the fifth decision step. The recorded result is failure, not accessibility failure or a model-authored diagnosis.

A second run added general visible-focus/Tab/repetition instructions in the question while preserving OneJev's official prompt structure and the same17 options. It also selected Enter four times and hit the same guard. No task-specific action filtering, DOM focus hint, scripted action sequence or fallback was introduced to turn either run into a pass. The small model is a working inference integration, not a good general navigation policy demonstrated by these results.

The guard and model stops are now explicitly different: `stopSource: "exploration-guard"` versus `stopSource: "model"`, retained in policy decisions, final outcomes, CLI diagnostics and reports. A model's `stop: "stuck"` is an available choice; it does not imply that the model generates a natural-language explanation. Model confidence is not a conformance judgment.

## Real model and changed-screen wiring proof

The separate easy `screenshot-workflow.html` fixture has one naturally HTML-autofocused button and two content-changing activation stages. It is labelled a wiring check, not a navigation benchmark.

- Actual model: official decision-fine-tuned `OmniJev/OneJev-0.8B`, revision `c3939d8bf4cad34549a2b13bbb6aee9bcb6afee8`
- Official safetensors:2,214,590,296 bytes, SHA-256 `cb4b7456703baa26a0cfacf177067200b50021df5a6ba2a2cd1e6f6c868f2244`
- Standard Transformers5.18.0 / PyTorch2.14.1 CPU, BF16, six threads. No model repository Python code and `trust_remote_code=False`
- One forward pass per decision,17 candidate option-token logits → normalized distribution → argmax. No text-generation loop
- First measured wiring run: two real inferences (4,280.60ms and6,638.02ms), two Enter keys dispatched, three distinct actual PNG observations, independent completion verifier passed
- The following model request included the changed current PNG and preceding PNG. Independent audit matched image SHA-256 values, all17 scores, selected argmax, emitted key and next screenshot
- A uniform-gray-image ablation preserved the prompt/options but changed the selected action from Enter to `stop:stuck`; maximum logit difference2.4375 and probability difference0.1913. This supports real image dependence, not action correctness

A final rerun using the copied example server and final privacy-safe model request contract reproduced both outcomes: workflow2Enter/3states/success (4,495ms and6,748ms), natural navigation4Enter/1state/failure (4,328ms;6,516ms;7,150ms;6,941ms). The final natural outcome explicitly records `policyStopSource: "exploration-guard"`. Both final runs passed independent screenshot → logits → argmax → key → next-frame audits. Measured full process launch to HTTP health readiness was6,568ms with downloaded, cached weights; the isolated `from_pretrained` measurement was339.54ms.

The runtime's `loadMs` only measures `from_pretrained` after imports and processor setup. It is not cold process startup, download time or a disk-cache-cleared load benchmark. CPU inference measurements include image processing and forward pass, exclude loading, and should not be compared with the publisher's GPU latency claims.

Source, pinned downloader, runtime settings, hashes, raw score receipts, successful/failed traces and visual HTML reports are retained in the separate model experiment archive. No weights or Python environments are inside Rawstep's npm package. A separately requested larger-model comparison may be reported in that archive without changing these0.8B findings.

## Automated and package verification

The final combined aggregate command passed with the screenshot mode and source-grounded Mock VoiceOver changes together:

```sh
RAWSTEP_TEST_BROWSER_PATH=<trusted Chromium executable> npm run check
```

- Production build: passed
- All production and test TypeScript: passed
- Entire Vitest suite: **461/461**,26files, no skipped tests
- Real Chromium integration:106cases (97existing plus9new screenshot-loop cases)
-14public JavaScript exports and installed consumer declarations: passed
- Clean isolated npm tarball install and release-file allowlist: passed; no model weights, Python cache/runtime or old workspace graph shipped
- Installed `screenshot-run`: real Chromium plus explicitly labelled HTTP fixture adapter,2requests/actions, saved PNGs, independent verifier, analyze/report all passed. This automated package test is not represented as actual model inference
- Existing native protocol roundtrip, simulated VoiceOver CLI and legacy compatibility smoke: passed
- Installed SIGINT/SIGTERM finalization, exit codes130/143, and journal-persistence fault injection: passed
- Actual HTML report rendered in Chromium: gallery/action/evidence links visible, six image nodes (gallery plus raw observations), no page errors

The trusted Chromium147 runtime ran with `chromiumSandbox: true` and no sandbox-disabling arguments. Default tests remain mandatory rather than skipped if Chromium is missing.

## New regression coverage

Unit checks enforce PNG input, supported keyboard choices, normalized model probabilities, no named input values or DOM/AX/verifier payload leakage, bounded history, no adapter mutation of the actionable choice map, model/guard stop distinction, invalid configuration, cancellation and explicit remote HTTPS approval with literal `allowRemote: true`.

Actual Chromium checks cover model-adapter/screenshot/keyboard roundtrip; Tab and Shift+Tab; Enter/Space; dialog Escape; select arrows; named-text input privacy; repeated-image stop; evidence persistence failure before dispatch; model/type mismatch; rejected DOM editability-gate results kept outside model history; and private-safe malformed HTTP response errors.

Independent review identified and verified fixes for an action-result boolean that could reveal a DOM editability-gate outcome, malformed successful HTTP response text leaking through JSON parse errors, and truthy non-boolean remote-transmission opt-ins. The final interface omits all execution-result fields from the model history. Actual results remain in the local trace. After named input, stored screenshots, model evidence and free-form diagnostics are redacted under the shared runner rules; live screenshots sent to a chosen model are not anonymized by trace redaction.

## What this does not verify

No native screen-reader behavior, comprehensive keyboard reachability, focus-visibility conformance, correctness calibration or general website success rate is established. Exact pixel repetition can miss animation-driven loops and can stop legitimate focus changes that are invisible. Independent maximum-step/time budgets remain in force. Custom JavaScript policies are trusted plugins, not sandboxed untrusted code.
