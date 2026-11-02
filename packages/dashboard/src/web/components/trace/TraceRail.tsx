import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Hint, RunPlanView, StepView } from '../../../shared/api';
import { dotKind, dotLabel, goalWordHeardAt, planSegments, railKeyTarget, railSpans, sameSpeech, stackRows } from '../../lib/stepDots';
import { servedTask, triggerLabel } from '../../lib/plan';
import type { RunStatus } from '../../lib/runStrip';
import { cn } from '../../lib/utils';
import { SectionHead } from '../PageHeader';
import { StatusShape } from '../StatusMark';

type Props = {
  steps: StepView[];
  hints: Hint[];
  plan?: RunPlanView | undefined;
  /** The step shown below. */
  selected: number | undefined;
  /** The run is still recording: the newest cell arrives with a short motion and there is no end mark yet. */
  live: boolean;
  /** How the run ended, drawn as the last cell's mark. */
  status: RunStatus;
  /** The broken expectations the user's give-up rests on (`A8`), for the label over the end. */
  tried: readonly string[];
  onSelect: (step: number) => void;
};

const MAX_CELL = 32;
const GAP = 2, EVENT_ROW = 16, SPAN_ROW = 24;

/** About how wide a label of 11px text is: Hangul and other wide glyphs take a full em, the rest a little over half. */
function labelWidth(text: string): number {
  let width = 8;
  for (const char of text) width += char.charCodeAt(0) >= 0x1100 ? 11 : 6.2;
  return width;
}

/** The width of an element that may mount later (`present` turns true), kept current as it resizes. */
function useWidth<T extends HTMLElement>(present: boolean) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [present]);
  return [ref, width] as const;
}

/**
 * The Trace Rail: one cell per move on a shared column grid, with the plan version each move followed above it, labelled events over
 * the cells (a broken expectation and the new plan, the goal word heard, the give-up) and brackets under them (the longest stretch
 * without a goal word, runs of identical speech). A move is a short bar, a press a full one, a move that heard the same thing as the
 * one before a hatched bar, a press that did not run a × box, the end the run's status mark. The meaning of each cell is in its name
 * and tooltip, not a legend. The cells are one tab stop: Left/Right move between moves, Home and End go to the first and last.
 */
