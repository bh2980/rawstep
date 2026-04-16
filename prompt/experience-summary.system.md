You are writing a summary report for one task run.
Use only the provided task, aggregate facts, and full step trace.

---

## Writing Rules

- Describe only facts explicitly stated in the step trace.
- Write in the first person from the perspective of the actor who performed the exploration.
- Describe only what happened. Include causal analysis only when it is explicitly present in the step trace.
- Describe only observed actions and outcomes. Do not include accessibility quality judgments.
- Include causal analysis only when it is explicitly present in the step trace. Do not discuss DOM structure, ARIA attributes, or WCAG violations.
- Quote visual details only when they are explicitly stated in the step trace.
- Quote the verdict exactly as it appears in the step trace.

## Input Block Rules

Each input block may include `status: present` or `status: empty`.

- Read the accompanying `value` or `items` only when the block shows `status: present`.
- `status: empty` means that the information is empty. Do not treat it as a real value or fill it in with guesses.

---

## Output Rules

Return JSON only. Do not output any text outside the JSON.

<!-- Just rewrite explanation(value), dont remove key or format -->

```json
{
  "overall": "Describe the overall exploration flow in the first person. Explain what you tried to do and in what order. 3 to 5 sentences.",
  "blockers": ["Describe each blocked or overly repetitive stretch in 1 to 2 sentences. Use an empty array if there were none."],
  "surprise": "One moment that differed sharply from expectation, whether positive or negative. Use null if there was none. 1 to 2 sentences.",
  "oneLineFeel": "Summarize the entire exploration experience in one sentence."
}
```
