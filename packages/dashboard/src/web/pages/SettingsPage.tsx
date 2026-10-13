import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingsGroups, type RouteChange, type SettingsSection } from '../hooks/useRoute';
import { Link } from '../components/Link';
import { cn } from '../lib/utils';
import { AssistSettings } from './settings/AssistSettings';
import { ProfileSettings } from './settings/ProfileSettings';
import { ConnectionSettings } from './settings/ConnectionSettings';
import { MachineSettings } from './settings/MachineSettings';
import type { PageProps } from './types';

/**
 * 설정: everything that is configured, in three places — 실행 프로필 (everything that changes a result), AI 연결 (where models are
 * reached, and the models that only comment on finished runs), 이 컴퓨터. Every section stays mounted so a draft survives a visit to
 * another section; the navigation marks sections with unsaved edits.
 */
export function SettingsPage({ section, navigate, ...props }: PageProps & { section?: SettingsSection | undefined; navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const config = props.view.config;
  // Without a connection nothing can run, so that is where 설정 opens first.
  const current: SettingsSection = section ?? (config.connections.length ? 'profiles' : 'connections');
  const [dirty, setDirty] = useState<Partial<Record<SettingsSection, boolean>>>({});
  const mark = (part: Partial<Record<SettingsSection, boolean>>) => setDirty(previous => ({ ...previous, ...part }));
  const show = (id: SettingsSection | SettingsSection[]) => ({ hidden: !(Array.isArray(id) ? id.includes(current) : id === current) });
  return <div className="grid items-start gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
    <nav aria-label={t('settingsNav.label')} className="grid gap-4 lg:sticky lg:top-0">
      <h1 className="sr-only">{t('settingsNav.title')}</h1>
      {settingsGroups.map(group => <div key={group.id} className="grid gap-0.5">
        {group.sections.map(id => <Link key={id} to={{ view: 'settings', section: id }} navigate={navigate} aria-current={id === current ? 'page' : undefined}
          className={cn('flex h-8 items-center justify-between gap-2 rounded-md px-3 text-sm', id === current ? 'bg-trace-soft font-medium text-foreground' : 'text-muted-foreground hover:bg-raised hover:text-foreground')}>
          {t(`settingsNav.sections.${id}`)}
          {dirty[id] && <span className="size-1.5 rounded-full bg-trace" role="img" aria-label={t('settingsNav.unsaved')} />}
        </Link>)}
      </div>)}
    </nav>
    <div className="min-w-0">
      <div {...show('profiles')}><ProfileSettings {...props} navigate={navigate} onDirty={value => mark({ profiles: value })} /></div>
      <div {...show('connections')} className="grid gap-12">
        <ConnectionSettings {...props} navigate={navigate} />
        <AssistSettings {...props} onDirty={value => mark({ connections: value })} />
      </div>
      <div {...show('machine')}><MachineSettings {...props} onDirty={value => mark({ machine: value })} /></div>
    </div>
  </div>;
}
