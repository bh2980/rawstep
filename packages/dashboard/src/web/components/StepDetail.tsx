import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Hint, RunPlanView, StepView } from '../../shared/api';
import type { RunRecord } from '../../shared/config';
import { describeChange } from '../i18n/labels';
import { describeHint, describeStep } from '../lib/describe';
import { describeRule } from '../lib/describeRule';
import { servedTask, triggerLabel } from '../lib/plan';
import { sameSpeech } from '../lib/stepDots';
import { Dash } from './PageHeader';
import { RawRecord } from './RawRecord';
import { StepScreen } from './StepEvidence';
import { ModelCalls } from './trace/PlanDocumentView';
import { SourceLabel } from './trace/SourceMarker';
import { Collapsible, CollapsibleContent } from './ui/collapsible';
import { Disclosure } from './layout/Disclosure';
import { Button } from './ui/button';

type Props = {
  step: StepView;
  /** Every step of the run, for what was heard before and which page the run was on. */
  steps: StepView[];
  experimentId: string; run: RunRecord;
  /** Every hint of the run with its details. */
  hints: Hint[];
  /** Goal rules that were already true before the first action; shown on step 0 only. */
  baselineMet: number | undefined;
  live: boolean;
  plan?: RunPlanView | undefined;
  onSelect: (step: number) => void;
};

const MAX_CANDIDATES = 5;
/** Hints the rows above already say in their own words (the plan line, the broken expectation) or that are about the whole run. */
const OWN_ROWS = new Set(['expectation-broken', 'replan', 'task-limit', 'goal-word-stretch', 'early-stop']);

