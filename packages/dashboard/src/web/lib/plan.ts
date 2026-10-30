import type { ModelCall, PlanDocument, PlanTask, RunPlanView, StepView } from '../../shared/api.js';
import { t } from '../i18n/index.js';

/** A task of the document with the title of the phase it sits in (retired tasks keep the title they had). */
export type PlacedTask = PlanTask & { phase: string; retired: boolean };

export function placedTasks(doc: PlanDocument): PlacedTask[] {
  return [...doc.phases.flatMap(p => p.tasks.map(task => ({ ...task, phase: p.title, retired: false }))), ...doc.retired.map(task => ({ ...task, retired: true }))];
}

/** The plan versions that corrected the plan: neither the first plan nor a phase checkpoint. */
export const replanCount = (plan: Pick<RunPlanView, 'versions'>): number => plan.versions.filter(v => v.trigger !== 'start' && v.trigger !== 'checkpoint').length;

/** Why a version was made, in words: "실행 모델 도움 요청 (완료 단서를 찾을 수 없음)". */
export function triggerLabel(trigger: string, help?: string): string {
  const base = t(`planDoc.triggers.${trigger}`, { defaultValue: trigger });
  return help ? t('planDoc.triggerWithHelp', { trigger: base, help: t(`hints.text.helpReasons.${help}`, { defaultValue: help }) }) : base;
}

/** The revision that dropped a task, if one did. */
export const droppedIn = (doc: PlanDocument, taskId: string) => doc.revisions.find(r => r.abandoned.includes(taskId));

/** "포기 (v2) · 실행 모델 도움 요청 (완료 단서를 찾을 수 없음)": how a task ended, for the tree and the task pane. */
export function endingLabel(doc: PlanDocument, task: PlanTask): string | undefined {
  if (task.status === 'abandoned') {
    const revision = droppedIn(doc, task.id);
    return revision ? t('planDoc.abandonedIn', { version: revision.version, reason: triggerLabel(revision.trigger, revision.help) }) : t('planDoc.status.abandoned');
  }
  if (task.status === 'failed') return t('planDoc.failedLimit');
  if (task.status === 'done' && task.ending?.verified) return t(`planDoc.verified.${task.ending.verified}`);
  return undefined;
}

/** Seconds spent waiting for models, in total and per role. */
export function modelWait(calls: RunPlanView['calls']): { total: number; planner: number; executor: number } {
  const all = Object.values(calls).flat();
  const sum = (list: ModelCall[]) => list.reduce((s, call) => s + (call.elapsedMs ?? 0), 0) / 1000;
  return { total: sum(all), planner: sum(all.filter(c => c.role === 'planner')), executor: sum(all.filter(c => c.role !== 'planner')) };
}

/** The steps whose action served a task, in order. */
export function taskSteps(plan: Pick<RunPlanView, 'stepTasks'>, taskId: string, steps: readonly StepView[]): StepView[] {
  return steps.filter(step => step.action && plan.stepTasks[step.step]?.taskId === taskId);
}

/** Whether what the screen reader said after a step differs from what it said after the step before; undefined without speech. */
export function speechChanged(step: StepView, steps: readonly StepView[]): boolean | undefined {
  const index = steps.indexOf(step), before = index > 0 ? steps[index - 1] : undefined;
  if (!step.speech || !before?.speech) return undefined;
  return step.speech.lines.join('\n') !== before.speech.lines.join('\n');
}

/** The task a step served (from the newest document that has it), for labels such as "1.2 담기 버튼 찾기". */
export function servedTask(plan: RunPlanView, step: number): PlacedTask | undefined {
  const served = plan.stepTasks[step];
  if (!served) return undefined;
  const doc = plan.documents[served.planVersion] ?? plan.document;
  return placedTasks(doc).find(task => task.id === served.taskId) ?? placedTasks(plan.document).find(task => task.id === served.taskId);
}

/** The label of a task by id in the newest document: its number and goal. */
export function taskName(plan: RunPlanView, taskId: string | undefined): string | undefined {
  const task = taskId ? [...placedTasks(plan.document), ...Object.values(plan.documents).flatMap(placedTasks)].find(item => item.id === taskId) : undefined;
  return task ? `${task.number} ${task.goal}`.trim() : taskId;
}

/** Whether a step holds a new plan version that corrected the plan, or the stop at the replanning limit. */
export function planMark(step: Pick<StepView, 'plan' | 'hints'>): 'replan' | 'limit' | 'broken' | undefined {
  const events = step.plan?.events ?? [];
  if (events.some(event => event.kind === 'limit')) return 'limit';
  if (step.hints.includes('expectation-broken')) return 'broken';
  return events.some(event => event.kind === 'plan' && event.reason !== 'start' && event.reason !== 'checkpoint') ? 'replan' : undefined;
}
