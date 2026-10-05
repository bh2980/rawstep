# Environment matrix examples

`task.json` uses the local regression fixture. `matrix.json` includes supported browser experiments and genuinely unsupported native zoom to demonstrate honest capability reporting. `decisions.json` is a deterministic test fixture only; use `--model-endpoint` or a real model policy for exploration.

```sh
npm run rawstep -- profiles
npm run rawstep -- matrix examples/profiles/task.json --profile-set examples/profiles/matrix.json --script examples/profiles/decisions.json --out runs/profile-fixture
```

This example returns nonzero because native browser zoom is unavailable without a verified paired zoom controller. A task result for a responsive/text-size profile is not a native zoom result. `human-evidence.example.json` is intentionally empty; no real user results are invented.

Read [environment profiles](../../docs/environment-profiles.md) before choosing a native/emulated setting or importing user-test evidence.
