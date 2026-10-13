import { useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModelKind } from '@rawstep/project/config';
import type { Hint, RunPlanView, StepView } from '../../shared/api';
import type { RunRecord } from '../../shared/config';
import { describeChange, hintKindLabel } from '../i18n/labels';
import { describeHint, describeStep } from '../lib/describe';
import { describeRule } from '../lib/describeRule';
import { cn } from '../lib/utils';
import { InfoTip } from './layout/InfoTip';
import { Disclosure } from './layout/Disclosure';
import { RawRecord } from './RawRecord';
import { StepEvidence } from './StepEvidence';
import { GlyphMark } from './trace/TraceRail';
import { ModelCalls } from './trace/PlanDocumentView';
import { servedTask, taskName, triggerLabel } from '../lib/plan';
import { SourceLabel } from './trace/SourceMarker';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent } from './ui/collapsible';

type Props = {
  step: StepView; experimentId: string; run: RunRecord; modelKind: ModelKind;
  /** The nearest earlier step with a screenshot, for the Before view of the evidence. */
  previous: StepView | undefined;
  /** The step just before this one: a stop has no evidence of its own, so it shows what the model was looking at when it chose. */
  before?: StepView | undefined;
  /** The hints that point at this step, with their details. */
  hints: Hint[];
  /** Goal rules that were already true before the first action; shown on step 0 only. */
  baselineMet: number | undefined;
  live: boolean;
  /** The run's plan document, when a planner wrote one. */
  plan?: RunPlanView | undefined;
};

const MAX_CANDIDATES = 5;
const label = 'text-xs leading-4 font-medium';

/**
 * One step, in the order a person investigates it: the evidence (screen or speech, by mode), the action, what the page did in
 * response, the places worth a look, and only then the model's candidates and the raw record, both closed.
 * Wide: evidence 3fr beside analysis 2fr. Narrow: the action first, then evidence, response, inspect.
 */
export function StepDetail({ step, experimentId, run, modelKind, previous, before, hints, baselineMet, live, plan }: Props) {
  const { t } = useTranslation();
  const speechFirst = run.snapshot.spec.mode === 'screenreader';
  return <section aria-label={t('runPage.stepLabel')} className="motion-reveal grid items-start gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <Action step={step} baselineMet={baselineMet} />
    <div className="min-w-0 lg:col-start-1 lg:row-span-6 lg:row-start-1">
      {step.stop && !step.speech && !step.screenshot && before
        ? <div className="grid gap-2">
          <p className="text-xs leading-5 text-muted-foreground">{before.step === 0 ? t('stepDetail.stopEvidenceStart') : t('stepDetail.stopEvidence', { n: before.step })}</p>
          <StepEvidence step={before} previous={undefined} experimentId={experimentId} runId={run.id} speechFirst={speechFirst} live={false} />
        </div>
        : <StepEvidence step={step} previous={previous} experimentId={experimentId} runId={run.id} speechFirst={speechFirst} live={live} />}
    </div>
    <PageResponse step={step} />
    {hints.length > 0 && <Inspect hints={hints} />}
    <Verification step={step} run={run} />
    <PlanNotes step={step} plan={plan} />
    {step.calls && (plan || step.calls.length > 1) && <div className="border-t pt-2.5 lg:col-start-2"><ModelCalls step={step.step} calls={step.calls} plan={plan} /></div>}
    <Candidates step={step} modelKind={modelKind} />
    <Collapsible className="border-t pt-2.5 lg:col-start-2">
      <Disclosure label={t('stepDetail.raw')} />
      <CollapsibleContent className="motion-reveal pt-3"><RawRecord experimentId={experimentId} run={run} step={step.step} /></CollapsibleContent>
    </Collapsible>
  </section>;
}

/** The action in large mono under its number. The rule on its left continues into the page response: action → response is the basic unit of the trace. */
function Action({ step, baselineMet }: { step: StepView; baselineMet: number | undefined }) {
  const { t } = useTranslation();
  const first = step.step === 0;
  return <div className="grid min-w-0 gap-1 border-l-2 border-trace pl-4 lg:col-start-2">
    <h3 className={cn(label, 'text-muted-foreground')}>{first ? t('stepDetail.actionStart') : t('stepDetail.action', { n: step.step })}</h3>
    <p className="font-mono text-xl leading-7 font-semibold break-words">{describeStep(step)}</p>
    {step.ok === false && <p className="w-fit rounded-sm border border-edge-strong px-1.5 text-xs">{t('steps.actionFailed')}</p>}
    {step.stop?.source && <p className="text-xs text-muted-foreground">{t('steps.stopSource', { source: t(`steps.stopSources.${step.stop.source}`, { defaultValue: step.stop.source }) })}</p>}
    {first && baselineMet !== undefined && <p className="text-sm text-muted-foreground">{baselineMet > 0 ? t('steps.baselineTrue', { n: baselineMet }) : t('steps.baselineNone')}</p>}
    {step.redacted && <p className="text-xs text-muted-foreground">{t('steps.redactedBody')}</p>}
  </div>;
}

