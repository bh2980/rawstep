# Using Rawstep in CI

This guide is for someone who wants a pull request to say whether it made a task harder for a first-time screen reader user. It shows how to save a baseline from your main branch, compare each pull request with it, and read what comes back. The option and exit code lists are in the [CLI reference](./reference/cli.md).

Rawstep reports friction, not pass or fail. Comparing with a baseline does not change that. It tells you what changed beyond the spread between repeats, and you pick which kinds of change should fail the job.

## Why repeats matter

The simulated user is a model. Run the same task twice and you can get two different paths: 27 moves one time and 30 the next, or the goal reached once and missed once. A single run on a pull request cannot tell a change in the page from this spread.

So compare repeats with repeats:

- Run the baseline with `--repeat 3` or more.
- Run the pull request with the same `--repeat`.
- Rawstep calls a difference **noise** when the spread between repeats explains it (the rules are [below](#what-noise-means)). It reports and gates only what changed beyond noise.

With a single run on either side, Rawstep cannot judge reach or moves and says `too few runs on a side to tell`. Use at least `--repeat 2`; `--repeat 3` is a good start.

More repeats mean more planner calls and more time. Keep the suite to the tasks you care about (`--tag`).

## The flow

1. On your main branch, run a suite with repeats and save its summary to a file you commit.
2. On each pull request, run the same suite against that file.
3. When a change is intended, run the suite on main again and commit the new file.

### 1. Save a baseline

```sh
npx rawstep suite --tag checkout --repeat 3 --note "baseline" --save-summary rawstep-baseline.json
git add rawstep-baseline.json
git commit -m "Save the Rawstep baseline"
```

`--save-summary` writes the batch's summary to the file you name. Every batch also keeps one as `summary.json` in its folder under `.rawstep/experiments/`, but that folder is not committed (see the [results reference](./reference/results.md#the-batch-summary)). The summary holds the counts per task and profile, not the traces, so it is small.

### 2. Check a pull request

```sh
npx rawstep suite --tag checkout --repeat 3 \
  --baseline rawstep-baseline.json --fail-on reach \
  --junit rawstep-junit.xml --note "pr $GITHUB_SHA"
```

Use the same tasks, profiles and `--repeat` as the baseline. Cells are matched by task id and profile id: a task or profile that was renamed or removed shows up as missing in one batch and new in the other.

It prints the usual result, then what changed:

```text
Against the baseline (baseline):
  Checkout: no change beyond noise
  ! Newsletter: Reached the goal in 1 of 3 runs, against 3 of 3 in the baseline.
1 change caught by --fail-on reach (marked !).
```

A line marked `!` was caught by a gate. A line marked `·` is a change no gate covers. The profile name is added after the task name when the batch used more than one profile.

`--baseline` takes a `summary.json` file or a batch folder. To compare two batches you already have, without running anything:

```sh
npx rawstep compare rawstep-baseline.json .rawstep/experiments/<batch id>
```

## What is compared

Each task under each profile is a **cell**. For each cell Rawstep compares three things.

| What | Judged when | A change is |
| --- | --- | --- |
| Reach | Both sides have at least 2 runs that did not end on an error | The share of runs that reached the goal moved by more than one run on the smaller side. |
| Moves | Both sides have at least 2 runs that reached the goal | The median moves of the pull request is outside the baseline's range, widened by a margin (below). |
| Stuck places | Always | A place where pressing did not respond as the user expected appears in at least half of the runs now and in none of the baseline's runs (or the reverse). |

The reached share counts only runs that said something about the user: they reached the goal, gave up, or said they were done when they were not. A run that ended on an error says nothing about the page, and a run that was not measured says nothing about the user, so both are left out. A side with fewer than two such runs is "too few runs to tell".

A cell that is only in the pull request's batch is `new` and one that is only in the baseline is `missing`. A rise in reach, fewer moves and a stuck place that is gone are reported but are never caught by a gate.

### What noise means

**Reach.** The tolerance is one run on the side with fewer runs. With 3 runs on each side:

| Baseline | Pull request | Verdict |
| --- | --- | --- |
| 3 of 3 | 2 of 3 | Noise. One run went the other way. |
| 3 of 3 | 1 of 3 | A change. Two runs went the other way. |
| 2 of 3 | 1 of 3 | Noise. |

With 2 runs on one side, one run is half of that side, so a drop from 2 of 2 to 1 of 2 is noise too.

**Moves.** Take the baseline's fastest and slowest run that reached the goal, and widen that range by the larger of 3 moves and 20% of the baseline's median. Say the baseline's runs took 27 and 30 moves. The median is 28.5, 20% of it is 5.7, and the margin is 5.7. The range 27 to 30 widens to 21 to 36.

- A pull request whose median is 30 is noise: it is inside 21 to 36.
- A median of 37 is a change (`moves-up`). A median of 18 is a change too (`moves-down`).

**Stuck places.** A place is the element's role and name, for example `button "Add to cart"`. It is new when it came up in at least half of the pull request's runs and in none of the baseline's. A place that came up once in three runs is not reported.

## Gates

`--fail-on` lists the kinds of change that fail the command. It takes one or more names, separated by commas. It needs `--baseline` on `run` and `suite`; the default with `--baseline` is `reach`.

| Gate | Catches |
| --- | --- |
| `reach` | The reached share dropped beyond noise. |
| `moves` | Reaching the goal took more moves, beyond noise. |
| `stuck` | A new stuck place. |
| `missing` | A task or profile of the baseline that this batch did not run. |

Start with `reach`. Add `moves` once you have seen how much your suite varies, and `stuck` if you want every new place a user gets stuck on to be looked at. A change a gate does not cover is still printed and still shown in the job summary; it just does not fail the job.

Choosing a gate is a choice about your team, not a judgement by Rawstep. With no gate you still get the table and the changes. The command exits 0 unless a run broke.

## Exit codes

These are the exit codes of `run`, `suite` and `compare` (the full list is in the [CLI reference](./reference/cli.md#using-it-in-ci)).

| Code | Meaning | In CI |
| --- | --- | --- |
| `0` | Every run gave a measurement and no gate caught a change. | Pass. |
| `1` | An error: bad config, a missing key, or any run that ended on an error. | Fail. Fix the setup. It says nothing about the page. |
| `2` | Bad usage, for example `--fail-on` without `--baseline`. | Fail. Fix the command. |
| `3` | No run broke, but at least one was not measured (a limit, a bot check, a model that was unsure). | Your call. See below. |
| `4` | A gate caught a change against the baseline. | Fail, or warn if you only want to be told. |

When both a gate and a run that broke apply, the code is 1. When a gate and a not-measured run apply, it is 4.

**Treating 3.** A run that was not measured says nothing about the user, so it is left out of the comparison. Many of them leave few runs to compare, and the comparison then says "too few runs to tell" instead of hiding or inventing a change. You can:

- Accept it with a warning (the workflow below does this). The job passes and the summary still shows the numbers.
- Fail on it, so that nobody merges on a batch that was partly unmeasured. Raise the limits or switch the model if it keeps happening.

## GitHub Actions

This workflow runs the suite on pull requests. Replace the task tag, the `--repeat`, and the step that starts or builds your page.

```yaml
name: Rawstep

on:
  pull_request:

jobs:
  rawstep:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      RAWSTEP_OPENAI_API_KEY: ${{ secrets.RAWSTEP_OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # Needed only when the runner has no Chromium or Google Chrome Rawstep can use.
      - run: npx playwright install chromium
      # Build or start the page your tasks open here, if they do not open a public address.

      - name: Check that a run can start
        run: npx rawstep doctor

      - name: Run the suite against the baseline
        run: |
          set +e
          npx rawstep suite --tag checkout --repeat 3 --parallel 2 \
            --baseline rawstep-baseline.json --fail-on reach \
            --junit rawstep-junit.xml --note "pr ${{ github.sha }}"
          code=$?
          # 3: nothing broke, but some runs were not measured. Warn, do not fail.
          if [ "$code" -eq 3 ]; then
            echo "::warning::Some Rawstep runs were not measured. See the job summary."
            exit 0
          fi
          exit "$code"

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: rawstep
          path: |
            rawstep-junit.xml
            .rawstep/experiments
```

What it does:

- The summary table is added to the job's summary page on its own. Rawstep appends it to `$GITHUB_STEP_SUMMARY` when that variable is set, so there is no step for it. The table has one row per task and profile, with the result and the change against the baseline; changes a gate caught are in bold. It is written also when you pass no `--baseline`.
- `rawstep-junit.xml` is JUnit XML with one test case per task and profile. A test report action can read it. See [the JUnit file](#the-junit-file).
- The artifact has the runs, so you can download `.rawstep/experiments` and open the batch with `npx rawstep ui` on your own computer.

**Keys.** Put API keys in the repository's secrets and pass them as environment variables, as above. The names are in the [CLI reference](./reference/cli.md#environment-variables-and-files). `doctor` fails when a key is not set or is refused, so a missing secret stops the job early.

**Connections for CI.** A coding-agent CLI connection (Claude Code, Codex and the like) plans on that CLI's own sign-in. On a fresh runner nothing is signed in, so you would have to install the CLI and sign it in there. An API-key connection needs only the secret, so it suits CI better. Keep the agent CLI for your own computer.

**The page.** The tasks need a page to open. A task whose address is a file in the repository (a relative path) works as it is. For a page that has to be served, start it in a step before the run, and give the task its address.

### Updating the baseline

When a pull request changes how hard a task is on purpose, or you change the suite, the baseline no longer fits. Run the suite on main again and commit the new file:

```sh
git checkout main && git pull
npx rawstep suite --tag checkout --repeat 3 --note "baseline" --save-summary rawstep-baseline.json
git add rawstep-baseline.json && git commit -m "Update the Rawstep baseline"
```

Do this in the same pull request that makes the change, or right after it merges. If you would rather not do it by hand, run the same command in a workflow that you start yourself (`workflow_dispatch`) on the main branch, and upload `rawstep-baseline.json` as an artifact to download and commit:

```yaml
name: Rawstep baseline

on:
  workflow_dispatch:

jobs:
  baseline:
    runs-on: ubuntu-latest
    env:
      RAWSTEP_OPENAI_API_KEY: ${{ secrets.RAWSTEP_OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install chromium
      - run: npx rawstep suite --tag checkout --repeat 3 --note "baseline ${{ github.sha }}" --save-summary rawstep-baseline.json
      - uses: actions/upload-artifact@v4
        with:
          name: rawstep-baseline
          path: rawstep-baseline.json
```

Keep the same conditions for both: the same tasks, profiles, planner model and `--repeat`. A different model or profile changes the spread, and then the comparison measures the model, not the page.

Until Rawstep is on npm, `npm ci` needs it installed from the tarball described in [getting started](./getting-started.md#install).

## The JUnit file

`--junit <file>` writes one test case per task and profile, in one test suite named `rawstep`. The case name is `<task> · <profile>`, and its output is the result in a few words, for example `reached 2 of 3 · median 14 moves (12–16)`.

| Case is | When |
| --- | --- |
| failed | A gate caught a change in the cell. The message is the change. |
| errored | A run in the cell ended on an error. The message says it says nothing about the page. |
| skipped | Nothing was measured: every run was not measured, or none was counted. |
| passed | Anything else. |

Failures come only from gates, so without `--baseline` no case fails (a case can still error), and a change that no gate covers still passes.

## Reading the result

A failed gate says that, beyond the spread, something got worse. It does not say the page is inaccessible, and a pass does not say it is accessible. Open the batch in `npx rawstep ui`, or run `npx rawstep hints <run-dir>` on a run, to see where the runs got slow or stuck. Whether the page or the user's expectation is wrong is for you to decide. [Concepts](./concepts.md) explains the endings and hints.

## See also

- [CLI reference](./reference/cli.md): `compare`, `--baseline`, `--fail-on`, `--save-summary`, `--junit` and exit codes.
- [Results reference](./reference/results.md#the-batch-summary): the fields of `summary.json`.
- [Getting started](./getting-started.md): `suite`, `--repeat` and `--parallel`.
