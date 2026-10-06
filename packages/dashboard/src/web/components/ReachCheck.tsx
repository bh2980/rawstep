import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ruler } from 'lucide-react';
import type { ReachEstimate } from '../../shared/api';
import { api } from '../api';
import { describeApiError, type ErrorView } from '../lib/errors';
import { ErrorState } from './layout/ErrorState';
import { Button } from './ui/button';

/** Room left for the steps after the start page (a product page, the cart) when suggesting a step limit. */
const LATER_PAGES = 1.5;

/**
 * Measures, on request, how far a screen reader run has to go on the task's start page and warns when the step limit is shorter.
 * It reads the saved task file, so unsaved edits are not measured.
 */
export function ReachCheck({ taskId, maxSteps, onMaxSteps }: { taskId: string; maxSteps: number; onMaxSteps: (steps: number) => void }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<ReachEstimate>(), [loading, setLoading] = useState(false), [error, setError] = useState<ErrorView>();
  async function measure() {
    setLoading(true); setError(undefined);
    try { setResult(await api<ReachEstimate>(`/tasks/${encodeURIComponent(taskId)}/reach`, { method: 'POST', body: {} })); }
    catch (e) { setError(describeApiError(e)); }
    finally { setLoading(false); }
  }
  const farthest = result ? Math.max(0, ...result.targets.map(target => target.next ?? result.stops)) : 0;
  const needed = result ? (result.targets.length ? farthest : result.stops) : 0;
  const short = !!result && needed >= maxSteps;
  const suggested = Math.min(1000, Math.ceil((needed * LATER_PAGES) / 10) * 10);
  return <div className="grid gap-2">
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void measure()}><Ruler aria-hidden="true" />{loading ? t('reach.measuring') : t('reach.measure')}</Button>
      <p className="text-xs leading-5 text-muted-foreground">{t('reach.note')}</p>
    </div>
    {error && <ErrorState alert view={error} />}
    {result && <div className="grid gap-1.5 border-l-4 border-edge-strong py-2 pl-3 text-sm leading-6">
      <p>{t(result.truncated ? 'reach.stopsTruncated' : 'reach.stops', { n: result.stops })}</p>
      {result.targets.map(target => <p key={target.text}>
        {target.next === undefined ? t('reach.targetMissing', { text: target.text }) : t('reach.target', { text: target.text, n: target.next })}
        {target.heading !== undefined && <span className="text-muted-foreground"> {t('reach.byHeading', { n: target.heading })}</span>}
      </p>)}
      {short
        ? <div className="grid justify-items-start gap-1.5"><p className="font-medium text-inspect">{t('reach.short', { max: maxSteps, needed })}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => onMaxSteps(suggested)}>{t('reach.raise', { n: suggested })}</Button></div>
        : <p className="text-muted-foreground">{t('reach.enough', { max: maxSteps })}</p>}
    </div>}
  </div>;
}
