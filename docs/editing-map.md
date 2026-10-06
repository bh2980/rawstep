# Source editing map

Rawstep has engine packages, the shared `@rawstep/project` package and one private dashboard workspace. `rawstep` is the only published package: its `src/` has reexports and the executable only and `tsdown` bundles every workspace into it; each implementation has one owning package and a declared dependency graph.

| Responsibility | Source owner | Verification |
|---|---|---|
| Task/action/observation contracts and validation | `packages/core/src/contracts/` | contracts/input tests |
| Environment profile types/schema | `packages/core/src/profiles/` | profiles unit tests |
| Ordered trace journal/privacy/schema | `packages/core/src/trace/` | trace/runner tests |
| Scripted/custom policy loading | `packages/policies/src/policy/` | CLI/runner tests |
| Screenshot choice model, policy, stop hypotheses | `packages/policies/src/screenshot/` | screenshot/stop-reason tests |
| Browser lifecycle/navigation/read-only boundaries | `packages/browser/src/browser/` | native Chromium navigation/read-only suites |
| Budgets, actions, named inputs, cancellation/verifier | `packages/browser/src/runner/`, `verify/` | runner, input and browser suites |
| Screenshot keyboard backend | `packages/browser/src/screenshot/` | screenshot/keyboard integration |
| SystemOne clients/policies | `packages/policies/src/systemone/` | fake and HTTP tests |
| Every LLM call (Vercel AI SDK, OpenAI-compatible; `@rawstep/policies/llm`) | `packages/policies/src/llm/` | `tests/llm.test.ts` |
| Explicit LLM analyzer | `packages/reports/src/analyze/llm.ts` | finalized trace/evidence tests |
| Applied profiles/focus/layout/native zoom | `packages/browser/src/profiles/` | profiles browser tests |
| AT Driver/Orca/simulated VoiceOver | `packages/screenreaders/src/` | protocol/native bridge/simulation suites |
| Corpus provenance/coverage/learned wording | `packages/screenreaders/src/evidence/` | evidence/extraction/heldout tests |
| Optional native Python bridge | `packages/screenreaders/native/` | `npm run test:orca-native`; separate live native test |
| Saved analysis and escaped reports | `packages/reports/src/` | analysis/report tests |
| `rawstep.config.json` schema (browser-safe) | `packages/project/src/config.ts` | project/config tests |
| Project store: config revision, task files, `.env.local` credentials | `packages/project/src/store.ts` | project store tests |
| Run assembly and execution (`plan.ts`, `execution.ts`), `runTask`/`finalizeRun` (`run.ts`), model discovery (`discover.ts`), LLM client wiring (`llm.ts`) | `packages/project/src/` | project run/plan tests |
| CLI commands (init, ui, run, hints, report, analyze, doctor) | `packages/cli/src/cli/` | CLI, package smoke |
| `rawstep` executable and `rawstep/*` import subpaths | `packages/rawstep/src/` | facade export/consumer tests |
| Local dashboard UI, local API, experiment queue/history (uses `@rawstep/project`) | `packages/dashboard/src/` | dashboard build, catalog and browser checks |
| Public API roots (explicit export lists), package-internal helpers in `src/internal/` | `packages/*/src/index.ts` | `tests/public-api.test.ts`, source-graph test |
| Build/pack/source reproduction | `scripts/` and package manifests | package/DAG/source-smoke checks |

Root `examples/` and `fixtures/` contain runnable inputs. Optional model programs stay in examples and are not mandatory npm runtime dependencies. Generated corpus source remains reproducible through the evidence scripts; do not silently edit calibration results by hand.

Use `npm run check` for the aggregate and `npm run test:source` for a clean source reproduction. Package-local compilation must never resolve a sibling's unbuilt source via a path alias. Run `npm run test:package` to install the single `rawstep` tarball outside the checkout.
