# CI & Baseline Regression Testing

AI navigation can vary by a move or two from run to run. `rawstep suite` and `rawstep compare` run tasks with repeats, ignore minor jitter, and fail CI **only** when a real regression occurs against your saved baseline.

---

## 1. Running a Task Suite (`rawstep suite`)

`rawstep suite` runs multiple tasks across one or more profiles as a single batch and saves a `summary.json` file (`BatchSummary` schema `1.0`) in `.rawstep/experiments/<batch-id>/`:

```bash
# Run every task in rawstep.config.json under each task's configured profiles
npx rawstep suite

# Run only tasks tagged "checkout" across two specific profiles, 3 repeats each, 2 browsers in parallel
# (`linear` and `by-headings` are example profile ids: use profile ids defined in your own config)
npx rawstep suite --tag checkout --profile linear --profile by-headings --repeat 3 --parallel 2
```

Each `(task, profile)` pair forms a **summary cell** in `summary.json`, recording:
- How many runs ended as `reached`, `gave-up`, `mistaken`, `unmeasured`, or `error`.
- The reach rate among measured runs (`reached / measured`).
- The `min`, `median`, and `max` move counts for runs that reached the goal.
- **Stuck places**: elements where the user pressed something and it did not respond as expected (`expectation-broken`), with the number of runs each appeared in.
- Recurring **page hints** (`focus-lost`, `missing-announcement`, `modal-focus-outside`, etc.).

---

## 2. Saving & Comparing Against a Baseline

### Step 1: Record and commit a baseline summary

Run your suite and pass `--save-summary` to write `summary.json` to a tracked file in your repo:

```bash
npx rawstep suite --tag smoke --repeat 3 --save-summary baseline.summary.json
git add baseline.summary.json
```

### Step 2: Gate pull requests against the baseline

On subsequent runs (or via `rawstep compare`), pass `--baseline` and `--fail-on`:

```bash
npx rawstep suite --tag smoke --repeat 3 \
  --baseline baseline.summary.json \
  --fail-on reach,moves,stuck \
  --junit rawstep-junit.xml
```

Or compare two saved summaries / batch folders offline without re-running the browser:

```bash
npx rawstep compare baseline.summary.json .rawstep/experiments/<batch-id>/summary.json \
  --fail-on reach,moves,stuck
```

---

## 3. Regression Gates (`--fail-on`) & Noise Filtering

When `--baseline` is provided, `--fail-on` defaults to `reach`. You can pass a comma-separated list of any of the four gates:

| Gate | What Fails the Check (Exit Code `4`) | How Repeat Noise Is Filtered |
| :--- | :--- | :--- |
| **`reach`** *(default)* | The share of measured runs that reached the goal dropped compared to the baseline. | Judged only when both sides have at least 2 measured runs. A change of one run or less on the smaller side is noise. |
| **`moves`** | Reaching the goal took significantly more moves than in the baseline. | Judged only when both sides have at least 2 runs that reached the goal. The new median must fall outside the baseline's `min`..`max`, widened on each side by 3 moves or 20% of the baseline median, whichever is more. |
| **`stuck`** | An element became a new **stuck place**: it appears in at least 50% of the new batch's runs that ran for that `(task, profile)` cell (every run but the ones that ended on an error, measured or not) and in none of the baseline's. | Compares stuck elements per cell; a place seen in fewer than half the runs is noise. |
| **`missing`** | A `(task, profile)` pair present in the baseline is absent from the new batch. A pair with no measured runs is reported as "not compared" and never fails. | Ensures coverage wasn't accidentally dropped. |

---

## 4. CI Exit Codes & JUnit / GitHub Actions Output

### Exit Codes in CI
- **`0`:** Every run produced a measurement and no `--fail-on` regression gate triggered.
- **`1`:** Infrastructure error, invalid config/task, or a run crashed with an execution error.
- **`2`:** Invalid CLI flags or arguments.
- **`3`:** No run crashed, but at least one run ended as **`unmeasured`** (planner-call limit, `maxSteps`, `timeoutMs`, repetition guard, a profile that allows no action the plan needs, a model that was unsure, a planner that did not answer in time, a blocked site such as a bot check, or a page environment this computer could not apply).
- **`4`:** One or more `--fail-on` regression gates caught a regression against `--baseline`.

When several apply, `1` wins over `4`, and `4` over `3`. Passing `--fail-on` to `run` or `suite` without `--baseline` is a usage error (`2`).

### GitHub Actions Integration
When `rawstep run`, `rawstep suite`, or `rawstep compare` runs inside GitHub Actions (where `$GITHUB_STEP_SUMMARY` is set in the environment), Rawstep automatically appends a formatted Markdown comparison table to the workflow's **Job Summary**.

```yaml
name: Screen Reader Regression Suite
on:
  pull_request:

jobs:
  rawstep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.12.0'
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Run Rawstep Suite against Baseline
        env:
          RAWSTEP_OPENAI_API_KEY: ${{ secrets.RAWSTEP_OPENAI_API_KEY }}
        run: |
          npx rawstep suite --tag ci \
            --repeat 3 \
            --parallel 2 \
            --baseline baseline.summary.json \
            --fail-on reach,moves,stuck \
            --junit rawstep-junit.xml
      - name: Upload Rawstep Artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: rawstep-experiments
          path: |
            .rawstep/experiments/
            rawstep-junit.xml
```
