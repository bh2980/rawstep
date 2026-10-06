import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelKind } from '@rawstep/project/config';
import type { StepView } from '../../../shared/api';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { dotLabel, isUnsure, railKeyTarget, railWindow, stepGlyph, type StepGlyph } from '../../lib/stepDots';
import { cn } from '../../lib/utils';

/** A step drawn at rail size: · move, ● press or page change, ◌ low model certainty, ◎ look here, ▣ the one being viewed, ┄ not run yet. */
export type MarkKind = StepGlyph | 'current' | 'future';

export function GlyphMark({ kind, className }: { kind: MarkKind; className?: string }) {
  const frame = 'grid shrink-0 place-items-center rounded-full';
  switch (kind) {
    case 'move': return <span aria-hidden="true" className={cn(frame, 'size-4', className)}><span className="size-1.5 rounded-full bg-muted-foreground" /></span>;
    case 'press': return <span aria-hidden="true" className={cn(frame, 'size-4 bg-foreground', className)} />;
    case 'unsure': return <span aria-hidden="true" className={cn(frame, 'size-4 border-2 border-dotted border-model', className)} />;
    case 'inspect': return <span aria-hidden="true" className={cn(frame, 'size-4 border-2 border-inspect', className)}><span className="size-1.5 rounded-full bg-inspect" /></span>;
    case 'current': return <span aria-hidden="true" className={cn('grid size-4 shrink-0 place-items-center rounded-[3px] border-2 border-trace', className)}><span className="size-1.5 rounded-[1px] bg-trace" /></span>;
    default: return <span aria-hidden="true" className={cn('grid size-4 shrink-0 place-items-center', className)}><span className="w-3.5 border-t-2 border-dashed border-edge-strong" /></span>;
  }
}

type Props = {
  steps: StepView[]; modelKind: ModelKind;
  /** The step shown below. */
  selected: number | undefined;
  /** How many more steps a live run may still take; drawn as not-yet-run placeholders. */
  remaining: number;
  /** The run is still recording: the newest step gets the active cursor. */
  live: boolean;
  onSelect: (step: number) => void;
};

const MAX_FUTURE = 200;

/**
 * Two rails for one run. The overview rail is a thin tick for every step with the detail window outlined, and a click jumps there.
 * The detail rail shows about 15 steps around the current one with large glyphs and is the keyboard and screen reader surface:
 * one tab stop, Left/Right move across all steps (also outside the window), Home and End go to the first and last.
 */