/** What the page did right after the action: the changes the observer recorded, most often where focus went. */
function PageResponse({ step }: { step: StepView }) {
  const { t } = useTranslation();
  if (step.step === 0 && step.observed.length === 0) return null;
  return <div className="grid min-w-0 gap-1 border-l-2 border-trace pl-4 lg:col-start-2 lg:-mt-5 lg:pt-1">
    <h3 className={cn(label, 'text-muted-foreground')}>{t('stepDetail.pageResponse')}</h3>
    {step.observed.length > 0
      ? <ul className="grid gap-0.5 text-[15px] leading-6 font-medium">{step.observed.map((change, index) => <li key={index}>{describeChange(change)}</li>)}</ul>
      : <p className="text-sm text-muted-foreground">{t('stepDetail.pageResponseNone')}</p>}
  </div>;
}

/** The places worth a look at this step, in amber. A suspected one says so in words; a hint about the model's own choice names its source. */
function Inspect({ hints }: { hints: Hint[] }) {
  const { t } = useTranslation();
  return <section aria-label={t('stepDetail.inspect')} className="grid gap-2.5 rounded-md border border-inspect bg-inspect-soft p-3 lg:col-start-2">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-inspect"><GlyphMark kind="inspect" className="scale-90" />{t('stepDetail.inspect')}<InfoTip term={t('stepDetail.inspect')}>{t('help.inspect')}</InfoTip></h3>
    <ul className="grid gap-2.5">{hints.map((hint, index) => <li key={index} className="grid gap-1">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
        <span className="text-sm font-semibold">{hintKindLabel(hint.kind)}</span>
        {hint.source === 'model' && <SourceLabel source="model" />}
        {hint.certainty === 'suspected' && <span className="text-xs font-medium">{t('taskPage.suspected')}</span>}
      </div>
      <p className="text-sm leading-6">{describeHint(hint)}</p>
      {hint.source === 'model' && <p className="text-xs leading-5 text-muted-foreground">{t('runPage.modelHintNote')}</p>}
    </li>)}</ul>
  </section>;
}

/**
 * The completion check as it stood right after this action. It is re-run after every action and may still be unmet while the run
 * goes on; the run's own result comes from the check after its last action, which is a different thing from this line.
 */
