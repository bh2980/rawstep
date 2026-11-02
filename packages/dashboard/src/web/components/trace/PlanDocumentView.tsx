import { useId, useState } from 'react';
import { Check, ChevronRight, Circle, CircleDot, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModelCall, PlanDocument, PlanTask, RunPlanView, StepView } from '../../../shared/api';
import { t as translate } from '../../i18n';
import { describeStep } from '../../lib/describe';
import { endingLabel, hitMoveLimit, placedTasks, replanCount, speechChanged, taskName, taskSteps, triggerLabel, type PlacedTask } from '../../lib/plan';
import { cn } from '../../lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

type Props = {
  plan: RunPlanView; steps: StepView[];
  /** Moves on one task without hearing anything new before Rawstep asks for a new plan (the run's rules). */
  actionLimit: number;
  /** The step shown below the plan; picking an action here selects it. */
  selectedStep: number | undefined; onSelectStep: (step: number) => void;
  live: boolean;
};

const label = 'text-xs leading-4 font-medium text-ink-2';

/** A task's state as a mark that is never colour alone: a check, a dot, an empty circle, a cross or a warning sign. */
export function TaskMark({ status, className }: { status: PlanTask['status']; className?: string }) {
  const base = cn('size-4 shrink-0', className);
  switch (status) {
    case 'done': return <Check aria-hidden="true" className={cn(base, 'text-reach')} />;
    case 'active': return <CircleDot aria-hidden="true" className={cn(base, 'text-foreground')} />;
    case 'abandoned': return <X aria-hidden="true" className={cn(base, 'text-ink-2')} />;
    case 'failed': return <TriangleAlert aria-hidden="true" className={cn(base, 'text-foreground')} />;
    default: return <Circle aria-hidden="true" className={cn(base, 'text-edge-strong')} />;
  }
}

/**
 * The run as its plan document (planned runs): on the left the document — goal, success criteria, strategy and assumptions, phases of
 * numbered tasks with their state, retired tasks struck through with why, a version picker and the revision history with the
 * planner's own reasons; on the right the picked task — its completion cue, state, actions against the limit, and the actions it
 * took with what was heard, then the model calls of the picked action in order.
 */
export function PlanDocumentView({ plan, steps, actionLimit, selectedStep, onSelectStep, live }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const newest = plan.document.version;
  const [version, setVersion] = useState<number>();
  const doc = version !== undefined ? plan.documents[version] ?? plan.document : plan.document;
  // The picked task: chosen here, else the task of the picked step, else the current task, else the first one.
  const [picked, setPicked] = useState<string>();
  const tasks = placedTasks(doc);
  const fromStep = selectedStep !== undefined ? plan.stepTasks[selectedStep]?.taskId : undefined;
  const taskId = [picked, fromStep, doc.current, tasks[0]?.id].find(candidate => candidate && tasks.some(task => task.id === candidate));
  const task = tasks.find(item => item.id === taskId);
  return <section aria-labelledby={id + '-title'} className="grid items-start gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-edge pb-1.5">
        <h2 id={id + '-title'} className="text-md font-semibold">{t('planDoc.title')}</h2>
        {plan.versions.length > 1 && <div className="flex items-center gap-2">
          <label htmlFor={id + '-version'} className="text-xs text-ink-2">{t('planDoc.version')}</label>
          <Select value={String(doc.version)} onValueChange={value => { setVersion(Number(value) === newest ? undefined : Number(value)); setPicked(undefined); }}>
            <SelectTrigger id={id + '-version'} size="sm" className="h-8 text-base"><SelectValue /></SelectTrigger>
            <SelectContent>{[...plan.versions].reverse().map(v => <SelectItem key={v.version} value={String(v.version)}>
              {t('planDoc.versionOption', { version: v.version, note: v.version === newest ? (live ? t('planDoc.versionLive') : t('planDoc.versionFinal')) : triggerLabel(v.trigger) })}
            </SelectItem>)}</SelectContent>
          </Select>
        </div>}
      </div>
      {plan.redacted && <p className="text-xs leading-5 text-ink-2">{t('planDoc.redacted')}</p>}
      <PlanBody doc={doc} taskId={taskId} onPick={setPicked} />
      <History doc={doc} />
      {live && <p className="text-xs leading-5 text-ink-2">{t('planDoc.liveNote')}</p>}
    </div>
    <div className="min-w-0">
      {task ? <TaskPane plan={plan} doc={doc} task={task} steps={steps} actionLimit={actionLimit} selectedStep={selectedStep} onSelectStep={onSelectStep} />
        : <p className="text-base text-ink-2">{t('planDoc.noTasks')}</p>}
    </div>
  </section>;
}

