import { useState } from 'react';
import { Check, ChevronDown, ImageOff, Lock, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModelKind } from '@rawstep/project/config';
import type { Hint, StepView } from '../../shared/api';
import type { RunRecord } from '../../shared/config';
import { describeChange, hintKindLabel } from '../i18n/labels';
import { describeHint, describeStep } from '../lib/describe';
import { screenshotUrl } from '../lib/runs';
import { cn } from '../lib/utils';
import { RawRecord } from './RawRecord';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Progress } from './ui/progress';

type Props = {
  step: StepView; experimentId: string; run: RunRecord; modelKind: ModelKind;
  /** The hints that point at this step, with their details. */
  hints: Hint[];
  /** Goal rules that were already true before the first action; shown on step 0 only. */
  baselineMet: number | undefined;
  live: boolean;
};

const MAX_CANDIDATES = 5;

/** The one step under the timeline: its screen or speech on the left; the action, observed changes, hints and the model's candidates on the right. */
export function StepDetail({ step, experimentId, run, modelKind, hints, baselineMet, live }: Props) {
  const { t } = useTranslation();
  const speechFirst = run.snapshot.mode === 'screenreader';
  const screen = <Screen step={step} experimentId={experimentId} runId={run.id} live={live} />;
  const speech = <Speech step={step} />;
  return <section aria-label={t('runPage.stepLabel')} className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <div className="grid min-w-0 gap-3">{speechFirst ? <>{speech}{step.screenshot && screen}</> : <>{screen}{speech}</>}</div>
    <div className="grid min-w-0 gap-3.5">
      <div className="grid gap-1">
        <span className="text-[13px] text-muted-foreground">{step.step === 0 ? t('runPage.beforeActions') : t('runPage.stepNumber', { n: step.step })}</span>
        <span className="font-mono text-xl font-semibold break-words">{describeStep(step)}</span>
        {step.ok === false && <Badge variant="outline" className="w-fit">{t('steps.actionFailed')}</Badge>}
        {step.stop?.source && <span className="text-xs text-muted-foreground">{t('steps.stopSource', { source: step.stop.source })}</span>}
      </div>
      {step.step === 0 && baselineMet !== undefined && <p className="text-sm text-muted-foreground">{baselineMet > 0 ? t('steps.baselineTrue', { n: baselineMet }) : t('steps.baselineNone')}</p>}
      {step.redacted && <p className="text-xs text-muted-foreground">{t('steps.redactedBody')}</p>}
      <Changes step={step} />
      {hints.map((hint, index) => <HintBox key={index} hint={hint} />)}
      <Verification step={step} />
      <Candidates step={step} modelKind={modelKind} />
      <Collapsible className="border-t pt-2.5">
        <Disclosure label={t('runPage.raw')} />
        <CollapsibleContent className="pt-3"><RawRecord experimentId={experimentId} run={run} step={step.step} /></CollapsibleContent>
      </Collapsible>
    </div>
  </section>;
}

/** The trigger line of a collapsible: label and a chevron that turns when open. */
export function Disclosure({ label }: { label: string }) {
  return <CollapsibleTrigger asChild>
    <Button type="button" variant="ghost" size="sm" className="group/disclosure -ml-2 justify-self-start text-sm text-muted-foreground">
      <ChevronDown aria-hidden="true" className="transition-transform group-aria-expanded/disclosure:rotate-180" />{label}
    </Button>
  </CollapsibleTrigger>;
}

function Screen({ step, experimentId, runId, live }: { step: StepView; experimentId: string; runId: string; live: boolean }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const frame = 'grid min-h-40 place-content-center gap-1 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground';
  if (step.redacted) return <div className={frame}><Lock className="mx-auto size-5" aria-hidden="true" />{t('steps.redacted')}</div>;
  if (!step.screenshot) return step.speech ? null : <div className={frame}>{t('runPage.noScreen')}</div>;
  if (failed) return <div className={frame}><ImageOff className="mx-auto size-5" aria-hidden="true" />{t('steps.screenshotMissing')}</div>;
  const src = screenshotUrl(experimentId, runId, step.screenshot.eventId);
  return <figure className="grid gap-1.5">
    <a href={src} target="_blank" rel="noreferrer" aria-label={t('runPage.screenOpen', { n: step.step })} className="block overflow-hidden rounded-lg border bg-muted">
      <img src={src} alt={t('steps.screenshot', { n: step.step })} onError={() => setFailed(true)} className="max-h-[32rem] w-full object-contain object-top" />
    </a>
    <figcaption className="text-right text-xs text-muted-foreground">{live ? t('runPage.screenLive') : t('runPage.screenCaption', { n: step.step })}</figcaption>
  </figure>;
}

