import { useTranslation } from 'react-i18next';
import type { PlanPhase } from '../../../shared/api';
import type { RouteChange } from '../../hooks/useRoute';
import { useRunSteps } from '../../hooks/useRunData';
import { isLive, taskRunNumbers, type RunRef } from '../../lib/runs';
import { Link } from '../Link';
import { TaskMark } from './PlanDocumentView';

/**
 * A run of this task that is going now, as a summary of its plan document: each phase with its state, and inside the phase
 * being worked on the current task with its actions against the limit. It follows the newest running run and links to its detail.
 */
export function LivePlanCard({ runs, navigate }: { runs: RunRef[]; navigate: (change: RouteChange) => void }) {
  const running = runs.find(ref => ref.run.state === 'running') ?? runs.find(ref => isLive(ref.run));
  if (!running) return null;
  return <LivePlan runRef={running} number={taskRunNumbers(runs, running.run.taskId).get(running.run.id)} navigate={navigate} />;
}

function phaseStatus(phase: PlanPhase, current: string | undefined): 'done' | 'active' | 'pending' {
  if (phase.tasks.some(task => task.id === current)) return 'active';
  return phase.tasks.every(task => task.status !== 'pending' && task.status !== 'active') ? 'done' : 'pending';
}

function LivePlan({ runRef, number, navigate }: { runRef: RunRef; number: number | undefined; navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const { run, experiment } = runRef;
  const { data } = useRunSteps(experiment.id, run.id);
  const plan = data?.plan, doc = plan?.document, limit = run.snapshot.spec.settings.runRules.stepActionLimit;
  return <section aria-label={t('planDoc.liveTitle', { version: doc?.version ?? 1 })} className="mt-3 grid max-w-xl gap-1.5 rounded-md border border-trace bg-trace-soft/40 px-3 py-2.5">
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
      <span className="font-medium"><span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-trace" />{t('runPage.number', { n: number ?? '' })} · {doc ? t('planDoc.factVersion', { version: doc.version }) : t('runHeader.liveState')}</span>
      <Link to={{ task: run.taskId, run: run.id }} navigate={navigate} className="text-[13px] text-trace underline-offset-2 hover:underline">{t('planDoc.liveOpen')} →</Link>
    </div>
    {!doc ? <p className="text-[13px] text-muted-foreground">{t('planDoc.liveWaiting')}</p>
      : <ol className="grid gap-0.5 text-[13px] leading-5">{doc.phases.map(phase => {
        const status = phaseStatus(phase, doc.current), task = phase.tasks.find(item => item.id === doc.current);
        return <li key={phase.id} className="flex items-start gap-2">
          <TaskMark status={status} className="mt-0.5" />
          <span className={status === 'pending' ? 'text-muted-foreground' : undefined}>
            {phase.title || phase.number}
            {task && <span className="text-muted-foreground"> › {t('planDoc.liveTask', { task: task.goal, n: task.actions, limit })}</span>}
            <span className="sr-only">, {t(`planDoc.status.${status}`)}</span>
          </span>
        </li>;
      })}</ol>}
  </section>;
}
