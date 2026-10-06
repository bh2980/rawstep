import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelKind } from '@rawstep/project/config';
import type { StepView } from '../../shared/api';
import { dotKind, dotLabel, isUnsure } from '../lib/stepDots';
import { cn } from '../lib/utils';

type Props = {
  steps: StepView[]; modelKind: ModelKind;
  /** The step shown below; the dot is outlined. */
  selected: number | undefined;
  /** Dashed placeholders for the steps a live run may still take. */
  remaining: number;
  /** Scroll the selected dot into view when it changes without a click, i.e. while following a live run. */
  follow: boolean;
  onSelect: (step: number) => void;
};

/**
 * One dot per action, in order. The arrow keys move the selection (one tab stop for the whole line), Home and End jump to the ends.
 * Small grey: a navigation key or intent. Large: an activation, typing, a page change or the start. Amber ring: the step has a hint.
 * Hollow: a Decision model's pick scored under 0.5. Dashed: a step a live run has not taken yet.
 */
export function StepDots({ steps, modelKind, selected, remaining, follow, onSelect }: Props) {
  const { t } = useTranslation();
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const current = steps.some(step => step.step === selected) ? selected : steps[0]?.step;
  useEffect(() => {
    if (follow && current !== undefined) buttons.current.get(current)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [follow, current, steps.length]);
  const move = (event: KeyboardEvent, index: number) => {
    const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: steps.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = steps[Math.min(steps.length - 1, Math.max(0, next))];
    if (!target) return;
    onSelect(target.step);
    buttons.current.get(target.step)?.focus();
  };
  return <div role="group" aria-label={t('runPage.timelineLabel')} className="flex items-center overflow-x-auto px-1 py-2.5">
    {steps.map((step, index) => {
      const kind = dotKind(step), unsure = isUnsure(step, modelKind), hinted = step.hints.length > 0, on = step.step === current;
      return <div key={step.step} className="flex items-center">
        {index > 0 && <span aria-hidden="true" className="block h-0.5 w-5 bg-border" />}
        <button type="button" ref={node => { if (node) buttons.current.set(step.step, node); else buttons.current.delete(step.step); }}
          tabIndex={on ? 0 : -1} aria-pressed={on} aria-label={dotLabel(step, unsure)} title={dotLabel(step, unsure)}
          onClick={() => onSelect(step.step)} onKeyDown={event => move(event, index)}
          className={cn('grid size-9 shrink-0 place-items-center rounded-full outline-offset-1', on && 'bg-primary/10 outline-2 outline-primary')}>
          <span aria-hidden="true" className={cn('block rounded-full box-border', kind === 'move' ? 'size-2.5' : 'size-4',
            unsure ? cn('border-2 bg-transparent', kind === 'move' ? 'border-muted-foreground' : 'border-foreground') : kind === 'move' ? 'bg-muted-foreground' : 'bg-foreground',
            hinted && 'ring-2 ring-warning ring-offset-2 ring-offset-background')} />
        </button>
      </div>;
    })}
    {remaining > 0 && <span aria-hidden="true" className="flex items-center">
      {Array.from({ length: remaining }, (_, index) => <span key={index} className="flex items-center"><span className="block h-0.5 w-5 bg-border/60" /><span className="grid size-9 place-items-center"><span className="block size-2.5 rounded-full border-2 border-dashed border-muted-foreground/60" /></span></span>)}
    </span>}
  </div>;
}

/** What each kind of dot means, in the order they are explained. The hollow dot only exists for Decision models. */
export function DotLegend({ modelKind }: { modelKind: ModelKind }) {
  const { t } = useTranslation();
  return <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" aria-label={t('runPage.legendLabel')}>
    <li className="flex items-center gap-1.5"><span aria-hidden="true" className="block size-2.5 rounded-full bg-muted-foreground" />{t('runPage.legendMove')}</li>
    <li className="flex items-center gap-1.5"><span aria-hidden="true" className="block size-4 rounded-full bg-foreground" />{t('runPage.legendPress')}</li>
    <li className="flex items-center gap-1.5"><span aria-hidden="true" className="box-border block size-3 rounded-full bg-foreground ring-2 ring-warning ring-offset-2 ring-offset-background" />{t('runPage.legendHint')}</li>
    {modelKind === 'decision' && <li className="flex items-center gap-1.5"><span aria-hidden="true" className="box-border block size-3 rounded-full border-2 border-foreground" />{t('runPage.legendUnsure')}</li>}
    <li className="flex items-center gap-1.5"><span aria-hidden="true" className="box-border block size-3 rounded-full border-2 border-dashed border-muted-foreground/60" />{t('runPage.legendFuture')}</li>
  </ul>;
}
