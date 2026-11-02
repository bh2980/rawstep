import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ListCollapse } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Hint, RunPlanView, StepView } from '../../../shared/api';
import { hintKindLabel } from '../../i18n/labels';
import { describeStep } from '../../lib/describe';
import { goalWordHeardAt, railSpans, sameSpeech, speechText, stepRows, type StepItem, type StepRow } from '../../lib/stepDots';
import type { RunStatus } from '../../lib/runStrip';
import { cn } from '../../lib/utils';
import { Dash } from '../PageHeader';
import { StatusShape } from '../StatusMark';
import { Button } from '../ui/button';

type Props = {
  steps: StepView[]; hints: Hint[]; plan?: RunPlanView | undefined;
  selected: number | undefined; status: RunStatus; live: boolean;
  onSelect: (step: number) => void;
};

/** Hint kinds the rail and the marks already say in their own way (the plan version, the goal word, the end), left out of the marks. */
const SHOWN_ELSEWHERE = new Set(['goal-word-stretch', 'expectation-broken', 'replan', 'task-limit', 'early-stop', 'slow-run']);

const clip = (text: string, max: number) => text.length > max ? text.slice(0, max - 1) + '…' : text;
const quote = (text: string, max = 40) => `“${clip(text, max)}”`;

/**
 * Every move as a dense row: number, move, what was heard, and marks (did not run, plan version, goal word, same speech, hint kinds).
 * With grouping on, uneventful stretches and repeated identical moves fold into one row each; the folded row opens with its own
 * button, and a group holding the selected move is always open. The rows are one tab stop: Up/Down move the selection, Home and End
 * go to the first and last row; a folded row selects its first move.
 */