function Verification({ step, run }: { step: StepView; run: RunRecord }) {
  const { t } = useTranslation();
  const check = step.verification;
  if (!check || !check.rules.length) return null;
  const met = check.rules.filter(rule => rule.passed).length, written = run.snapshot.spec.task.verify.all;
  return <div className="grid gap-1.5 lg:col-start-2">
    <h3 className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">{t('stepDetail.verification')}
      <span className="text-[13px] font-normal text-muted-foreground">{t('steps.verificationCount', { met, total: check.rules.length })}</span>
      <InfoTip term={t('stepDetail.verification')}>{t('stepDetail.verificationInfo')}</InfoTip>
    </h3>
    <ul className="grid gap-1 text-[13px]">
      {check.rules.map(rule => <li key={rule.ruleIndex} className="flex items-start gap-1.5">
        {rule.passed ? <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : <Minus aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
        <span className={rule.passed ? undefined : 'text-muted-foreground'}>{written[rule.ruleIndex] ? describeRule(written[rule.ruleIndex]) : rule.ruleType} · {rule.passed ? t('steps.ruleMet') : t('steps.ruleUnmet')}</span>
      </li>)}
    </ul>
  </div>;
}

/**
 * With a planner: the task of the plan document this action served, and what happened to the plan in this step — a new version and
 * why, a task finished, the replanning limit. A new version marks where the run needed help: the page may have made that point
 * hard, or the plan may have been wrong.
 */
function PlanNotes({ step, plan }: { step: StepView; plan: RunPlanView | undefined }) {
  const { t } = useTranslation();
  const events = step.plan?.events ?? [], task = plan ? servedTask(plan, step.step) : undefined, served = plan?.stepTasks[step.step];
  if (!task && !events.length && !step.plan?.stepGoal) return null;
  return <div className="grid gap-2 border-t pt-2.5 lg:col-start-2">
    <h3 className={cn(label, 'text-model')}>{t('stepDetail.plan.title')}</h3>
    {task && served ? <p className="text-sm"><span className="text-muted-foreground">{t('stepDetail.plan.task')}:</span> <span className="font-mono text-xs">{task.number}</span> {task.goal} <span className="text-xs text-muted-foreground">(v{served.planVersion})</span></p>
      : step.plan?.stepGoal && <p className="text-sm"><span className="text-muted-foreground">{t('stepDetail.plan.task')}:</span> {step.plan.stepGoal}</p>}
    {events.length > 0 && <ul className="grid gap-1 text-sm">
      {events.map((event, i) => <li key={i}>
        {event.kind === 'step-done' && <span><span className="text-muted-foreground">{t('stepDetail.plan.taskDone')}:</span> {plan ? taskName(plan, event.goal) : event.goal}</span>}
        {event.kind === 'limit' && <span className="text-inspect">{t('stepDetail.plan.limit')}</span>}
        {event.kind === 'plan' && <span className="font-medium">{event.reason === 'start' ? t('stepDetail.plan.first') : t('stepDetail.plan.revised', { trigger: triggerLabel(event.reason) })}</span>}
      </li>)}
    </ul>}
  </div>;
}

const score = (value: number) => value.toFixed(2);

/**
 * What the model chose between, closed by default. A Decision model gives one score per candidate (a raw model score, not a
 * probability: bars and numbers, no percent sign); an LLM gives none, so only the candidate it picked is shown.
 */
function Candidates({ step, modelKind }: { step: StepView; modelKind: ModelKind }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const model = step.model;
  if (!model) return null;
  const candidates = [...(model.candidates ?? [])].sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1));
  const chosen = candidates.find(candidate => candidate.id === model.choiceId);
  const shown = all ? candidates : candidates.slice(0, MAX_CANDIDATES);
  return <Collapsible className="border-t pt-2.5 lg:col-start-2">
    <Disclosure label={t('stepDetail.candidates')} />
    <CollapsibleContent className="motion-reveal grid gap-2 pt-2">
      {modelKind === 'llm'
        ? <>
          <p className="text-sm"><span className="text-muted-foreground">{t('stepDetail.chosen')}:</span> <span className="font-mono">{chosen?.label ?? chosen?.id ?? model.choiceId}</span></p>
          <p className="text-xs leading-5 text-muted-foreground">{t('stepDetail.llmNote')}</p>
        </>
        : <>
          {candidates.length === 0 && <p className="text-sm"><span className="text-muted-foreground">{t('stepDetail.chosen')}:</span> <span className="font-mono">{model.choiceId}</span></p>}
          <ul className="grid gap-1.5">
            {shown.map(candidate => {
              const pick = candidate.id === model.choiceId, name = candidate.label ?? candidate.id, value = candidate.probability;
              return <li key={candidate.id} className="grid grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_2.5rem] items-center gap-2 text-xs">
                <span className={cn('truncate font-mono', pick && 'font-semibold')} title={name}>{pick && <span className="mr-1 font-sans">[{t('stepDetail.chosenMark')}]</span>}{name}</span>
                {value === undefined ? <span /> : <span aria-hidden="true" className="h-1.5 rounded-[2px] bg-edge"><span className={cn('block h-full rounded-[2px]', pick ? 'bg-model' : 'bg-muted-foreground')} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></span>}
                <span className="text-right font-mono tabular-nums">{value === undefined ? '' : <><span className="sr-only">{t('stepDetail.score', { score: score(value) })}</span><span aria-hidden="true">{score(value)}</span></>}</span>
              </li>;
            })}
          </ul>
          {candidates.length > MAX_CANDIDATES && <Button variant="ghost" size="xs" className="justify-self-start" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? t('steps.candidateCount', { n: MAX_CANDIDATES }) : t('steps.showAllCandidates', { n: candidates.length })}
          </Button>}
          <p className="text-xs text-muted-foreground">{t('stepDetail.scoreNote')}</p>
        </>}
      <p className="font-mono text-xs text-muted-foreground">{[model.modelId, model.inferenceMs !== undefined ? t('steps.inference', { ms: Math.round(model.inferenceMs) }) : undefined].filter(Boolean).join(' · ')}</p>
    </CollapsibleContent>
  </Collapsible>;
}
