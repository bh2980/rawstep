import { useTranslation } from 'react-i18next';
import type { PlanPhase } from '../../../shared/api';
import type { RouteChange } from '../../hooks/useRoute';
import { useRunSteps } from '../../hooks/useRunData';
import { isLive, taskRunNumbers, type RunRef } from '../../lib/runs';
import { Link } from '../Link';
import { StatusShape } from '../StatusMark';
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
  const plan = data?.plan, doc = plan?.document;
  return <section aria-label={t('planDoc.liveTitle', { version: doc?.version ?? 1 })} className="mt-3 grid max-w-xl gap-1 border-y border-edge py-2">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 font-medium"><StatusShape status="running" />{t('runPage.number', { n: number ?? '' })} · {doc ? t('planDoc.factVersion', { version: doc.version }) : t('runHeader.liveState')}</span>
      <Link to={{ task: run.taskId, run: run.id }} navigate={navigate} className="border-b border-edge-strong hover:border-foreground">{t('planDoc.liveOpen')} →</Link>
    </div>
    {!doc ? <p className="text-ink-2">{t('planDoc.liveWaiting')}</p>
      : <ol className="grid gap-0.5">{doc.phases.map(phase => {
        const status = phaseStatus(phase, doc.current), task = phase.tasks.find(item => item.id === doc.current);
        return <li key={phase.id} className="flex items-start gap-2">
          <TaskMark status={status} className="mt-0.5" />
          <span className={status === 'pending' ? 'text-ink-2' : undefined}>
            {phase.title || phase.number}
            {task && <span className="text-ink-2"> › {t('planDoc.liveTask', { task: task.goal, n: task.actions })}</span>}
            <span className="sr-only">, {t(`planDoc.status.${status}`)}</span>
          </span>
        </li>;
      })}</ol>}
  </section>;
}
