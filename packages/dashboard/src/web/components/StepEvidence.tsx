import { useState } from 'react';
import { ImageOff, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StepView } from '../../shared/api';
import { boxPercent, scaleFocusRect, type Size } from '../lib/focusRect';
import { screenshotUrl } from '../lib/runs';
import { cn } from '../lib/utils';

type Props = { step: StepView; experimentId: string; runId: string; live: boolean };

/** What the run heard: the transcript of what was read comes first, and the diagnostic screenshot follows, smaller. */
export function StepEvidence({ step, experimentId, runId, live }: Props) {
  return <div className="grid min-w-0 gap-4"><Speech step={step} />{step.screenshot && <Screen step={step} experimentId={experimentId} runId={runId} live={live} />}</div>;
}

const frame = 'grid min-h-40 place-content-center gap-1 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground';
const label = 'text-xs leading-4 font-medium';

function Screen({ step, experimentId, runId, live }: { step: StepView; experimentId: string; runId: string; live: boolean }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState<string>();
  const [natural, setNatural] = useState<{ src: string } & Size>();
  if (step.redacted) return <div className={frame}><Lock className="mx-auto size-5" aria-hidden="true" />{t('steps.redacted')}</div>;
  if (!step.screenshot) return null;
  const src = screenshotUrl(experimentId, runId, step.screenshot.eventId);
  const size = natural?.src === src ? natural : undefined;
  // The picture marks where the screen reader cursor was, as the simulation recorded it.
  const cursor = step.cursor;
  const box = size && cursor ? scaleFocusRect(cursor.rect, { width: cursor.viewport.w, height: cursor.viewport.h }, size) : undefined;
  const caption = live ? t('runPage.screenLive') : step.step === 0 ? t('stepDetail.screenStart') : t('stepDetail.screenAfter', { n: step.step });
  return <figure className="grid gap-2">
    <span className={cn(label, 'text-muted-foreground')}>{t('stepDetail.screen')}<span className="ml-2 font-normal text-muted-foreground">{t('stepDetail.screenReference')}</span></span>
    {/* The frame hugs the picture: no empty area beside a small screenshot. */}
    <div className="relative w-fit max-w-full justify-self-start overflow-hidden rounded-md border bg-raised">
      {failed === src
        ? <div className={cn(frame, 'border-0')}><ImageOff className="mx-auto size-5" aria-hidden="true" />{t('steps.screenshotMissing')}</div>
        : <a href={src} target="_blank" rel="noreferrer" aria-label={t('runPage.screenOpen', { n: step.step })} className="relative block w-fit max-w-full">
          <img src={src} alt={t('steps.screenshot', { n: step.step })} onError={() => setFailed(src)}
            onLoad={event => setNatural({ src, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            className={cn('block h-auto w-auto max-w-full', cursor ? 'max-h-96' : 'max-h-64')} />
          {box && size && <span aria-hidden="true" data-focus-outline className="pointer-events-none absolute rounded-[2px] border-2 border-trace shadow-[0_0_0_2px_rgb(255_255_255/0.85)]" style={boxPercent(box, size)} />}
        </a>}
    </div>
    <figcaption className="text-xs text-muted-foreground">{caption}{cursor && <> · {t('stepDetail.cursorNote')}</>}</figcaption>
  </figure>;
}

/** The screen reader's output for this step, as the lines it read, with where it came from. */
function Speech({ step }: { step: StepView }) {
  const { t } = useTranslation();
  const source = step.speech ? { simulation: t('steps.speechSimulation'), native: t('steps.speechNative'), unspecified: t('steps.speechUnspecified') }[step.speech.provenance] : undefined;
  return <section aria-label={t('stepDetail.screenReaderOutput')} className="grid gap-2 rounded-md border border-edge-strong bg-card p-4">
    <h3 className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className={cn(label, 'text-foreground')}>{t('stepDetail.screenReaderOutput')}</span>
      {source && <span className="text-xs text-muted-foreground">{source}</span>}
    </h3>
    {step.speech && step.speech.lines.length > 0
      ? <ol className="grid gap-1.5 text-[17px] leading-7">{step.speech.lines.map((line, index) => <li key={index} className="border-l-2 border-edge-strong pl-3">{line}</li>)}</ol>
      : <p className="text-sm text-muted-foreground">{t('stepDetail.noSpeech')}</p>}
  </section>;
}
