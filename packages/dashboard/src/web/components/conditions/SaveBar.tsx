import { useTranslation } from 'react-i18next';
import { RotateCcw, Save } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

type Props = {
  dirty: boolean; busy: boolean;
  /** Why saving is not possible yet; shown in place of the change count. */
  blocked?: string | undefined;
  onSave: () => void;
  /** Throws the edits away. */
  onDiscard?: () => void;
  changes?: number;
  /** Saves on top of a newer project instead (labels change); used when the draft is behind. */
  behind?: boolean;
  className?: string;
};

/**
 * The one way an editor saves (every settings section, the task's settings): nothing while there is nothing to save, then a bar
 * stuck to the bottom of the page with the number of changes, 되돌리기 and 저장. There is no permanent "all saved" line.
 */
export function SaveBar({ dirty, busy, blocked, onSave, onDiscard, changes, behind, className }: Props) {
  const { t } = useTranslation();
  if (!dirty && !blocked) return null;
  return <div role="region" aria-label={t('saveBar.label')} className={cn('sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-edge-strong bg-background/95 px-1 py-3 backdrop-blur', className)}>
    <p role="status" className={cn('text-sm', blocked ? 'text-inspect' : 'font-medium')}>
      {blocked ?? (behind ? t('saveBar.behind') : changes ? t('saveBar.unsavedCount', { count: changes }) : t('saveBar.unsaved'))}
    </p>
    <div className="flex flex-wrap gap-2">
      {onDiscard && dirty && <Button variant="ghost" disabled={busy} onClick={onDiscard}><RotateCcw aria-hidden="true" />{behind ? t('saveBar.takeLatest') : t('saveBar.discard')}</Button>}
      <Button disabled={busy || !dirty || !!blocked} onClick={onSave}><Save aria-hidden="true" />{behind ? t('saveBar.saveOnLatest') : t('saveBar.save')}</Button>
    </div>
  </div>;
}