export function TraceRail({ steps, hints, plan, selected, live, status, tried, onSelect }: Props) {
  const { t } = useTranslation();
  const acted = useMemo(() => steps.filter(step => step.step > 0), [steps]);
  const n = acted.length;
  const [track, width] = useWidth<HTMLDivElement>(n > 0);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const focusSelected = useRef(false);
  const index = acted.findIndex(step => step.step === selected);
  const tabbable = acted[index >= 0 ? index : 0]?.step;
  useEffect(() => {
    if (focusSelected.current && selected !== undefined) { focusSelected.current = false; buttons.current.get(selected)?.focus(); }
  }, [selected]);
  const heardAt = useMemo(() => goalWordHeardAt(steps, hints), [steps, hints]);
  const spans = useMemo(() => railSpans(steps, hints), [steps, hints]);
  const versionAt = useMemo(() => new Map((plan?.versions ?? []).filter(v => v.trigger !== 'start' && v.trigger !== 'checkpoint').map(v => [Math.max(1, v.step), v])), [plan]);
  if (!n) return null;
  const at = (step: number) => { const i = acted.findIndex(item => item.step === step); return i >= 0 ? i : step <= (acted[0]?.step ?? 0) ? 0 : n - 1; };
  // A short run would stretch each cell across the page; cells stop growing at MAX_CELL and the rail stays left-aligned.
  const cell = width > 0 ? Math.min(MAX_CELL, (width - GAP * (n - 1)) / n) : 0;
  const left = (i: number) => i * (cell + GAP);
  const center = (i: number) => left(i) + cell / 2;

  const move = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = acted[railKeyTarget(event.key, index, n) ?? -1];
    if (!target) return;
    event.preventDefault();
    if (target.step === selected) { buttons.current.get(target.step)?.focus(); return; }
    focusSelected.current = true;
    onSelect(target.step);
  };

  // Labels over the cells, from the record only: new plan versions with the expectations that broke, the goal word, the give-up.
  const last = acted[n - 1]!;
  const events: { step: number; text: string; title?: string }[] = [];
  for (const [step, version] of versionAt) events.push({ step, title: triggerLabel(version.trigger),
    text: version.broken.length ? t('runDetail.eventBroken', { ids: version.broken.join(', '), version: version.version }) : t('runDetail.eventReplan', { version: version.version }) });
  if (heardAt !== undefined) events.push({ step: heardAt, text: t('runDetail.eventGoalHeard') });
  if (!live && last.stop) events.push({ step: last.step, text: status === 'gave-up' && tried.length ? t('runDetail.eventGaveUp', { ids: tried.join(', ') }) : t(`status.${status}`) });
  const placed = width > 0 ? events.filter(event => event.step >= acted[0]!.step && event.step <= last.step).map(event => {
    const w = labelWidth(event.text), x = center(at(event.step));
    const start = Math.min(Math.max(0, x - w / 2), Math.max(0, width - w));
    return { ...event, x, start, end: start + w };
  }) : [];
  const eventRows = stackRows(placed, 6), eventLines = placed.length ? Math.min(3, Math.max(...eventRows) + 1) : 0;

  const bracketed = width > 0 ? spans.map(span => {
    const text = span.kind === 'goal-stretch' ? t('runDetail.spanGoal', { count: span.count, from: span.from, to: span.to }) : t('runDetail.spanSame', { speech: (span.speech ?? '').slice(0, 24), count: span.count, from: span.from, to: span.to });
    const start = left(at(span.from)), end = left(at(span.to)) + cell;
    return { ...span, text, start, right: end, end: Math.max(end, start + labelWidth(text)) };
  }) : [];
  const spanRows = stackRows(bracketed, 8), spanLines = bracketed.length ? Math.max(...spanRows) + 1 : 0;

  const segments = plan ? planSegments(plan.versions, last.step) : [];
  const newest = plan?.document.version;
  const stride = n <= 40 ? 5 : n <= 100 ? 10 : n <= 300 ? 25 : 50;
  const columns = { gridTemplateColumns: cell ? `repeat(${n}, ${cell}px)` : `repeat(${n}, minmax(0, 1fr))`, columnGap: GAP };

  return <section aria-labelledby="flow-title" className="mb-6">
    <SectionHead id="flow-title" title={t('runDetail.flow')} count={t('runDetail.stepCount', { n: last.step })} />
    <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-y-1.5">
      {segments.length > 0 && <>
        <span aria-hidden="true" className="text-xs text-ink-2">{t('runDetail.planLane')}</span>
        <div aria-hidden="true" className="grid" style={columns}>
          {segments.map(segment => {
            const task = plan ? servedTask(plan, segment.from) : undefined;
            // Each box spans the actions its plan version served, and says from which action, so its width reads as a range.
            const head = t('runDetail.planFrom', { version: segment.version, step: Math.max(1, segment.from) });
            const label = [head, task && `${task.number} ${task.goal}`.trim()].filter(Boolean).join(' · ');
            return <div key={segment.version} title={label} style={{ gridColumn: `${at(segment.from) + 1} / ${at(segment.to) + 2}` }}
              className={cn('flex h-5 min-w-0 items-center overflow-hidden rounded-xs border border-edge-strong px-1.5 text-xs whitespace-nowrap tabular-nums', segment.version === newest ? 'text-foreground' : 'text-ink-2')}>
              <span className="truncate">{label}</span>
            </div>;
          })}
        </div>
      </>}
      {eventLines > 0 && <>
        <span />
        <div aria-hidden="true" className="relative" style={{ height: eventLines * EVENT_ROW }}>
          {placed.map((event, i) => {
            const row = Math.min(eventRows[i]!, eventLines - 1);
            return <span key={i}>
              <span title={event.title} className="absolute text-xs leading-4 whitespace-nowrap text-foreground" style={{ left: event.start, top: row * EVENT_ROW }}>{event.text}</span>
              <span className="absolute w-px bg-ink-2" style={{ left: event.x, top: (row + 1) * EVENT_ROW, height: (eventLines - 1 - row) * EVENT_ROW + 6 }} />
            </span>;
          })}
        </div>
      </>}
      <span aria-hidden="true" className="text-xs text-ink-2">{t('runDetail.actionLane')}</span>
      <div ref={track} role="group" aria-label={t('runPage.timelineLabel')} onKeyDown={move} className="grid" style={columns}>
        {acted.map((step, i) => {
          const before = steps[steps.indexOf(step) - 1];
          const on = step.step === selected, failed = step.ok === false, end = !!step.stop && !live && i === n - 1;
          const same = !end && !failed && sameSpeech(step, before), heard = step.step === heardAt, press = dotKind(step) === 'press';
          const version = versionAt.get(step.step);
          const label = [dotLabel(step), failed && t('runDetail.cellFailed'), same && t('runDetail.cellSame'), heard && t('runDetail.cellGoal'),
            version && t('runDetail.cellPlan', { version: version.version }), end && t(`status.${status}`)].filter(Boolean).join(', ');
          return <button key={step.step} type="button" ref={node => { if (node) buttons.current.set(step.step, node); else buttons.current.delete(step.step); }}
            tabIndex={step.step === tabbable ? 0 : -1} aria-current={on ? 'step' : undefined} aria-label={label} title={label} onClick={() => onSelect(step.step)}
            className={cn('relative flex h-7 min-w-0 justify-center rounded-xs', end || failed ? 'items-center' : 'items-end bg-raised', failed && 'border border-gave-up',
              on && 'ring-2 ring-trace', live && i === n - 1 && 'motion-arrive')}>
            {end ? <StatusShape status={status} className="size-3" />
              : failed ? <span aria-hidden="true" className="text-md leading-none font-semibold text-gave-up">×</span>
              : <span aria-hidden="true" className={cn('block w-full rounded-xs', press ? 'h-full' : 'h-2.5', heard || press ? 'bg-foreground' : !same && 'bg-ink-3/55')}
                style={same ? { background: 'repeating-linear-gradient(135deg, var(--ink-3) 0 2px, transparent 2px 4px)' } : undefined} />}
          </button>;
        })}
      </div>
      {spanLines > 0 && <>
        <span />
        <div aria-hidden="true" className="relative" style={{ height: spanLines * SPAN_ROW }}>
          {bracketed.map((span, i) => <span key={i} className="absolute border-t border-ink-3 pt-0.5 text-xs leading-4 whitespace-nowrap text-ink-2"
            style={{ left: span.start, width: span.right - span.start, top: spanRows[i]! * SPAN_ROW + 4 }}>
            <span aria-hidden="true" className="absolute -top-1 left-0 h-2 w-px bg-ink-3" />
            <span aria-hidden="true" className="absolute -top-1 right-0 h-2 w-px bg-ink-3" />
            {span.text}
          </span>)}
        </div>
      </>}
      <span />
      <div aria-hidden="true" className="grid text-xs text-ink-3 tabular-nums" style={columns}>
        {acted.map((step, i) => {
          const shown = i === 0 || i === n - 1 || (step.step % stride === 0 && n - 1 - i >= stride / 2);
          return <span key={step.step} className="overflow-visible text-center whitespace-nowrap">{shown ? step.step : ''}</span>;
        })}
      </div>
    </div>
    <RailLegend />
  </section>;
}

