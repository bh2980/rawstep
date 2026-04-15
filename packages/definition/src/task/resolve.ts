import type { ResolvedTask } from "./resolved";
import type { TaskSource } from "./source";

export type ResolveTaskSourceContext = {
  taskId: string;
  resolvedUrl: string;
  mode: ResolvedTask["mode"];
  maxSteps: number;
  timeoutMs: number;
};

export function resolveTaskSource(
  source: TaskSource,
  context: ResolveTaskSourceContext
): ResolvedTask {
  return {
    id: context.taskId,
    url: context.resolvedUrl,
    goal: source.goal,
    mode: context.mode,
    maxSteps: context.maxSteps,
    timeoutMs: context.timeoutMs,
    verify: source.verify,
    input: source.input
  };
}
