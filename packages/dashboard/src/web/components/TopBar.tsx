import { Circle, GitBranch, Menu, Plus, Settings } from 'lucide-react';
import { ko } from '../i18n/ko';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

type Props = {
  connected: boolean; running: number; queued: number; showNavigation: boolean;
  onNavigation: () => void; onNewExperiment: () => void; onSettings: () => void;
};

export function TopBar({ connected, running, queued, showNavigation, onNavigation, onNewExperiment, onSettings }: Props) {
  return <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
    <div className="flex items-center gap-3">
      {showNavigation && <Button variant="ghost" size="icon" aria-label={ko.topBar.openNavigation} onClick={onNavigation}><Menu aria-hidden="true" /></Button>}
      <div className="grid size-8 place-content-center rounded-lg bg-primary/10 text-primary"><GitBranch className="size-4" aria-hidden="true" /></div>
      <span className="font-semibold tracking-tight">{ko.app.title}</span>
      <Badge variant="outline" className="hidden sm:inline-flex">{ko.topBar.local}</Badge>
    </div>
    <div className="flex items-center gap-3">
      <div role="status" aria-live="polite" className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
        <span>{ko.topBar.counts(running, queued)}</span>
        <span className="flex items-center gap-2">
          <Circle className={'size-2 fill-current ' + (connected ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
          {connected ? ko.topBar.connected : ko.topBar.reconnecting}
        </span>
      </div>
      <Button size="sm" onClick={onNewExperiment}><Plus aria-hidden="true" />{ko.topBar.newExperiment}</Button>
      <Button variant="outline" size="icon" aria-label={ko.topBar.settingsLabel} title={ko.topBar.settings} onClick={onSettings}><Settings aria-hidden="true" /></Button>
    </div>
  </header>;
}