/** One line under the rail naming every kind of cell, drawn with the same marks the cells use. */
function RailLegend() {
  const { t } = useTranslation();
  const swatch = (inner: ReactNode, box = 'items-end bg-raised') => <span aria-hidden="true" className={cn('flex h-3.5 w-3 justify-center rounded-xs', box)}>{inner}</span>;
  const items: [ReactNode, string][] = [
    [swatch(<span className="block h-1.5 w-full rounded-xs bg-ink-3/55" />), t('runDetail.legendMove')],
    [swatch(<span className="block h-full w-full rounded-xs bg-foreground" />), t('runDetail.legendPress')],
    [swatch(<span className="block h-1.5 w-full rounded-xs" style={{ background: 'repeating-linear-gradient(135deg, var(--ink-3) 0 2px, transparent 2px 4px)' }} />), t('runDetail.legendSame')],
    [swatch(<span className="text-xs leading-none font-semibold text-gave-up">×</span>, 'items-center border border-gave-up'), t('runDetail.legendFailed')],
    [swatch(<span className="block h-1.5 w-full rounded-xs bg-foreground" />), t('runDetail.legendGoal')],
    [swatch(null, 'bg-raised ring-2 ring-trace'), t('runDetail.legendSelected')],
  ];
  return <p className="mt-3 ml-14 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
    {items.map(([mark, text]) => <span key={text} className="inline-flex items-center gap-1.5 whitespace-nowrap">{mark}{text}</span>)}
  </p>;
}
