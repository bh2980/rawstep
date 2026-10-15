# Article entry speech from observed structure

Safari v18 and Chrome v12 correct article focus announcements in the existing speech formatter. Rawstep still supplies the target, state, command and previous context; this change performs no navigation. It uses the Native article name when present, otherwise the name of the immediate **exposed AX child on the path to the target**. An empty child name stays empty. Chrome does not use the adapter's inferred heading name as an explicit Native article name.

This explains the earlier apparent history difference. The older first button was inside an unnamed exposed AX group: `article → unnamed group → button`. Chrome announced the button followed by `article`. The later button was a direct exposed child: `article → button`, so entry announced its name before `article`. The formatter previously discarded this edge information. A descendant's name cannot replace the anonymous child's empty name.

## Native contrasts and original results

The unchanged Safari v17 / Chrome v11 model and caller inputs were sealed before each paired capture. All four batches used model JavaScript SHA-256 `6c92a01398ed0784b3eb66026be71a317de16c5bd0abb3553eb2505a11a991a2`; both browsers finished before any formatter or verifier changes. These are calibration contrasts, not independent evaluation. Each batch keeps its original first predictions, receipts, timing, AX hashes and failures in a separate fixture.

| Batch | Planned per browser | Original Safari Main / Full | Original Chrome Main / Full |
| --- | ---: | ---: | ---: |
| Heading before / explicit name / no heading / heading after / inner named group | 35 | 32 / 32 | 24 / 24 |
| Remove only DOM id; replay legacy HTML byte for byte | 13 | 13 / 13 | 9 / 9 |
| Change only button display in each original page | 13 | 13 / 13 | 8 / 8 |
| Add / remove only the first button's anonymous wrapper | 13 | 13 / 13 | 8 / 8 |
| Total before correction | 74 | 71 / 71 | 49 / 49 |

Each browser observed all 74 planned actions, with 74 eligible comparisons under the original input contract. Safari exposed the heading-derived article name even when the heading followed the buttons. With no heading its article name was empty, and it used the same child-name fallback observed in Chrome. Explicit article names remained authoritative in both profiles.

Removing the article DOM id changed neither the AX edge nor speech. Button display affected whether Chromium retained an anonymous wrapper in its **exposed AX tree**. Adding an HTML wrapper around a block button did not necessarily add an exposed AX group; removing the legacy wrapper or changing its child to block removed the exposed group and changed entry speech. Thus the rule follows the observed AX edge, without inspecting CSS, HTML tag arrangements, fixture labels or expected utterances. Headless CDP ancestry independently showed the same exposed-versus-ignored wrapper distinction as Native Chrome AX.

## Correction and regression result

`VoiceOverContainer.entryChildName` carries that edge's name, including an empty string. The Chromium adapter skips ignored nodes while finding the first exposed child toward the target. It preserves container counts after attaching per-target edge metadata. Existing container-entry history still decides **when** to announce the context; the new field decides its fallback name. There is no new navigation logic or visited-article cache.

The Native input constructor now preserves article scopes and this child name. Verification compares the supplied field to the independently observed target's actual Native ancestor path. An absent required fallback field is unmeasured; a guessed descendant label is a mismatch. Dialog and nested-document inputs retain their existing unsupported gates.

For the regression re-evaluation, new edge metadata comes from **before-action AX snapshots**, without speech or after-state labels. The post-action target, scope and edge name are independently checked. Original caller inputs and first scores above are unchanged. The [separate derived regression fixture](../tests/fixtures/voiceover-evidence/native-article-entry-child-v2-2026-10-15.json) records those input sources and hashes.

| Inspected regression, per browser | Safari | Chrome |
| --- | ---: | ---: |
| Planned / Native / verified inputs / eligible | 74 / 74 / 74 / 74 | 74 / 74 / 74 / 74 |
| Main Speech Exact, conditional and all-planned | 74/74 | 74/74 |
| Literal Full Speech Exact, conditional and all-planned | 74/74 | 74/74 |
| Normalized hint candidate equality | 74/74 | 74/74 |

This does not establish independent generalization, Navigation Accuracy, State Accuracy or Task Success. There are 11 correlated synthetic pages and repeated control visits. Receipt windows are bounded, not Native completion signals. Old inputs that omit `entryChildName` retain the earlier role-only approximation when a fallback is needed. Cross-frame, dialog and unseen complex article behavior still need separate Native validation. The frozen model provenance records exact source/build hashes from the collection worktree, which also contained previously pending diagnostics; it is not a claim of a pristine checkout or byte-identical rebuild from a commit alone.

## Re-execution and update detection

The representative update suite regenerates all 11 inspected pages and 74 actions with fresh regression IDs. A test checks every page byte and action sequence against the retained source fixtures. Recollect into new directories after an OS/browser update; do not replace the original observations.

From the repository root:

```sh
npm run build
npm --prefix packages/vo-corpus run generate -- --set article-entry-update-v1 --out data/cases/article-entry-update-check
npm --prefix packages/vo-corpus run collect -- --vm vo-collector --url ws://127.0.0.1:14382/session --browser safari --cases data/cases/article-entry-update-check --settings baseline-v2-dnd --visual-cursor
npm --prefix packages/vo-corpus run collect -- --vm vo-collector --url ws://127.0.0.1:14382/session --browser chrome --cases data/cases/article-entry-update-check --settings baseline-v2-dnd --visual-cursor
npm test -- tests/mock-voiceover-article-context-speech.test.ts tests/mock-voiceover-speech.test.ts
npm run test:integration -- tests/mock-voiceover-article-context-browser.integration.test.ts tests/mock-voiceover-native-context.integration.test.ts
node --import tsx --test packages/vo-corpus/test/article-context-speech.test.ts packages/vo-corpus/test/speech-input.test.ts
```

The speech tests replay caller-owned inputs without a VM. The browser tests execute all 148 new calibration actions through existing Chromium controls and compare projected speech; the older 72-action context regression now also asserts unnamed-article wording. These are input-projection/focus checks, not a Native logical-cursor accuracy claim. Keep the existing collection environment and relay instructions in [vo-corpus](../packages/vo-corpus/README.md).

The [subsequent prespecified composition evaluation](./voiceover-article-transfer.md) tests the corrected rule on two newly authored multi-article/state UIs. It retains failed collection attempts separately from the 34/34 completed speech comparisons per profile; those results are distinct from the inspected regression table above.