/** `www.example.com/shop/...`: an address without its scheme, as a person reads it. */
const shortUrl = (url: string) => url.replace(/^[a-z]+:\/\//i, '');

/**
 * The selected move, as rows of facts: what was heard, what happened on the page, the plan it followed and what changed in it, the
 * expectations that broke here, the places worth a look, the completion check and the page; then the screenshot, and the planner
 * calls, the options Rawstep chose between and the raw record, all folded.
 */
export function StepDetail({ step, steps, experimentId, run, hints, baselineMet, live, plan, onSelect }: Props) {
  const { t } = useTranslation();
  const index = steps.indexOf(step), before = index > 0 ? steps[index - 1] : undefined, after = steps[index + 1];
  const mine = hints.filter(hint => hint.steps.includes(step.step));
  const broken = mine.filter(hint => hint.kind === 'expectation-broken');
  const inspect = mine.filter(hint => !OWN_ROWS.has(hint.kind));
  const lines = step.speech?.lines.filter(line => line.trim()) ?? [];
  const title = step.step === 0 ? t('runDetail.startTitle') : t('runDetail.stepTitle', { n: step.step, action: describeStep(step) });

  const happened: ReactNode[] = [
    step.ok === false && <span className="text-gave-up">{t('runDetail.cellFailed')}</span>,
    step.stop?.source && t('steps.stopSource', { source: t(`steps.stopSources.${step.stop.source}`, { defaultValue: step.stop.source }) }),
    ...step.observed.map(change => describeChange(change)),
    step.step === 0 && baselineMet !== undefined && (baselineMet > 0 ? t('steps.baselineTrue', { n: baselineMet }) : t('steps.baselineNone')),
    step.redacted && <span className="text-ink-2">{t('steps.redactedBody')}</span>,
  ].filter(Boolean);

  const served = plan?.stepTasks[step.step], task = plan ? servedTask(plan, step.step) : undefined;
  const revisions = (plan?.versions ?? []).filter(version => version.step === step.step && version.version > 1);
  const planLines: ReactNode[] = plan ? [
    ...revisions.map(version => t('runDetail.planChange', { from: version.version - 1, to: version.version, trigger: triggerLabel(version.trigger) })),
    task && served && t('runDetail.planTask', { version: served.planVersion, task: `${task.number} ${task.goal}`.trim() }),
    ...(step.plan?.events ?? []).filter(event => event.kind === 'limit').map(() => t('stepDetail.plan.limit')),
  ].filter(Boolean) : [];

  const check = step.verification, written = run.snapshot.spec.task.verify.all;
  const page = [...steps.slice(0, index + 1)].reverse().flatMap(item => item.observed).find(change => change.kind === 'navigation' && change.url)?.url ?? run.snapshot.spec.task.url;
  // A stop has no evidence of its own; it shows the screen it stopped on.
  const screenStep = step.stop && !step.screenshot && before?.screenshot ? before : step;

  return <section aria-labelledby="step-detail-title" className="min-w-0">
    <div className="mb-1 flex h-8 items-center gap-2">
      <h3 id="step-detail-title" className="min-w-0 truncate text-md font-semibold">{title}</h3>
      <span className="ml-auto flex shrink-0 gap-2">
        <Button variant="outline" size="sm" disabled={!before} onClick={() => before && onSelect(before.step)}>{t('pager.previous')}</Button>
        <Button variant="outline" size="sm" disabled={!after} onClick={() => after && onSelect(after.step)}>{t('pager.next')}</Button>
      </span>
    </div>
    <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 [&>dd]:border-b [&>dd]:border-edge [&>dd]:py-1.5 [&>dt]:border-b [&>dt]:border-edge [&>dt]:py-1.5 [&>dt]:text-ink-2">
      <dt>{t('runDetail.kvHeard')}</dt>
      <dd className="break-words">{lines.length ? <>{lines.map(line => `“${line}”`).join(' ')}{step.step > 0 && sameSpeech(step, before) && <span className="text-ink-2"> · {t('runDetail.sameAsBefore')}</span>}</> : <Dash />}</dd>
      <dt>{t('runDetail.kvHappened')}</dt>
      <dd className="grid gap-0.5 break-words">{happened.length ? happened.map((line, i) => <span key={i}>{line}</span>) : <Dash />}</dd>
      {plan && <><dt>{t('runDetail.kvPlan')}</dt>
        <dd className="grid gap-0.5 tabular-nums">{planLines.length ? planLines.map((line, i) => <span key={i}>{line}</span>) : <Dash />}</dd></>}
      {broken.length > 0 && <><dt>{t('runDetail.kvBroken')}</dt>
        <dd className="grid gap-0.5">{broken.map((hint, i) => { const a = hint.detail.assumption as { id?: string; text?: string } | undefined;
          return <span key={i}>{[a?.id, a?.text].filter(Boolean).join(' · ') || describeHint(hint)}</span>; })}</dd></>}
      {inspect.length > 0 && <><dt>{t('runDetail.kvInspect')}</dt>
        <dd className="grid gap-1">{inspect.map((hint, i) => <span key={i} title={hint.source === 'model' ? t('runPage.modelHintNote') : undefined}>
          {describeHint(hint)}{hint.certainty === 'suspected' && <span className="text-ink-2"> · {t('taskPage.suspected')}</span>}
          {hint.source === 'model' && <> <SourceLabel source="model" className="align-middle" /></>}
        </span>)}</dd></>}
      {check && check.rules.length > 0 && <><dt>{t('runDetail.kvCheck')}</dt>
        <dd title={check.rules.map(rule => `${written[rule.ruleIndex] ? describeRule(written[rule.ruleIndex]!) : rule.ruleType} · ${rule.passed ? t('steps.ruleMet') : t('steps.ruleUnmet')}`).join('\n')} className="tabular-nums">
          {t('steps.verificationCount', { met: check.rules.filter(rule => rule.passed).length, total: check.rules.length })}
        </dd></>}
      <dt>{t('runDetail.kvPage')}</dt>
      <dd className="truncate text-ink-2" title={page}>{page ? shortUrl(page) : <Dash />}</dd>
    </dl>
    <StepScreen step={screenStep} experimentId={experimentId} runId={run.id} live={live && screenStep === step}
      caption={screenStep !== step ? t('runDetail.stopEvidence', { n: screenStep.step }) : undefined} />
    <div className="mt-3 grid">
      {step.calls && step.calls.length > 0 && <Fold label={t('runDetail.calls', { count: step.calls.length })}><ModelCalls step={step.step} calls={step.calls} /></Fold>}
      <Candidates step={step} />
      <Fold label={t('stepDetail.raw')}><RawRecord experimentId={experimentId} run={run} step={step.step} /></Fold>
    </div>
  </section>;
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  return <Collapsible className="border-b border-edge py-0.5">
    <Disclosure label={label} />
    <CollapsibleContent className="motion-reveal pt-1 pb-3">{children}</CollapsibleContent>
  </Collapsible>;
}

/** The actions the page allowed when Rawstep followed the plan, in the order it saw them; the one it took is marked. */
function Candidates({ step }: { step: StepView }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const follow = step.follow;
  if (!follow) return null;
  const candidates = follow.candidates ?? [];
  const shown = all ? candidates : candidates.slice(0, MAX_CANDIDATES);
  return <Fold label={t('stepDetail.candidates')}>
    {candidates.length === 0 && <p><span className="text-ink-2">{t('stepDetail.chosen')}:</span> <span className="font-mono">{follow.choiceId}</span></p>}
    <ul className="grid gap-1">
      {shown.map(candidate => {
        const pick = candidate.id === follow.choiceId, name = candidate.label ?? candidate.id;
        return <li key={candidate.id} className="truncate text-sm" title={name}>
          {pick && <span className="mr-1 text-ink-2">[{t('stepDetail.chosenMark')}]</span>}<span className={pick ? 'font-semibold' : undefined}>{name}</span>
        </li>;
      })}
    </ul>
    {candidates.length > MAX_CANDIDATES && <Button variant="ghost" size="sm" className="mt-1 -ml-2" aria-expanded={all} onClick={() => setAll(!all)}>
      {all ? t('steps.candidateCount', { n: MAX_CANDIDATES, count: MAX_CANDIDATES }) : t('steps.showAllCandidates', { n: candidates.length, count: candidates.length })}
    </Button>}
  </Fold>;
}