/**
 * Goal, success criteria, strategy, assumptions, then the phases of tasks; retired tasks sit in their phase, struck through.
 * Tasks dropped by earlier versions pile up when the plan changes often, so they stay folded unless asked for or picked.
 */
function PlanBody({ doc, taskId, onPick }: { doc: PlanDocument; taskId: string | undefined; onPick: (id: string) => void }) {
  const { t } = useTranslation();
  const [showDropped, setShowDropped] = useState(false);
  const dropped = doc.retired.filter(task => task.status === 'abandoned').length;
  const visible = doc.retired.filter(task => showDropped || task.status !== 'abandoned' || task.id === taskId);
  const retiredByPhase = (title: string) => visible.filter(task => task.phase === title);
  const orphans = visible.filter(task => !doc.phases.some(phase => phase.title === task.phase));
  const row = (task: PlacedTask) => <TaskRow key={task.id + (task.retired ? ':r' : '')} doc={doc} task={task} current={doc.current === task.id} picked={taskId === task.id} onPick={() => onPick(task.id)} />;
  return <div className="grid gap-4 text-base">
    <p className="leading-6"><span className="mr-2 text-ink-2">{t('planDoc.goal')}</span>{doc.goal || '—'}{doc.complete && <span className="ml-2 text-xs text-reach">{t('planDoc.complete')}</span>}</p>
    {doc.criteria.length > 0 && <div className="grid gap-1">
      <h3 className={label}>{t('planDoc.criteria')}</h3>
      <ul className="grid gap-0.5">{doc.criteria.map(c => <li key={c.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-2 leading-6">
        <span className="font-mono text-xs leading-6 text-ink-2">{c.id}</span><span>{c.text || '—'}</span>
        <span className={cn('text-xs leading-6', c.status === 'met' ? 'text-reach' : c.status === 'unmet' ? 'text-foreground' : 'text-ink-2')}>{t(`planDoc.criterion.${c.status}`)}</span>
      </li>)}</ul>
    </div>}
    {doc.strategy && <p className="leading-6"><span className="mr-2 text-ink-2">{t('planDoc.strategy')}</span>{doc.strategy}</p>}
    {doc.assumptions.length > 0 && <div className="grid gap-1">
      <h3 className={label}>{t('planDoc.assumptions')}</h3>
      <ul className="grid gap-0.5">{doc.assumptions.map(a => <li key={a.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-2 leading-6">
        <span className="font-mono text-xs leading-6 text-ink-2">{a.id}</span><span>{a.text || '—'}</span>
        <span className={cn('text-xs leading-6', a.status === 'broken' ? 'text-foreground' : a.status === 'held' ? 'text-reach' : 'text-ink-2')}>
          {t(`planDoc.assumption.${a.status}`)}{a.settledIn !== undefined && a.status !== 'open' && ` (v${a.settledIn})`}
        </span>
      </li>)}</ul>
    </div>}
    {dropped > 0 && <button type="button" aria-expanded={showDropped} onClick={() => setShowDropped(value => !value)}
      className="justify-self-start text-xs text-ink-2 underline underline-offset-2 hover:text-foreground">
      {t(showDropped ? 'planDoc.hideDropped' : 'planDoc.showDropped', { count: dropped })}
    </button>}
    <ol aria-label={t('planDoc.phases')} className="grid gap-3">
      {doc.phases.map(phase => {
        const finished = phase.tasks.every(task => task.status !== 'pending' && task.status !== 'active');
        return <li key={phase.id} className="grid gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2 border-b border-edge pb-1">
            <span className="font-semibold">{phase.number}. {phase.title}</span>
            {phase.criteria.length > 0 && <span className="font-mono text-xs text-ink-2">{phase.criteria.join(', ')}</span>}
            <span className="ml-auto text-xs text-ink-2">{phase.checkpoint ? t('planDoc.checkpointDone', { version: phase.checkpoint.version }) : finished ? t('planDoc.phaseDone') : ''}</span>
          </div>
          <ul className="grid">{[...retiredByPhase(phase.title).map(task => ({ ...task, retired: true })), ...phase.tasks.map(task => ({ ...task, phase: phase.title, retired: false }))].map(row)}</ul>
        </li>;
      })}
      {orphans.length > 0 && <li className="grid gap-1">
        <div className="border-b border-edge pb-1 font-semibold">{t('planDoc.retiredGroup')}</div>
        <ul className="grid">{orphans.map(task => row({ ...task, retired: true }))}</ul>
      </li>}
    </ol>
  </div>;
}

function TaskRow({ doc, task, current, picked, onPick }: { doc: PlanDocument; task: PlacedTask; current: boolean; picked: boolean; onPick: () => void }) {
  const { t } = useTranslation();
  const ending = endingLabel(doc, task), struck = task.status === 'abandoned';
  const state = t(`planDoc.status.${task.status}`);
  return <li>
    <button type="button" aria-pressed={picked} onClick={onPick}
      className={cn('grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2 rounded-sm px-1.5 py-1 text-left', picked ? 'bg-raised' : 'hover:bg-raised', current && 'font-medium')}>
      <TaskMark status={task.status} className="mt-0.5" />
      <span className="grid min-w-0 gap-0.5">
        <span className={cn('leading-6', struck && 'text-ink-2 line-through')}>
          <span className="mr-1.5 font-mono text-xs text-ink-2">{task.number}</span>{task.goal || '—'}
          <span className="sr-only">, {state}{current ? `, ${t('planDoc.current')}` : ''}</span>
        </span>
        {(ending || task.addedIn > 1 || current) && <span className="text-xs leading-5 text-ink-2">
          {[current && t('planDoc.current'), task.addedIn > 1 && t('planDoc.addedIn', { version: task.addedIn }), ending].filter(Boolean).join(' · ')}
        </span>}
      </span>
      <span className="font-mono text-xs leading-6 text-ink-2 tabular-nums" title={t('planDoc.actionsTitle')}>{task.actions}</span>
    </button>
  </li>;
}

/** Each version after the first: when and why it was made, in the planner's words, and what it changed. */
function History({ doc }: { doc: PlanDocument }) {
  const { t } = useTranslation();
  const revisions = doc.revisions.filter(r => r.version > 1);
  const all = [...placedTasks(doc)];
  const goal = (id: string) => { const task = all.find(item => item.id === id); return task ? `“${task.goal || task.number}”` : id; };
  const assumption = (id: string) => { const a = doc.assumptions.find(item => item.id === id); return a?.text ? `${id} ${a.text}` : id; };
  if (!revisions.length) return null;
  return <details className="border-t border-edge pt-2">
    <summary className="cursor-pointer text-base font-medium">{t('planDoc.history', { count: revisions.length })}</summary>
    <ol className="mt-2 grid gap-3">{revisions.map(r => <li key={r.version} className="grid gap-1 border-l-2 border-edge-strong pl-3 text-base leading-6">
      <p className="font-medium">{t('planDoc.revisionLine', { from: r.version - 1, to: r.version, step: r.step, trigger: triggerLabel(r.trigger) })}</p>
      {r.rationale && <p><span className="text-ink-2">{t('planDoc.rationale')}</span> “{r.rationale}”</p>}
      {r.broken.length > 0 && <p><span className="text-ink-2">{t('planDoc.broken')}</span> {r.broken.map(assumption).join(', ')}</p>}
      {r.met.length > 0 && <p><span className="text-ink-2">{t('planDoc.met')}</span> {r.met.join(', ')}</p>}
      {(r.abandoned.length > 0 || r.added.length > 0) && <p><span className="text-ink-2">{t('planDoc.changed')}</span> {[
        ...r.abandoned.map(id => t('planDoc.changedAbandoned', { task: goal(id) })), ...r.added.map(id => t('planDoc.changedAdded', { task: goal(id) })),
      ].join(' · ')}</p>}
    </li>)}</ol>
  </details>;
}

/** The picked task: its cue, state, moves (and whether the move limit cut it short), the actions it took and the planner calls of the picked action. */
function TaskPane({ plan, doc, task, steps, actionLimit, selectedStep, onSelectStep }: Omit<Props, 'live'> & { doc: PlanDocument; task: PlacedTask }) {
  const { t } = useTranslation();
  const mine = taskSteps(plan, task.id, steps);
  const callsStep = selectedStep !== undefined && plan.stepTasks[selectedStep]?.taskId === task.id ? selectedStep : mine.at(-1)?.step;
  const calls = callsStep !== undefined ? plan.calls[callsStep] ?? [] : [];
  const verified = task.ending?.verified;
  return <section aria-label={t('planDoc.taskPane')} className="grid gap-3">
    <div className="grid gap-1 border-b border-edge pb-2">
      <p className={label}>{t('planDoc.taskOf', { phase: task.phase || '—' })}</p>
      <h3 className="text-md font-semibold"><span className="mr-2 font-mono text-base text-ink-2">{task.number}</span>{task.goal || '—'}</h3>
      <p className="flex flex-wrap items-center gap-x-2 text-base leading-6">
        <TaskMark status={task.status} /><span>{t(`planDoc.status.${task.status}`)}</span>
        <span className="text-ink-2">· {t('planDoc.moves', { count: task.actions })}{hitMoveLimit(plan, task.id) && ` · ${t('planDoc.limitHit', { limit: actionLimit })}`}</span>
        <span className="text-ink-2">· {t('planDoc.addedVersion', { version: task.addedIn })}</span>
        {verified && <span className="text-ink-2">· {t(`planDoc.verified.${verified}`)}</span>}
      </p>
      <p className="text-base leading-6"><span className="text-ink-2">{t('planDoc.doneCue')}</span> {task.done || '—'}</p>
      <p className="text-base leading-6"><span className="text-ink-2">{t('planDoc.cue')}</span> {task.cue ? <span className="font-mono">"{task.cue}"{task.cueRole || task.cueState ? ` (${[task.cueRole, task.cueState].filter(Boolean).join(', ')})` : ''}</span> : <span className="text-ink-2">{t('planDoc.noCue')}</span>}</p>
      {(task.serves.length > 0 || task.relies.length > 0) && <p className="font-mono text-xs text-ink-2">{[...task.serves, ...task.relies].join(', ')}</p>}
      {endingLabel(doc, task) && task.status !== 'done' && <p className="text-base text-ink-2">{endingLabel(doc, task)}</p>}
    </div>
    {mine.length === 0
      ? <p className="text-base text-ink-2">{t('planDoc.noActions')}</p>
      : <div className="overflow-x-auto border-t border-edge">
        <table className="w-full text-base">
          <caption className="sr-only">{t('planDoc.actionsCaption')}</caption>
          <thead className="text-xs text-ink-2"><tr>
            <th scope="col" className="px-2 py-1.5 text-left font-medium">{t('planDoc.colStep')}</th>
            <th scope="col" className="px-2 py-1.5 text-left font-medium">{t('planDoc.colChosen')}</th>
            <th scope="col" className="px-2 py-1.5 text-left font-medium">{t('planDoc.colResult')}</th>
            <th scope="col" className="px-2 py-1.5 text-left font-medium">{t('planDoc.colHeard')}</th>
          </tr></thead>
          <tbody>
            {mine.map(step => {
              const changed = speechChanged(step, steps), on = step.step === selectedStep;
              return <tr key={step.step} className={cn('border-t border-edge', on && 'bg-raised')}>
                <td className="px-2 py-1"><button type="button" aria-current={on ? 'step' : undefined} onClick={() => onSelectStep(step.step)} className="border-b border-edge-strong tabular-nums hover:border-foreground">{step.step}</button></td>
                <td className="px-2 py-1 font-mono">{describeStep(step)}</td>
                <td className="px-2 py-1 whitespace-nowrap text-ink-2">{[step.ok === false ? t('planDoc.failed') : t('planDoc.ran'), changed === undefined ? undefined : changed ? t('planDoc.changedSpeech') : t('planDoc.unchanged')].filter(Boolean).join(' · ')}</td>
                <td className="max-w-64 truncate px-2 py-1" title={step.speech?.lines.join(' / ')}>{step.redacted && !step.speech ? t('planDoc.hidden') : step.speech?.lines.join(' / ') || '—'}</td>
              </tr>;
            })}
            {task.ending && <tr className="border-t border-edge text-ink-2">
              <td className="px-2 py-1 font-mono tabular-nums">{task.ending.step}</td>
              <td className="px-2 py-1">{t(`planDoc.ending.${task.ending.reason}`)}</td>
              <td className="px-2 py-1" colSpan={2}>{task.ending.verified ? t(`planDoc.verified.${task.ending.verified}`) : '—'}</td>
            </tr>}
          </tbody>
        </table>
      </div>}
    {callsStep !== undefined && calls.length > 0 && <ModelCalls step={callsStep} calls={calls} />}
  </section>;
}

/** The planner calls of one step in the order they were made. */
export function ModelCalls({ step, calls }: { step: number; calls: ModelCall[] }) {
  const { t } = useTranslation();
  return <div className="grid gap-1.5">
    <h4 className={label}>{t('planDoc.callsTitle', { n: step })}</h4>
    <ol className="grid gap-1.5">{calls.map((call, i) => <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 text-base leading-5">
      <span className="font-mono text-ink-2 tabular-nums">{i + 1}</span>
      <span className="grid gap-0.5">
        <span><span className="font-medium">{t('runConditions.roles.planner')}</span>
          <span className="font-mono text-ink-2">{[call.modelId, call.elapsedMs !== undefined ? t('planDoc.seconds', { seconds: (call.elapsedMs / 1000).toFixed(2) }) : undefined].filter(Boolean).map(part => ` · ${part}`).join('')}</span></span>
        <span className="text-ink-2">{t('planDoc.plannerCall', { trigger: triggerLabel(call.trigger ?? 'start'), version: call.version ?? '?' })}</span>
      </span>
    </li>)}</ol>
  </div>;
}

/**
 * The plan document, folded by default under one line: its version, how often it was corrected, the success criteria still unmet,
 * and the goal on the right. Opening it shows the whole document.
 */
export function PlanDocumentFold(props: Props) {
  const { t } = useTranslation();
  const { plan } = props, doc = plan.document;
  const replans = replanCount(plan), unmet = doc.criteria.filter(c => c.status !== 'met').map(c => c.id);
  const summary = [t('planDoc.factVersion', { version: doc.version }), replans > 0 ? t('planDoc.factReplans', { count: replans }) : t('planDoc.factNoReplans'),
    unmet.length > 0 && t('runDetail.planUnmet', { ids: unmet.join(', ') })].filter(Boolean).join(' · ');
  return <Collapsible className="mt-6 border-y border-edge">
    <CollapsibleTrigger asChild>
      <button type="button" className="group/fold flex min-h-10 w-full items-center gap-2 text-left">
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 transition-transform group-aria-expanded/fold:rotate-90" />
        <span className="font-medium">{t('runDetail.planFold')}</span>
        <span className="ml-2 text-ink-2 tabular-nums">{summary}</span>
        {doc.goal && <span className="ml-auto hidden min-w-0 truncate pl-4 text-ink-2 md:block">{t('runDetail.planGoal', { goal: doc.goal })}</span>}
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent className="motion-reveal pt-2 pb-6"><PlanDocumentView {...props} /></CollapsibleContent>
  </Collapsible>;
}
