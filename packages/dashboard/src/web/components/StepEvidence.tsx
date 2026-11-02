import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StepView } from '../../shared/api';
import { boxPercent, scaleFocusRect, type Size } from '../lib/focusRect';
import { screenshotUrl } from '../lib/runs';

type Props = { step: StepView; experimentId: string; runId: string; live: boolean; caption?: string | undefined };

/**
 * The diagnostic screenshot of a step, for people only (the model never saw it), with the screen reader cursor outlined where the
 * simulation recorded it. It opens full size in a new tab. Nothing is drawn when there is no picture.
 */
export function StepScreen({ step, experimentId, runId, live, caption }: Props) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState<string>();
  const [natural, setNatural] = useState<{ src: string } & Size>();
  if (step.redacted && !step.screenshot) return <p className="mt-3 text-sm text-ink-2">{t('steps.redacted')}</p>;
  if (!step.screenshot) return null;
  const src = screenshotUrl(experimentId, runId, step.screenshot.eventId);
  const size = natural?.src === src ? natural : undefined;
  const cursor = step.cursor;
  const box = size && cursor ? scaleFocusRect(cursor.rect, { width: cursor.viewport.w, height: cursor.viewport.h }, size) : undefined;
  const note = [caption ?? (live ? t('runPage.screenLive') : step.step === 0 ? t('stepDetail.screenStart') : t('stepDetail.screenAfter', { n: step.step })), t('stepDetail.screenReference')];
  return <figure className="mt-3 grid gap-1.5">
    {failed === src
      ? <p className="text-sm text-ink-2">{t('steps.screenshotMissing')}</p>
      : <a href={src} target="_blank" rel="noreferrer" aria-label={t('runPage.screenOpen', { n: step.step })} className="relative block overflow-hidden rounded-lg border border-edge">
        <img src={src} alt={t('steps.screenshot', { n: step.step })} onError={() => setFailed(src)}
          onLoad={event => setNatural({ src, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          className="block h-auto w-full" />
        {box && size && <span aria-hidden="true" data-focus-outline className="pointer-events-none absolute rounded-xs border-2 border-trace shadow-[0_0_0_2px_rgb(255_255_255/0.85)]" style={boxPercent(box, size)} />}
      </a>}
    <figcaption className="text-sm text-ink-2">{note.join(' · ')}{cursor && <> · {t('stepDetail.cursorNote')}</>}</figcaption>
  </figure>;
}
