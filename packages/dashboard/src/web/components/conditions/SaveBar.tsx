import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

/** The top line of an editor: what is being edited on the left, the save state and 저장 (plus any other actions) on the right. */
export function SaveBar({ dirty, busy, blocked, onSave, lead, children, changes }: { dirty: boolean; busy: boolean; blocked?: string | undefined; onSave: () => void; lead?: ReactNode; children?: ReactNode; changes?: number }) {
  const { t } = useTranslation();
  return <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-edge-strong pb-3">
    <div className="min-w-0 flex-1">{lead}</div>
    <div className="grid justify-items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={busy || !dirty || !!blocked} onClick={onSave}><Save aria-hidden="true" />{t('conditions.bar.save')}</Button>
        {children}
      </div>
      <p role="status" className={cn('text-right text-xs leading-5', blocked ? 'text-inspect' : dirty ? 'text-trace' : 'text-muted-foreground')}>
        {blocked ?? (dirty ? (changes ? t('conditions.bar.unsavedCount', { count: changes }) : t('conditions.bar.unsaved')) : t('conditions.bar.saved'))}
      </p>
    </div>
  </div>;
}