export function StepList({ steps, hints, plan, selected, status, live, onSelect }: Props) {
  const { t } = useTranslation();
  const [grouped, setGrouped] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const focusSelected = useRef(false);
  useEffect(() => {
    if (focusSelected.current && selected !== undefined) { focusSelected.current = false; buttons.current.get(selected)?.focus(); }
  }, [selected]);

  const { items, marksOf } = useMemo(() => {
    const heardAt = goalWordHeardAt(steps, hints), spans = railSpans(steps, hints);
    const versions = new Map((plan?.versions ?? []).filter(v => v.trigger !== 'checkpoint' && v.version > 1).map(v => [Math.max(1, v.step), v.version]));
    const marksOf = new Map<number, { marks: string[]; same: boolean; failed: boolean }>();
    const items: StepItem[] = steps.map((step, index) => {
      const failed = step.ok === false, same = step.step > 0 && sameSpeech(step, steps[index - 1]), version = versions.get(step.step);
      const marks = [
        failed && t('runDetail.markFailed'),
        version !== undefined && t('runDetail.markPlan', { version }),
        step.step === heardAt && t('runDetail.markGoal'),
        ...[...new Set(step.hints)].filter(kind => !SHOWN_ELSEWHERE.has(kind)).map(hintKindLabel),
      ].filter((mark): mark is string => !!mark);
      marksOf.set(step.step, { marks, same, failed });
      const inSpan = spans.some(span => step.step >= span.from && step.step <= span.to);
      return { step: step.step, action: describeStep(step), speech: speechText(step), same, marks, notable: marks.length > 0 || inSpan || step.hints.length > 0 || !!step.stop };
    });
    return { items, marksOf };
  }, [steps, hints, plan, t]);
  const rows = useMemo(() => stepRows(items, { grouped, selected, expanded }), [items, grouped, selected, expanded]);
  // Where each group ends, for the fold button of a group the person opened.
  const groupEnds = useMemo(() => new Map(stepRows(items, { grouped: true, expanded: new Set() }).flatMap(row => row.kind === 'group' ? [[row.id, row.steps.at(-1)!] as const] : [])), [items]);
  const byStep = useMemo(() => new Map(steps.map(step => [step.step, step])), [steps]);
  const first = (row: StepRow) => row.kind === 'step' ? row.step : row.steps[0]!;
  const position = rows.findIndex(row => row.kind === 'step' && row.step === selected);
  const tabbable = position >= 0 ? selected : rows[0] ? first(rows[0]) : undefined;
  const toggle = (id: string, open: boolean) => setExpanded(current => { const next = new Set(current); if (open) next.add(id); else next.delete(id); return next; });

  const move = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const at = position >= 0 ? position : 0;
    const target = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const row = rows[Math.min(rows.length - 1, Math.max(0, target))];
    if (!row) return;
    focusSelected.current = true;
    if (first(row) === selected) { focusSelected.current = false; buttons.current.get(selected)?.focus(); return; }
    onSelect(first(row));
  };

  const markLine = (marks: readonly string[], same: boolean, failed: boolean) => {
    const all = [...marks, ...(same ? [t('runDetail.markSame')] : [])];
    return all.map((mark, i) => <span key={i}>{i > 0 && <span aria-hidden="true"> · </span>}<span className={failed && i === 0 ? 'text-gave-up' : undefined}>{mark}</span></span>);
  };
  const ref = (step: number) => (node: HTMLButtonElement | null) => { if (node) buttons.current.set(step, node); else buttons.current.delete(step); };
  const rowButton = 'text-left outline-offset-[-2px] after:absolute after:inset-0 after:content-[""]';

  return <section aria-labelledby="step-list-title" className="min-w-0">
    <div className="mb-1 flex h-8 items-center gap-2">
      <h3 id="step-list-title" className="text-md font-semibold">{t('runDetail.list')}</h3>
      <Button variant="outline" size="sm" className="ml-auto" aria-pressed={grouped} onClick={() => { setGrouped(value => !value); setExpanded(new Set()); }}>
        <ListCollapse aria-hidden="true" />{t('runDetail.groupToggle')}
      </Button>
    </div>
    <table className="-mx-3 w-[calc(100%+1.5rem)] table-fixed border-collapse text-base">
      <caption className="sr-only">{t('runDetail.listLabel')}</caption>
      <colgroup><col className="w-16" /><col className="w-28" /><col /><col className="w-36" /></colgroup>
      <thead><tr className="border-b border-edge">
        {[t('runDetail.colNumber'), t('runDetail.colAction'), t('runDetail.colHeard'), t('runDetail.colMarks')].map(head =>
          <th key={head} scope="col" className="h-8 px-3 text-left text-xs font-medium text-ink-2">{head}</th>)}
      </tr></thead>
      <tbody onKeyDown={move}>
        {rows.map(row => {
          if (row.kind === 'group') {
            const head = items.find(item => item.step === row.steps[0])!, tail = items.find(item => item.step === row.steps.at(-1))!;
            const from = row.steps[0]!, to = row.steps.at(-1)!, count = row.steps.length;
            const marks = [...new Set(row.steps.flatMap(step => marksOf.get(step)?.marks ?? []))];
            const same = row.steps.some(step => marksOf.get(step)?.same);
            const quiet = row.mode === 'quiet';
            return <tr key={row.id} className="row-rail h-8 border-b border-edge hover:bg-raised">
              <td className={cn('px-3 tabular-nums', quiet && 'text-ink-3')}>{from}–{to}</td>
              <td className="truncate px-3">
                <button type="button" ref={ref(from)} tabIndex={from === tabbable ? 0 : -1} onClick={() => onSelect(from)}
                  aria-label={t('runDetail.groupLabel', { from, to, action: head.action, count })} className={cn(rowButton, quiet && 'text-ink-2')}>
                  {t('runDetail.groupCount', { action: head.action, count })}
                </button>
              </td>
              <td className="truncate px-3 text-ink-2">{quiet
                ? head.speech && tail.speech ? t('runDetail.speechRange', { first: clip(head.speech, 24), last: clip(tail.speech, 24) }) : <Dash />
                : head.speech ? <span className="text-foreground">{quote(head.speech)}</span> : <Dash />}</td>
              <td className="truncate px-3 text-ink-2">
                {markLine(marks, same && !quiet, false)}{(marks.length > 0 || (same && !quiet)) && <span aria-hidden="true"> · </span>}
                <button type="button" className="relative z-10 border-b border-edge-strong text-foreground" aria-expanded={false}
                  aria-label={t('runDetail.expandLabel', { from, to })} onClick={() => toggle(row.id, true)}>{t('runDetail.expand')}</button>
              </td>
            </tr>;
          }
          const step = byStep.get(row.step)!, item = marksOf.get(row.step)!, on = row.step === selected;
          return <tr key={row.step} data-selected={on} className={cn('row-rail h-8 border-b border-edge', on ? 'bg-raised' : 'hover:bg-raised', live && step === steps.at(-1) && 'motion-arrive')}>
            <td className="px-3 tabular-nums">{row.step}</td>
            <td className="truncate px-3">
              <button type="button" ref={ref(row.step)} tabIndex={row.step === tabbable ? 0 : -1} aria-current={on ? 'step' : undefined} onClick={() => onSelect(row.step)}
                className={cn(rowButton, 'inline-flex max-w-full items-center gap-1.5')}>
                {step.stop && !live && <StatusShape status={status} />}<span className="truncate">{step.step === 0 ? t('runDetail.startTitle') : describeStep(step)}</span>
              </button>
            </td>
            <td className="truncate px-3" title={speechText(step) || undefined}>{speechText(step) ? quote(speechText(step), 80) : <Dash />}</td>
            <td className="truncate px-3 text-ink-2">
              {markLine(item.marks, item.same, item.failed)}
              {row.collapse && <>{(item.marks.length > 0 || item.same) && <span aria-hidden="true"> · </span>}
                <button type="button" className="relative z-10 border-b border-edge-strong text-foreground" aria-expanded={true}
                  aria-label={t('runDetail.collapseLabel', { from: row.step, to: groupEnds.get(row.collapse) ?? row.step })} onClick={() => toggle(row.collapse!, false)}>{t('runDetail.collapse')}</button></>}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </section>;
}
