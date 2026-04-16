# Reports

For each run, the HTML report and execution artifacts are saved under `outDir/<taskId>/<runId>/`, where `outDir` is the configured output root directory. The report is not just for checking success or failure. It is designed so you can follow the process again and see **what the agent observed and what it did at each step**.

---

## Generated Artifacts

| Item | Description |
|------|-------------|
| `trace.jsonl` | User-facing replay record for each step |
| `diagnostics.jsonl` | Internal runtime warnings/errors. Created only when events exist |
| `trace.json` | Final merged trace |
| `metrics.json` | Aggregate summary metrics |
| `prompts.json` | System/user prompts and image counts per step |
| Verdict | Whether the task was completed, got stuck, or timed out |
| Step replay | Observation, action, and reason for each step |
| Input cost | Total number of key inputs and their distribution |
| Timing breakdown | Setup plus per-step `observe`, `decide`, `execute`, `verify` time |
| Observation evidence | Announcement capture path, phrase count, and end reason for each screenreader step |
| Experience summary | `overall`, `blockers`, `surprise`, `oneLineFeel` (opt-in) |
| Success evidence | Agent-declared success and verifier-confirmed success shown separately |
| Exit source | Whether the run ended by agent verdict or verifier auto-complete |
| Failure point | Highlighted observation right before failure |

---

## HTML Report Layout

**Top summary header**: task id, goal, mode, URL, final result, total step count, total runtime

**Summary card**: if experience summary is enabled, shows `overall`, `blockers`, `surprise`, and `oneLineFeel`. If generation fails, shows the error text.

**Flow / timeline**: lets you scan the full step sequence with bars and filters. You can narrow steps by states such as `Important`, `Verify Fail`, `Failure Point`, and `Verdict`.

**Action breakdown**: shows the distribution of frequently used actions.

**Timing overview**: shows a per-step decide-time sparkline plus each step's `observe`, `decide`, `execute`, and `verify` time. Because LLM response time can vary even in the same environment, timing numbers are more useful for understanding **relative differences between steps** than for treating them as absolute numbers.

**Step detail panel**: shows the selected step's observation, action, rationale, verification result, timing, and screenshots.

In screenreader mode, screenshots show the state after the previous action, not the exact observation moment. Because of that, the `Initial` row has no screenshot, and the remaining final image is shown in a separate `Result` row.

---

## How to Read Step Detail

When you open one step, read it in this order:

1. **Observation**: in keyboard mode, this includes title, URL path, focus hint, and scroll hint. In screenreader mode, it includes announcement, capture method, announcement count, and observe reason.
   If auxiliary collection fails in screenreader mode, the UI shows statuses such as `DOM Focus: Failed` or `Cursor Screenshot: Unsupported` instead of raw errors.
2. **Decision / action**: which key or `sr.*` action was chosen. If rationale saving is enabled, you can also inspect the reason.
3. **Verification**: whether the verifier ran, whether it passed, and which rule failed if it did not.
4. **Timing**: whether a slow step was caused by observation or decision.

---

## Step Status

| Status | Description |
|--------|-------------|
| `Success` | The agent returned a success verdict and the run finished successfully |
| `Verified` | The verifier passed on that step |
| `Verify Fail` | The verifier ran but failed |
| `Failure Point` | The representative failure point calculated by the aggregate |
| `Stuck` | The agent stopped because it judged there was no reasonable next action |
| `Error` | An execution error occurred |

> `Success` and `Verified` are different. The agent saying "I think it worked" should be separated from the verifier actually proving it passed.

---

## What to Inspect in Screenreader Reports

For screenreader runs, these values are especially important:

| Item | Description |
|------|-------------|
| `announcement` | Core text the model heard on this step |
| `announcement capture` | Path used to collect the spoken output |
| `announcement count` | Number of captured phrases in this observation |
| `observe reason` | Why observation ended, such as `silence`, `timeout`, `fallback`, `synthetic` |

- If `timeout` repeats, the observe wait may be too short, the real speech may be delayed, or the backend may be unstable.
- If you see `synthetic`, the observation was a stabilized substitute, not a direct capture of real speech.
- If you see `fallback`, check whether the text is replacing an empty log.

---

## Using `prompts.json`

If the HTML report is not enough, inspect `prompts.json`. It records the system prompt, user prompt, and attached image count for each step.

It is especially useful in the following cases:

- You changed a prompt and want to see the exact text that was sent to the model
- You want to check whether `hint` was attached correctly in `availableActions`
- You want to inspect how the announcement block was rendered in screenreader mode

---

## Using `diagnostics.jsonl`

`trace.jsonl` and the HTML report are for understanding the user-facing flow. In contrast, `diagnostics.jsonl` is for runtime-internal warnings and errors.

- Why `domFocus` collection failed
- Why VoiceOver cursor screenshots were unsupported or failed
- Debugging cases where you need raw error strings or stack traces

In short, split them like this: **trace for replay**, **diagnostics for engine failures**.

---

## Warning Sign Patterns

Timing metrics can vary from run to run because LLM response times fluctuate. Judge by **whether a pattern repeats**, not by a single exact number.

| Symptom | Possible cause |
|---------|----------------|
| Many `Verify Fail` steps | Agent judgment and actual verification rules are often mismatched |
| `Failure Point` keeps repeating before the same action | The UI flow itself may be blocked more than the exploration strategy |
| `Tab` / `sr.next` dominates the action breakdown | The run may be wandering broadly instead of getting closer to the goal |
| Only `decide` is unusually slow in timing | The observation may be sufficient, but the screen may be hard to reason about |
| Only `observe` is unusually slow in timing | Possible screenreader speech delay, slow page response, or bad observe settings |
