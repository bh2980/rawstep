import { Lightbulb } from 'lucide-react';
import type { Hint, RunHintsView } from '../../shared/api';
import { hintKindLabel, ko, limitationLabel } from '../i18n/ko';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Skeleton } from './ui/skeleton';
import { describeHint } from '../lib/describe';

type Props = { hints: RunHintsView | undefined; error: string; loading: boolean; live: boolean; onJump: (step: number) => void };

const groups = [
  { certainty: 'observed', title: ko.hints.observed, help: ko.hints.observedHelp },
  { certainty: 'suspected', title: ko.hints.suspected, help: ko.hints.suspectedHelp },
] as const;

function reachedLine(report: RunHintsView): string {
  if (report.goalReached) return ko.hints.reachedLine;
  return report.outcome?.status === 'failure' ? ko.hints.notReachedLine : ko.hints.unknownLine;
}

/** Friction hints grouped by certainty. Hints point at places worth a human look; they are not verdicts. */
export function HintsPanel({ hints, error, loading, live, onJump }: Props) {
  if (loading && !hints) return <div className="grid gap-3" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  if (!hints) return <p role={live ? 'status' : 'alert'} className="text-sm text-muted-foreground">{live ? ko.hints.pending : `${ko.hints.loadFailed} ${error}`}</p>;
  return <div className="grid gap-6">
    <div className="grid gap-1">
      <p className="text-sm">{live ? ko.hints.liveLine : reachedLine(hints)}</p>
      {!live && hints.reference && <p className="text-sm text-muted-foreground">{ko.hints.referenceLine(hints.steps, hints.reference.steps)}</p>}
    </div>
    {hints.hints.length === 0
      ? <div className="grid place-content-center gap-2 rounded-lg border border-dashed py-14 text-center">
        <Lightbulb className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{ko.hints.empty}</p>
        <p className="max-w-md text-sm text-muted-foreground">{ko.hints.emptyBody}</p>
      </div>
      : groups.map(group => <HintGroup key={group.certainty} {...group} hints={hints.hints.filter(hint => hint.certainty === group.certainty)} onJump={onJump} />)}
    {hints.limitations.length > 0 && <section aria-labelledby="hint-limitations">
      <h3 id="hint-limitations" className="mb-2 text-sm font-medium">{ko.hints.limitations}</h3>
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
  const steps = [...new Set(hint.steps)], text = describeHint(hint);
  return <Card size="sm">
    <CardContent className="grid gap-2">
      <p className="font-medium">{hintKindLabel(hint.kind)}</p>
      <p className="text-sm leading-6 text-muted-foreground" title={text === hint.summary ? undefined : hint.summary}>{text}</p>
      {text !== hint.summary && <details className="text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer">{ko.hints.originalText}</summary>
        <p lang="en" className="mt-1 leading-5">{hint.summary}</p>
      </details>}
      {steps.length > 0 && <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={ko.hints.stepsLabel}>
        {steps.map(step => <Button key={step} variant="outline" size="xs" aria-label={ko.hints.goToStepLabel(step)} onClick={() => onJump(step)}>{ko.hints.goToStep(step)}</Button>)}
      </div>}
    </CardContent>
  </Card>;
}
