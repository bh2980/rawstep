import { useTranslation } from 'react-i18next';
import type { RunState } from '../../../shared/config';
import type { RouteChange } from '../../hooks/useRoute';
import { runGlyphKind, runStripLabel, type RunGlyphKind } from '../../lib/runStrip';
import { cn } from '../../lib/utils';
import { Link } from '../Link';

/** One run as a small square: filled when the goal was reached, striped when not, hollow when undecided; a hollow one with a dot is still running. */
export function RunGlyph({ kind, className }: { kind: RunGlyphKind; className?: string }) {
  const base = 'grid size-3 shrink-0 place-items-center rounded-[2px]';
  if (kind === 'reached') return <span aria-hidden="true" className={cn(base, 'bg-reach', className)} />;
  if (kind === 'missed') return <span aria-hidden="true" className={cn(base, 'glyph-missed', className)} />;
  if (kind === 'live') return <span aria-hidden="true" className={cn(base, 'border-[1.5px] border-trace', className)}><span className="size-1 rounded-full bg-trace" /></span>;
  return <span aria-hidden="true" className={cn(base, 'border-[1.5px] border-muted-foreground', className)} />;
}

export type RunStripItem = {
  id: string;
  /** "Run #n" in its task. */
  number?: number | undefined;
  state: RunState;
  /** Action count, once the run has one. */
  steps?: number | undefined;
  /** Makes the glyph a link to the run. */
  to?: RouteChange;
};

type Props = { runs: RunStripItem[]; navigate?: (change: RouteChange) => void; className?: string };

/**
 * Recent runs as a sequence of glyphs, oldest first. Every glyph has a name (`실행 #12: 목표 도달, 행동 11번`), so
 * the colour only reinforces what the shape and the text already say. Glyphs are links when a run has a `to` and `navigate` is given.
 */
export function RunStrip({ runs, navigate, className }: Props) {
  const { t } = useTranslation();
  return <ul aria-label={t('runStrip.group', { count: runs.length })} className={cn('inline-flex items-center', className)}>
    {runs.map(run => {
      const label = runStripLabel(run.number, run.state, run.steps), glyph = <RunGlyph kind={runGlyphKind(run.state)} />;
      return <li key={run.id} className="flex">
        {run.to && navigate
          ? <Link to={run.to} navigate={navigate} aria-label={label} title={label} className="grid size-6 place-items-center rounded-sm hover:bg-raised">{glyph}</Link>
          : <span role="img" aria-label={label} title={label} className="grid size-4 place-items-center">{glyph}</span>}
      </li>;
    })}
  </ul>;
}
