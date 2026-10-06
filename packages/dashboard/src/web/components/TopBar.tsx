import { Circle, GitBranch, Menu, Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { Button } from './ui/button';

type Props = { connected: boolean; running: number; queued: number; showNavigation: boolean; onNavigation: () => void };

const themeIcons = { system: Monitor, light: Sun, dark: Moon } as const;

/** Brand, the number of running and waiting runs, the connection to the local service and the theme switch. */
export function TopBar({ connected, running, queued, showNavigation, onNavigation }: Props) {
  const { t } = useTranslation();
  const { preference, cycle } = useTheme();
  const ThemeIcon = themeIcons[preference];
  const label = t('topBar.theme', { current: t(`topBar.themes.${preference}`) });
  return <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-card px-3">
    <div className="flex items-center gap-2.5">
      {showNavigation && <Button variant="ghost" size="icon" aria-label={t('topBar.openNavigation')} onClick={onNavigation}><Menu aria-hidden="true" /></Button>}
      <GitBranch className="size-4 text-trace" aria-hidden="true" />
      <span className="font-semibold tracking-tight">{t('app.title')}</span>
    </div>
    <div className="flex items-center gap-3">
      <div role="status" aria-live="polite" className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{t('topBar.counts', { running, queued })}</span>
        <span className="flex items-center gap-1.5">
          <Circle className={'size-2 ' + (connected ? 'fill-current' : 'text-inspect')} aria-hidden="true" />
          {connected ? t('topBar.connected') : t('topBar.reconnecting')}
        </span>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={cycle}><ThemeIcon aria-hidden="true" /></Button>
    </div>
  </header>;
}
