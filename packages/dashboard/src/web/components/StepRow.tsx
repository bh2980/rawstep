import { useState } from 'react';
import { Check, LoaderCircle, Lock, Minus } from 'lucide-react';
import type { StepView } from '../../shared/api';
import { describeChange } from '../i18n/labels';
import { useTranslation } from 'react-i18next';
import { describeStep } from '../lib/describe';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { HintBadge } from './HintBadge';
import { ScreenshotThumb } from './ScreenshotThumb';

type Props = {
  step: StepView; experimentId: string; runId: string; highlighted: boolean;
  /** Goal rules already true before the first action; shown on step 0 only. */
  baselineMet: number | undefined;
};

const MAX_CANDIDATES = 5;

/** One step of the run: action, screenshot, model scores, observed changes, goal rules and hints. */
export function StepRow({ step, experimentId, runId, highlighted, baselineMet }: Props) {
  const { t } = useTranslation();
  const title = describeStep(step);
  const rowClass = cn('grid scroll-mt-4 gap-4 rounded-lg border p-3 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]', highlighted && 'ring-2 ring-ring');
  return <li id={`step-${step.step}`} aria-current={highlighted ? 'step' : undefined} className={rowClass}>
    <div className="grid content-start gap-2">
      {step.screenshot && !step.redacted
        ? <ScreenshotThumb experimentId={experimentId} runId={runId} eventId={step.screenshot.eventId} step={step.step} className="h-32 w-full" />
        : step.redacted && <Redacted />}
    </div>
    <div className="grid min-w-0 content-start gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">{step.step === 0 ? t('steps.start') : t('steps.stepNumber', { n: step.step })}</span>
        {step.step > 0 && <h4 className="font-medium">{title}</h4>}
        {step.ok === false && <Badge variant="outline">{t('steps.actionFailed')}</Badge>}
        {step.stop?.source && <span className="text-xs text-muted-foreground">{t('steps.stopSource', { source: step.stop.source })}</span>}
        {step.hints.map(kind => <HintBadge key={kind} kind={kind} />)}
      </div>
      {step.step === 0 && baselineMet !== undefined && <p className="text-sm text-muted-foreground">{baselineMet > 0 ? t('steps.baselineTrue', { n: baselineMet }) : t('steps.baselineNone')}</p>}
      {step.redacted && <p className="text-xs text-muted-foreground">{t('steps.redactedBody')}</p>}
      <Changes step={step} />
      <Speech step={step} />
      <Model step={step} />
      <Verification step={step} />
    </div>
  </li>;
}

function Redacted() {
  const { t } = useTranslation();
  return <div className="grid h-32 place-content-center gap-1 rounded-md border border-dashed text-center text-xs text-muted-foreground">
    <Lock className="mx-auto size-5" aria-hidden="true" />{t('steps.redacted')}
  </div>;
}

function Changes({ step }: { step: StepView }) {
  const { t } = useTranslation();
  if (!step.observed.length) return null;
  return <div className="grid gap-1">
    <p className="text-xs font-medium text-muted-foreground">{t('steps.observed')}</p>
    <ul className="flex flex-wrap gap-1.5">
      {step.observed.map((change, index) => <li key={index}><Badge variant="secondary" className="h-auto max-w-full whitespace-normal py-0.5 text-left">{describeChange(change)}</Badge></li>)}
    </ul>
  </div>;
}

function Speech({ step }: { step: StepView }) {
  const { t } = useTranslation();
  if (!step.speech) return null;
  const source = { simulation: t('steps.speechSimulation'), native: t('steps.speechNative'), unspecified: t('steps.speechUnspecified') }[step.speech.provenance];
  return <div className="grid gap-1">
    <p className="text-xs font-medium text-muted-foreground">{t('steps.speech')} · {source}</p>
    <ul className="grid gap-0.5 rounded-md bg-muted/60 p-2 text-xs">{step.speech.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
  </div>;
}

function Model({ step }: { step: StepView }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const model = step.model;
  if (!model) return null;
  const candidates = [...(model.candidates ?? [])].sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1));
  const shown = all ? candidates : candidates.slice(0, MAX_CANDIDATES);
  return <div className="grid gap-1.5">
    <p className="text-xs font-medium text-muted-foreground" title={t('steps.modelScoresHelp')}>
      {t('steps.modelScores')}{model.modelId ? ` · ${model.modelId}` : ''}{model.inferenceMs !== undefined ? ` · ${t('steps.inference', { ms: Math.round(model.inferenceMs) })}` : ''}
    </p>
    {candidates.length === 0 && <p className="text-xs">{t('steps.chosen')}: {model.choiceId}</p>}
    <ul className="grid gap-1.5">
      {shown.map(candidate => {
        const chosen = candidate.id === model.choiceId, label = candidate.label ?? candidate.id;
        const percent = candidate.probability === undefined ? undefined : Math.round(candidate.probability * 100);
        return <li key={candidate.id} className="grid grid-cols-[minmax(0,16rem)_minmax(3rem,1fr)_2.5rem] items-center gap-2 text-xs">
          <span className={cn('truncate', chosen && 'font-semibold')} title={label}>{chosen && <span className="mr-1">[{t('steps.chosen')}]</span>}{label}</span>
          {percent === undefined ? <span /> : <Progress value={percent} aria-label={`${label} ${percent}%`} className="h-1.5" />}
          <span className="text-right tabular-nums text-muted-foreground">{percent === undefined ? '' : `${percent}%`}</span>
        </li>;
      })}
    </ul>
    {candidates.length > MAX_CANDIDATES && <Button variant="ghost" size="xs" className="justify-self-start" aria-expanded={all} onClick={() => setAll(!all)}>
      {all ? t('steps.candidateCount', { n: MAX_CANDIDATES }) : t('steps.showAllCandidates', { n: candidates.length })}
    </Button>}
  </div>;
}

function Verification({ step }: { step: StepView }) {
  const { t } = useTranslation();
  const check = step.verification;
  if (!check || !check.rules.length) return null;
  const met = check.rules.filter(rule => rule.passed).length;
  return <div className="grid gap-1">
    <p className="text-xs font-medium text-muted-foreground">{t('steps.verification')} · {t('steps.verificationCount', { met, total: check.rules.length })}</p>
    <ul className="flex flex-wrap gap-1.5">
      {check.rules.map(rule => <li key={rule.ruleIndex}>
        <Badge variant={rule.passed ? 'secondary' : 'outline'}>
          {rule.passed ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />}
          {rule.ruleType} {rule.passed ? t('steps.ruleMet') : t('steps.ruleUnmet')}
        </Badge>
      </li>)}
    </ul>
  </div>;
}

export function LiveIndicator() {
  const { t } = useTranslation();
  return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t('steps.live')}
  </p>;
}
