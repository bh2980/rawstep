import { Lightbulb } from 'lucide-react';
import type { Hint, RunHintsView } from '../../shared/api';
import { hintKindLabel, limitationLabel } from '../i18n/labels';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Skeleton } from './ui/skeleton';
import { describeHint } from '../lib/describe';

type Props = { hints: RunHintsView | undefined; error: string; loading: boolean; live: boolean; onJump: (step: number) => void };

const groups = [
  { certainty: 'observed', title: 'hints.observed', help: 'hints.observedHelp' },
  { certainty: 'suspected', title: 'hints.suspected', help: 'hints.suspectedHelp' },
] as const;

function reachedLine(report: RunHintsView, t: TFunction): string {
  if (report.goalReached) return t('hints.reachedLine');
  return report.outcome?.status === 'failure' ? t('hints.notReachedLine') : t('hints.unknownLine');
}

/** Friction hints grouped by certainty. Hints point at places worth a human look; they are not verdicts. */
export function HintsPanel({ hints, error, loading, live, onJump }: Props) {
  const { t } = useTranslation();
  if (loading && !hints) return <div className="grid gap-3" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  if (!hints) return <p role={live ? 'status' : 'alert'} className="text-sm text-muted-foreground">{live ? t('hints.pending') : `${t('hints.loadFailed')} ${error}`}</p>;
  return <div className="grid gap-6">
    <div className="grid gap-1">
      <p className="text-sm">{live ? t('hints.liveLine') : reachedLine(hints, t)}</p>
      {!live && hints.reference && <p className="text-sm text-muted-foreground">{t('hints.referenceLine', { steps: hints.steps, referenceSteps: hints.reference.steps })}</p>}
    </div>
    {hints.hints.length === 0
      ? <div className="grid place-content-center gap-2 rounded-lg border border-dashed py-14 text-center">
        <Lightbulb className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{t('hints.empty')}</p>
        <p className="max-w-md text-sm text-muted-foreground">{t('hints.emptyBody')}</p>
      </div>
      : groups.map(group => <HintGroup key={group.certainty} certainty={group.certainty} title={t(group.title)} help={t(group.help)} hints={hints.hints.filter(hint => hint.certainty === group.certainty)} onJump={onJump} />)}
    {hints.limitations.length > 0 && <section aria-labelledby="hint-limitations">
      <h3 id="hint-limitations" className="mb-2 text-sm font-medium">{t('hints.limitations')}</h3>
      <ul className="grid list-disc gap-1 pl-5 text-xs leading-5 text-muted-foreground">
        {hints.limitations.map(item => <li key={item} title={limitationLabel(item) === item ? undefined : item}>{limitationLabel(item)}</li>)}
      </ul>
    </section>}
  </div>;
}

type GroupProps = { certainty: Hint['certainty']; title: string; help: string; hints: Hint[]; onJump: (step: number) => void };

function HintGroup({ certainty, title, help, hints, onJump }: GroupProps) {
  if (!hints.length) return null;
  return <section aria-labelledby={`hints-${certainty}`} className="grid gap-3">
    <div>
      <h3 id={`hints-${certainty}`} className="text-sm font-semibold">{title} <span className="font-normal text-muted-foreground">{hints.length}</span></h3>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
    <ul className="grid gap-3">{hints.map((hint, index) => <li key={`${hint.kind}-${index}`}><HintCard hint={hint} onJump={onJump} /></li>)}</ul>
  </section>;
}

function HintCard({ hint, onJump }: { hint: Hint; onJump: (step: number) => void }) {
  const { t } = useTranslation();
  const steps = [...new Set(hint.steps)], text = describeHint(hint);
  return <Card size="sm">
    <CardContent className="grid gap-2">
      <p className="font-medium">{hintKindLabel(hint.kind)}</p>
      <p className="text-sm leading-6 text-muted-foreground" title={text === hint.summary ? undefined : hint.summary}>{text}</p>
      {text !== hint.summary && <details className="text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer">{t('hints.originalText')}</summary>
        <p lang="en" className="mt-1 leading-5">{hint.summary}</p>
      </details>}
      {steps.length > 0 && <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('hints.stepsLabel')}>
        {steps.map(step => <Button key={step} variant="outline" size="xs" aria-label={t('hints.goToStepLabel', { n: step })} onClick={() => onJump(step)}>{t('hints.goToStep', { n: step })}</Button>)}
      </div>}
    </CardContent>
  </Card>;
}
