# New article/state composition evaluation

Safari v18 / Chrome v12 were fixed before authoring two new compositions after the [article entry correction](./voiceover-article-entry-speech.md). The speech engine, HTML, caller-owned inputs and predictions remained unchanged throughout all capture attempts. This evaluates speech from supplied targets/state/history, without adding simulator navigation.

The civic-notices page combines an H3-named article, an anonymous child group, a second explicitly named article, a checked subscription control and main/region/footer returns. The archive-cart page nests an explicitly named article inside an unnamed article, changes toggle and disclosure states, opens/closes real text content, and returns across a delivery group. Their complete 16- and 18-action sequences and declared template/site/contrast groups had no collision against **852** earlier cases. Primitive roles and previously calibrated rules are shared; these are two small composition-transfer examples, not a claim of global structural independence.

Freeze time: `2026-10-15T13:02:28.895Z`. Model JavaScript SHA-256: `a8530fcb08f6bffb448bc2beccbd8a4a4d2cd93e23b53d7c50746d70169cad27`. Cases SHA-256: `dd77e13f51ab735deafee05c40549094a533823e709c057da66371b651a02f10`. The [first-evaluation fixture](../tests/fixtures/voiceover-evidence/native-article-transfer-2026-10-15.json) preserves the original per-profile inputs, predictions, receipt timing, before/after AX hashes, input gates, state checks and all failures. Its source/build provenance comes from the collection worktree, including previously pending diagnostics; it is not a pristine-commit rebuild claim. These inspected pages are now regression material, while their prespecified evaluation remains preserved.

## Environment failures and unchanged-input recovery

The first Safari attempt stopped when the VM process terminated after five observed commands. The VM was restarted with its existing 2 CPU / 4 GiB configuration; the termination cause is unproven. The guest VoiceOver resumed, but the AT Driver server required restarting. One subsequent connection attempt failed before session metadata because the server bound to the guest IP while the relay still targeted guest loopback. The relay backend was corrected to the existing guest binding, retaining the host endpoint `ws://127.0.0.1:14382/session`. No library, HTML, prediction input or scoring-helper changes were made.

Chrome's first preparation was then stopped by the existing `Restore pages?` window guard, before scenario chords. Normal quit/reopen did not dismiss the bubble. Its Native AX contents identified the Close button; only that button was clicked, and a subsequent existence check returned false. Restore and telemetry controls were not selected. A fresh Chrome attempt completed with the same fixed inputs/model.

The existing environment-equivalence check matched observable macOS/build, browser, locale/languages, VoiceOver app version, keyboard mode, collection/start protocols and negotiated capabilities between failed and recovered runs. Protected preferences and pre-restart server source identity remain incompletely observed; matching visible facts does not establish complete environment equality. The guest remained headless and muted; Safari JavaScript from Apple Events was not enabled.

| Attempt | Planned actions | Native observed | Comparable | Main matched | Literal Full matched |
| --- | ---: | ---: | ---: | ---: | ---: |
| Safari original, VM terminated | 34 | 5 | 5 | 5 | 5 |
| Safari connection startup failure | 34 | 0 | 0 | unmeasured | unmeasured |
| Safari fixed-input recovery | 34 | 34 | 34 | 34 | 34 |
| Chrome recovery-window guard | 34 | 0 | 0 | unmeasured | unmeasured |
| Chrome fixed-input recovery | 34 | 34 | 34 | 34 | 34 |

All **170 planned action executions** remain in the collection accounting: 73 Native observations, including the five repeated Safari observations; there are 68 distinct planned profile/action pairs. Thus verified Main matches / all attempted planned executions is **73/170**, alongside the conditional 73/73. This is an accounting measure over retries, not whole-library accuracy. The original profile attempts remain 5/34 and 0/34; neither was completed by filling its missing rows from a retry. Missing commands, unmeasured state and unaligned starts remain explicit. Three environment root failures explain those missing rows; they are not dozens of separate formatter bugs. The [archive audit](../packages/vo-corpus/test/article-transfer-attempt-audit.json) independently verifies the same original input fingerprint for all five attempt directories, including the startup attempt without metadata.

## Speech evidence and practical limits

For each completed fixed-input recovery, all 34 Native targets/state/ancestors, article entry-child names where required, and command mappings passed the frozen equivalence gates. **Main Speech Exact and literal Full Speech Exact were both 34/34 per browser**, with no post-observation engine/input correction. All Main results also match with case and punctuation retained after whitespace folding. All six before/after checked/pressed/expanded events per browser were independently verified, including actual disclosure-text presence. These state observations validate the supplied speech inputs; they are not overall simulator State Accuracy or Task Success.

The result supports the article naming/context rule on the new combinations, including nested articles, ancestor re-entry and activation. It does not establish 90% performance on arbitrary real websites, dialog/frame contexts, editing or all browser configurations. Prior actual-site failures remain unchanged. Stable unique Native outline/AX geometry is not a logical-cursor API or Navigation Accuracy, and bounded receipt windows do not prove Native speech completion. Candidate Full equality does not establish a queue/interrupt scheduler.

Browser-free tests replay the fixed API inputs and retain the failed-attempt denominators. The browser integration test runs all 68 completed actions through actual Chromium controls with the existing adapter, checking projected speech and actual focus/checked/pressed/expanded state. This validates the input projection in the attached main document, not Native navigation parity.

From the repository root:

```sh
npm run build
npm test -- tests/mock-voiceover-article-transfer.test.ts
npm run test:integration -- tests/mock-voiceover-article-transfer-browser.integration.test.ts
node --import tsx --test packages/vo-corpus/test/article-transfer.test.ts
npm --prefix packages/vo-corpus run generate -- --set article-transfer-v1 --out data/cases/article-transfer-recheck
```

Collect the regenerated directory separately in Safari and Chrome using the [existing VM/relay instructions](../packages/vo-corpus/README.md). A regeneration of these already inspected pages is an update/regression check, not a new independent holdout. Preserve original run directories, failed attempts and first scores.
