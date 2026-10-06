import { Circle, GitBranch, Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

type Props = { connected: boolean; running: number; queued: number; showNavigation: boolean; onNavigation: () => void };

/** Brand, the number of running and waiting runs, and the connection to the local service. */
export function TopBar({ connected, running, queued, showNavigation, onNavigation }: Props) {
  const { t } = useTranslation();
  return <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3">
    <div className="flex items-center gap-2.5">
      {showNavigation && <Button variant="ghost" size="icon" aria-label={t('topBar.openNavigation')} onClick={onNavigation}><Menu aria-hidden="true" /></Button>}
      <GitBranch className="size-4 text-primary" aria-hidden="true" />
      <span className="font-semibold tracking-tight">{t('app.title')}</span>
    </div>
    <div role="status" aria-live="polite" className="flex items-center gap-4 text-xs text-muted-foreground">
      <span>{t('topBar.counts', { running, queued })}</span>
      <span className="flex items-center gap-1.5">
        <Circle className={'size-2 fill-current ' + (connected ? 'text-positive' : 'text-warning')} aria-hidden="true" />
        {connected ? t('topBar.connected') : t('topBar.reconnecting')}
      </span>
    </div>
  </header>;
}
