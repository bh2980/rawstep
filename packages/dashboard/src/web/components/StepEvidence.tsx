import { useState } from 'react';
import { ImageOff, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StepView } from '../../shared/api';
import { targetLabel } from '../i18n/labels';
import { screenshotUrl } from '../lib/runs';
import { cn } from '../lib/utils';

type Props = {
  step: StepView;
  /** The nearest earlier step that has a screenshot, for the Before view. */
  previous: StepView | undefined;
  experimentId: string; runId: string;
  /** The screen reader's output is the main evidence (a screen reader run); the screenshot is then secondary. */
  speechFirst: boolean;
  live: boolean;
};

/**
 * What the run was looking at, chosen by mode. Keyboard: the screenshot is an evidence viewport, with a Before | After switch
 * and the focus target named. Screen reader: the transcript of what was read comes first and the screenshot follows, smaller.
 */
export function StepEvidence({ step, previous, experimentId, runId, speechFirst, live }: Props) {
  const speech = <Speech step={step} primary={speechFirst} />;
  const screen = <Screen step={step} previous={speechFirst ? undefined : previous} experimentId={experimentId} runId={runId} live={live} primary={!speechFirst} />;
  return <div className="grid min-w-0 gap-4">{speechFirst ? <>{speech}{step.screenshot && screen}</> : <>{screen}{step.speech && speech}</>}</div>;
}

const frame = 'grid min-h-40 place-content-center gap-1 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground';
const label = 'text-[11px] leading-4 font-medium tracking-[0.08em] uppercase';

function Screen({ step, previous, experimentId, runId, live, primary }: { step: StepView; previous: StepView | undefined; experimentId: string; runId: string; live: boolean; primary: boolean }) {
  const { t } = useTranslation();
  const [time, setTime] = useState<'before' | 'after'>('after');
  const [failed, setFailed] = useState<string>();
  if (step.redacted) return <div className={frame}><Lock className="mx-auto size-5" aria-hidden="true" />{t('steps.redacted')}</div>;
  if (!step.screenshot) return primary ? <div className={frame}>{t('runPage.noScreen')}</div> : null;
  const showBefore = primary && time === 'before' && previous?.screenshot;
  const shown = showBefore ? previous.screenshot! : step.screenshot;
  const src = screenshotUrl(experimentId, runId, shown.eventId);
  const focus = step.observed.find(change => change.kind === 'focus');
  const caption = showBefore ? t('stepDetail.screenBefore', { n: step.step, prev: previous!.step }) : live ? t('runPage.screenLive') : t('stepDetail.screenAfter', { n: step.step });
  return <figure className="grid gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={cn(label, primary ? 'text-foreground' : 'text-muted-foreground')}>{t('stepDetail.screen')}</span>
      {primary && previous?.screenshot && <div role="group" aria-label={t('stepDetail.timeLabel')} className="inline-flex rounded-md border border-edge-strong p-0.5 text-xs">
        {(['before', 'after'] as const).map(option => <button key={option} type="button" aria-pressed={time === option} onClick={() => setTime(option)}
          className={cn('h-6 rounded-[3px] px-2.5', time === option ? 'bg-trace-soft font-medium text-trace' : 'text-muted-foreground hover:bg-raised')}>{t(option === 'before' ? 'stepDetail.timeBefore' : 'stepDetail.timeAfter')}</button>)}
      </div>}
    </div>
    <div className={cn('relative overflow-hidden rounded-md bg-raised', primary ? 'border-2 border-trace' : 'border')}>
      {failed === src
        ? <div className={cn(frame, 'border-0')}><ImageOff className="mx-auto size-5" aria-hidden="true" />{t('steps.screenshotMissing')}</div>
        : <a href={src} target="_blank" rel="noreferrer" aria-label={t('runPage.screenOpen', { n: step.step })} className="block">
          <img src={src} alt={t('steps.screenshot', { n: step.step })} onError={() => setFailed(src)} className={cn('w-full object-contain object-top', primary ? 'max-h-[36rem]' : 'max-h-64')} />
        </a>}
      {primary && focus && !showBefore && <p className="absolute top-2 left-2 flex max-w-[calc(100%-1rem)] items-baseline gap-2 rounded-[3px] border border-trace bg-card/95 px-2 py-1 text-xs">
        <span className="text-[11px] font-medium tracking-[0.08em] text-trace">{t('stepDetail.focus')}</span>
        <span className="truncate font-medium">{targetLabel({ role: focus.role || t('observed.element'), ...(focus.name ? { name: focus.name } : {}) })}</span>
      </p>}
    </div>
    <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
  </figure>;
}

/** The screen reader's output for this step, as the lines it read, with where it came from. */
function Speech({ step, primary }: { step: StepView; primary: boolean }) {
  const { t } = useTranslation();
  const source = step.speech ? { simulation: t('steps.speechSimulation'), native: t('steps.speechNative'), unspecified: t('steps.speechUnspecified') }[step.speech.provenance] : undefined;
  return <section aria-label={t('stepDetail.screenReaderOutput')} className={cn('grid gap-2 rounded-md border bg-card p-4', primary && 'border-edge-strong')}>
    <h3 className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className={cn(label, primary ? 'text-foreground' : 'text-muted-foreground')}>{t('stepDetail.screenReaderOutput')}</span>
      {source && <span className="text-xs text-muted-foreground">{source}</span>}
    </h3>
    {step.speech && step.speech.lines.length > 0
      ? <ol className={cn('grid gap-1.5 leading-7', primary ? 'text-[17px]' : 'text-sm')}>{step.speech.lines.map((line, index) => <li key={index} className="border-l-2 border-edge-strong pl-3">{line}</li>)}</ol>
      : <p className="text-sm text-muted-foreground">{t('stepDetail.noSpeech')}</p>}
  </section>;
}
