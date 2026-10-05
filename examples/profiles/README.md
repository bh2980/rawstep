# Environment profile examples

`task.json` uses the local regression fixture (`fixtures/environment-lab.html`). `matrix.json` lists supported browser experiments and genuinely unsupported native zoom to demonstrate honest capability reporting. `decisions.json` is a deterministic test fixture only for library tests; real exploration uses a model registered in `rawstep.config.json`.

Create the run profiles you want to compare in `rawstep.config.json` (for example with `npx rawstep ui`), register a decision model, then run the same task once per profile:

```sh
npx rawstep run examples/profiles/task.json --profile default --model MODEL
npx rawstep run examples/profiles/task.json --profile reflow-text --model MODEL
npx rawstep run examples/profiles/task.json --profile forced-colors --model MODEL
```

A profile whose requested setting cannot be applied (for example native browser zoom without a verified paired zoom controller) is reported as unsupported rather than silently approximated. A task result for a responsive/text-size profile is not a native zoom result. `human-evidence.example.json` is intentionally empty; no real user results are invented.

Read [environment profiles](../../docs/environment-profiles.md) before choosing a native/emulated setting.