function Speech({ step }: { step: StepView }) {
  const { t } = useTranslation();
  if (!step.speech) return null;
  const source = { simulation: t('steps.speechSimulation'), native: t('steps.speechNative'), unspecified: t('steps.speechUnspecified') }[step.speech.provenance];
  return <div className="grid gap-1.5 rounded-lg border p-3">
    <h3 className="text-xs font-medium text-muted-foreground">{t('steps.speech')} · {source}</h3>
    <ul className="grid gap-1 text-sm leading-6">{step.speech.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
  </div>;
}

function Changes({ step }: { step: StepView }) {
  const { t } = useTranslation();
  if (!step.observed.length) return null;
  return <div className="grid gap-1">
    <h3 className="text-xs font-medium text-muted-foreground">{t('steps.observed')}</h3>
    <ul className="grid gap-0.5 text-sm leading-6">{step.observed.map((change, index) => <li key={index}>{describeChange(change)}</li>)}</ul>
  </div>;
}

/** A hint at this step in plain words. Hints point at places to look; a suspected one is marked because it may be wrong. */
function HintBox({ hint }: { hint: Hint }) {
  const { t } = useTranslation();
  const text = describeHint(hint);
  return <div className={cn('grid gap-1 rounded-lg border border-warning/60 bg-warning/5 p-3', hint.source === 'model' && 'border-dashed')}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-semibold text-warning">{hintKindLabel(hint.kind)}</h3>
      {hint.certainty === 'suspected' && <Badge variant="outline">{t('taskPage.suspected')}</Badge>}
    </div>
    <p className="text-sm leading-6">{text}</p>
    {hint.source === 'model' && <p className="text-xs leading-5 text-muted-foreground">{t('runPage.modelHintNote')}</p>}
  </div>;
}

function Verification({ step }: { step: StepView }) {
  const { t } = useTranslation();
  const check = step.verification;
  if (!check || !check.rules.length) return null;
  const met = check.rules.filter(rule => rule.passed).length;
  return <div className="grid gap-1">
    <h3 className="text-xs font-medium text-muted-foreground">{t('steps.verification')} · {t('steps.verificationCount', { met, total: check.rules.length })}</h3>
    <ul className="flex flex-wrap gap-1.5">
      {check.rules.map(rule => <li key={rule.ruleIndex}>
        <Badge variant={rule.passed ? 'secondary' : 'outline'}>{rule.passed ? <Check aria-hidden="true" /> : <Minus aria-hidden="true" />}{rule.ruleType} {rule.passed ? t('steps.ruleMet') : t('steps.ruleUnmet')}</Badge>
      </li>)}
    </ul>
  </div>;
}

/**
 * What the model saw when it chose. A Decision model gives a score per candidate (uncalibrated, so not a probability);
 * an LLM gives none, so only the candidate it picked is shown.
 */
function Candidates({ step, modelKind }: { step: StepView; modelKind: ModelKind }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const model = step.model;
  if (!model) return null;
  const candidates = [...(model.candidates ?? [])].sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1));
  const chosen = candidates.find(candidate => candidate.id === model.choiceId);
  const shown = all ? candidates : candidates.slice(0, MAX_CANDIDATES);
  return <Collapsible className="border-t pt-2.5">
    <Disclosure label={t('runPage.candidates')} />
    <CollapsibleContent className="grid gap-2 pt-2">
      {modelKind === 'llm'
        ? <>
          <p className="text-sm"><span className="text-muted-foreground">{t('steps.chosen')}:</span> <span className="font-mono">{chosen?.label ?? chosen?.id ?? model.choiceId}</span></p>
          <p className="text-xs leading-5 text-muted-foreground">{t('runPage.llmNoScores')}</p>
        </>
        : <>
          <h3 className="text-xs font-medium text-muted-foreground" title={t('steps.modelScoresHelp')}>{t('steps.modelScores')}</h3>
          {candidates.length === 0 && <p className="text-sm"><span className="text-muted-foreground">{t('steps.chosen')}:</span> <span className="font-mono">{model.choiceId}</span></p>}
          <ul className="grid gap-1.5">
            {shown.map(candidate => {
              const pick = candidate.id === model.choiceId, label = candidate.label ?? candidate.id;
              const percent = candidate.probability === undefined ? undefined : Math.round(candidate.probability * 100);
              return <li key={candidate.id} className="grid grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_2.5rem] items-center gap-2 text-xs">
                <span className={cn('truncate font-mono', pick && 'font-semibold')} title={label}>{pick && <span className="mr-1 font-sans">[{t('steps.chosen')}]</span>}{label}</span>
                {percent === undefined ? <span /> : <Progress value={percent} aria-label={`${label} ${percent}%`} className="h-1.5" />}
                <span className="text-right tabular-nums text-muted-foreground">{percent === undefined ? '' : `${percent}%`}</span>
              </li>;
            })}
          </ul>
          {candidates.length > MAX_CANDIDATES && <Button variant="ghost" size="xs" className="justify-self-start" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? t('steps.candidateCount', { n: MAX_CANDIDATES }) : t('steps.showAllCandidates', { n: candidates.length })}
          </Button>}
        </>}
      <p className="text-xs text-muted-foreground">{[model.modelId, model.inferenceMs !== undefined ? t('steps.inference', { ms: Math.round(model.inferenceMs) }) : undefined].filter(Boolean).join(' · ')}</p>
    </CollapsibleContent>
  </Collapsible>;
}