export function TraceRail({ steps, modelKind, selected, remaining, live, onSelect }: Props) {
  const { t } = useTranslation();
  const wide = useMediaQuery('(min-width: 640px)');
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const focusSelected = useRef(false);
  const index = Math.max(0, steps.findIndex(step => step.step === selected));
  const current = steps[index]?.step;
  const future = live ? Math.min(MAX_FUTURE, Math.max(0, remaining)) : 0;
  const { start, end } = railWindow(steps.length + future, index, wide ? undefined : 9);
  useEffect(() => {
    if (focusSelected.current && current !== undefined) { focusSelected.current = false; buttons.current.get(current)?.focus(); }
  }, [current]);
  const move = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = steps[railKeyTarget(event.key, index, steps.length) ?? -1];
    if (!target) return;
    event.preventDefault();
    if (target.step === current) { buttons.current.get(target.step)?.focus(); return; }
    focusSelected.current = true;
    onSelect(target.step);
  };
  const last = steps.length - 1;
  const tickBase = 'flex h-6 min-w-[3px] max-w-1.5 flex-1 basis-0 items-center justify-center outline-offset-1';
  const ticks = [
    ...steps.map(step => <button key={step.step} type="button" tabIndex={-1} onClick={() => onSelect(step.step)} className={tickBase}>
      <span className={cn('block w-full rounded-[1px]', tick(stepGlyph(step, modelKind), step.step === current))} />
    </button>),
    ...Array.from({ length: future }, (_, i) => <span key={'f' + i} className={tickBase}><span className="h-2 w-full rounded-[1px] bg-edge" /></span>),
  ];
  return <div role="group" aria-label={t('runPage.timelineLabel')} onKeyDown={move} className="grid gap-2">
    <div aria-hidden="true" className="flex items-center gap-px overflow-x-auto rounded-md border bg-card px-2 py-1.5" title={t('runPage.overviewLabel', { count: steps.length })}>
      {ticks.slice(0, start)}
      <span className="flex items-center gap-px rounded-[3px] border border-trace bg-trace-soft px-0.5" style={{ flex: `${end - start} 1 0`, minWidth: (end - start) * 3 + 8, maxWidth: (end - start) * 7 + 6 }}>{ticks.slice(start, end)}</span>
      {ticks.slice(end)}
    </div>
    <div className="flex items-start overflow-x-auto pb-1">
      {start > 0 && <span aria-hidden="true" className="px-1 pt-0.5 text-muted-foreground">‹</span>}
      {Array.from({ length: end - start }, (_, offset) => {
        const i = start + offset, step = steps[i];
        const gap = offset > 0 && <span aria-hidden="true" className={cn('mt-[1.125rem] block h-px w-3 shrink-0 sm:w-4', step ? 'bg-edge-strong' : 'border-t border-dashed border-edge-strong')} />;
        if (!step) {
          const n = (steps.at(-1)?.step ?? -1) + (i - steps.length) + 1;
          return <div key={'future' + i} className="flex items-start">{gap}
            <span role="img" aria-label={t('runPage.dotFuture', { n })} className="grid w-9 shrink-0 justify-items-center gap-1 py-1.5 text-muted-foreground"><GlyphMark kind="future" /><span aria-hidden="true" className="font-mono text-[11px] tabular-nums">{n}</span></span>
          </div>;
        }
        const on = step.step === current, unsure = isUnsure(step, modelKind), label = dotLabel(step, unsure);
        const newest = live && i === last;
        return <div key={step.step} className="flex items-start">{gap}
          <button type="button" ref={node => { if (node) buttons.current.set(step.step, node); else buttons.current.delete(step.step); }}
            tabIndex={on ? 0 : -1} aria-current={on ? 'step' : undefined} aria-label={label} title={label} onClick={() => onSelect(step.step)}
            className={cn('grid w-9 shrink-0 justify-items-center gap-1 rounded-md border border-transparent py-1.5', newest && 'motion-arrive', on ? 'border-trace bg-trace-soft' : 'hover:bg-raised')}>
            <GlyphMark kind={on ? 'current' : stepGlyph(step, modelKind)} />
            <span aria-hidden="true" className={cn('font-mono text-[11px] tabular-nums', on ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{step.step}</span>
          </button>
          {newest && <span aria-hidden="true" className="mt-1.5 ml-0.5 h-7 w-0.5 shrink-0 rounded-full bg-trace" />}
        </div>;
      })}
      {end < steps.length + future && <span aria-hidden="true" className="px-1 pt-0.5 text-muted-foreground">›</span>}
    </div>
  </div>;
}

/** Overview tick looks: height and colour by kind, trace blue and tallest for the current step. */
function tick(kind: StepGlyph, current: boolean): string {
  if (current) return 'h-6 bg-trace';
  switch (kind) {
    case 'inspect': return 'h-5 bg-inspect';
    case 'unsure': return 'h-3.5 bg-model';
    case 'press': return 'h-3.5 bg-foreground';
    default: return 'h-2 bg-edge-control';
  }
}

/** What each glyph on the rails means. The low-certainty mark only exists for Decision models and the not-run mark only while live. */
export function RailLegend({ modelKind, live }: { modelKind: ModelKind; live: boolean }) {
  const { t } = useTranslation();
  const items: { kind: MarkKind; text: string }[] = [
    { kind: 'move', text: t('runPage.legendMove') },
    { kind: 'press', text: t('runPage.legendPress') },
    { kind: 'inspect', text: t('runPage.legendInspect') },
    ...(modelKind === 'decision' ? [{ kind: 'unsure' as const, text: t('runPage.legendUnsure') }] : []),
    { kind: 'current', text: t('runPage.legendCurrent') },
    ...(live ? [{ kind: 'future' as const, text: t('runPage.legendFuture') }] : []),
  ];
  return <ul aria-label={t('runPage.legendLabel')} className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
    {items.map(item => <li key={item.kind} className="flex items-center gap-1.5"><GlyphMark kind={item.kind} className="scale-90" />{item.text}</li>)}
  </ul>;
}
