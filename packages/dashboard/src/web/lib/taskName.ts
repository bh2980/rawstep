/** How many words of the goal make up a task's default name. */
const NAME_WORDS = 6;

/** A task's default name from its goal: the first few words, without trailing punctuation; empty for an empty goal. */
export function nameFromGoal(goal: string): string {
  return goal.trim().split(/\s+/).filter(Boolean).slice(0, NAME_WORDS).join(' ').replace(/[\s.,;:!?…。、]+$/u, '').slice(0, 60);
}
