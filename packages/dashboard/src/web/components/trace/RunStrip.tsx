import { useTranslation } from 'react-i18next';
import type { RouteChange } from '../../hooks/useRoute';
import type { RunStatus } from '../../lib/runStrip';
import { cn } from '../../lib/utils';
import { Link } from '../Link';
import { StatusShape } from '../StatusMark';

export type RunStripItem = {
  id: string;
  /** "Run #n" in its task. */
  number?: number | undefined;
  status: RunStatus;
  /** Action count, once the run has one. */
  steps?: number | undefined;
  /** Makes the shape a link to the run. */
  to?: RouteChange;
};

type Props = { runs: RunStripItem[]; navigate?: (change: RouteChange) => void; className?: string };

/**
 * Recent runs as a row of status shapes, oldest first. Every shape has a name (`#12 해냄, 행동 11번`), so the colour only reinforces
 * what the shape and the text already say. Shapes are links when a run has a `to` and `navigate` is given.
 */
export function RunStrip({ runs, navigate, className }: Props) {
  const { t } = useTranslation();
  return <ul aria-label={t('runStrip.group', { count: runs.length })} className={cn('inline-flex items-center', className)}>
    {runs.map(run => {
      const n = run.number ?? '?', state = t(`status.${run.status}`);
      const label = run.steps === undefined ? t('runStrip.itemNoSteps', { number: n, state }) : t('runStrip.item', { number: n, state, steps: run.steps, count: run.steps });
      const shape = <StatusShape status={run.status} />;
      return <li key={run.id} className="flex">
        {run.to && navigate
          ? <Link to={run.to} navigate={navigate} aria-label={label} title={label} className="grid h-5 w-3.5 place-items-center rounded-xs hover:bg-raised">{shape}</Link>
          : <span role="img" aria-label={label} title={label} className="grid h-4 w-3.5 place-items-center">{shape}</span>}
      </li>;
    })}
  </ul>;
}
