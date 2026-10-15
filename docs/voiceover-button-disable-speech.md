# Plain-button self-disable receipts — 2026-10-16

Native practical-task observations exposed a real speech error: physical Space on a decrement button makes that
button disabled, Native is silent, and the adapter falls back to reading the dimmed object/table position. This study
isolates the receipt from subsequent browser focus/navigation behavior. Rawstep still owns movement.

Four controlled pages vary only enabled/self-disabled and bare/named-form context. Text, action and result stay
fixed. The clean b94ed5b baseline, actual inputs, previous contexts, state and independent target observations were
frozen before Native. Both profiles completed before inspection. Two different reverse-entry compositions were
reserved before these Native contrasts and before the correction.

## Calibration evidence and correction

Both profiles observed all eight actions, eight matched atomic targets, eight disabled-state fields and two actual
disable transitions. All four final click/state checks passed; these are fixture health, not user tasks. Physical
Space was silent in both browsers in both contexts, including the enabled control. The first baseline has 6/8
normally comparable Main/Full matches per profile. Its two self-disable windows contain an unsupported activation
plus an incorrect object-reading fallback and remain in the original denominator.

The [first source fixture](../tests/fixtures/voiceover-evidence/native-button-disable-source-v1-2026-10-16.json)
retains those predictions and first scores. Current pure-API regression checks independently verify each actual
before/after input pair against the Native visible target/state before comparing receipts. All four Space pairs
per profile now produce the observed empty receipt array. This is calibrated regression, not independent transfer.

Safari v27 / Chrome v21 accept this event only for physical Space on a native HTML button with an independently
known enabled-before/disabled-after transition, stable identity/name, no other changed semantics, and the measured
plain-button state. Protected, initially disabled, custom-role, VO activation, popup/toggle/expanded, help/description
and other unmeasured combinations remain unsupported. The modeled event returns `[]` and a copied unchanged context.
The adapter uses that result and does not emit the object fallback. An explicit later reading may still describe a
disabled button. No fixture label, HTML layout or expected Native string selects the rule.

## Acquisition failure and recovery

The first Safari attempt stopped before any experimental key: 8 planned actions, 0 observed. It remains in its
original run. The complete source acquisition therefore has three attempts: 24 planned actions, 16 observed; the
successful calibration subset above is not a replacement for that acquisition accounting.

Read-only inspection found Safari in Tab Overview, following the earlier practical-task focus-path divergence.
Its `front document` URL was missing; the old navigation command returned success without changing the visible
current tab. Addressing the current tab changed its URL, but Tab Overview still hid the web AX tree. Reselecting
the tab and Escape did not recover it. Clicking the uniquely observed Tab Overview toolbar button restored a known
marker page's requested AX URL/body. VoiceOver PID stayed unchanged; no VoiceOver restart or AT Driver cause is
claimed. The host navigation helper now targets Safari's current tab. It still requires Native URL/body confirmation.

The second acquisition uses byte-identical original model/input/prediction files and a separately sealed effective
observer manifest for the navigation fix. Original failed records, navigation probes and both acquisition manifests
are preserved. The public fixture includes the recovery metadata and source hashes.

## Replay

From the repository checkout:

```sh
npm run build
npm test -- tests/mock-voiceover-button-disable.test.ts tests/mock-voiceover-activation.test.ts
cd packages/vo-corpus
node --import tsx --test test/button-disable-speech.test.ts test/host.test.ts
```

These are preserved-data/current-code regressions. Fresh Native transfer must freeze the corrected model on the two
reserved pages before either profile; keep Main, Full, input quality, target/state checks and all-plan counts separate.
The Safari focus-reset behavior after disabling a focused button remains a Rawstep/browser integration gap. It is
not repaired by emitting silence, and this receipt correction does not establish whole-library 90% accuracy.
