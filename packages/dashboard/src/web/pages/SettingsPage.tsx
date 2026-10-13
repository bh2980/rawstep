import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { settingsGroups, type RouteChange, type SettingsSection } from '../hooks/useRoute';
import { Link } from '../components/Link';
import { cn } from '../lib/utils';
import { AssistSettings } from './settings/AssistSettings';
import { CONDITION_SECTIONS, ConditionSettings, type ConditionSection } from './settings/ConditionSettings';
import { ConnectionSettings } from './settings/ConnectionSettings';
import { MachineSettings } from './settings/MachineSettings';
import type { PageProps } from './types';

const isCondition = (section: SettingsSection): section is ConditionSection => (CONDITION_SECTIONS as readonly string[]).includes(section);

/**
 * 설정: everything that is configured, in one place with a side navigation of three groups — 실험 조건 (what changes a result), 모델
 * (where models are reached and the models that only comment), 이 컴퓨터. Every section stays mounted so a draft survives a visit to
 * another section; the navigation marks sections with unsaved edits.
 */
export function SettingsPage({ section, navigate, ...props }: PageProps & { section?: SettingsSection | undefined; navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const config = props.view.config;
  // Without a connection nothing can run, so that is where 설정 opens first.
  const current: SettingsSection = section ?? (config.connections.length ? 'presets' : 'connections');
  const [dirty, setDirty] = useState<Partial<Record<SettingsSection, boolean>>>({});
  const mark = (part: Partial<Record<SettingsSection, boolean>>) => setDirty(previous => ({ ...previous, ...part }));
  const show = (id: SettingsSection | SettingsSection[]) => ({ hidden: !(Array.isArray(id) ? id.includes(current) : id === current) });
  return <div className="grid items-start gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
    <nav aria-label={t('settingsNav.label')} className="grid gap-4 lg:sticky lg:top-0">
      <h1 className="sr-only">{t('settingsNav.title')}</h1>
      {settingsGroups.map(group => <div key={group.id} className="grid gap-0.5">
        <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{t(`settingsNav.groups.${group.id}`)}</p>
        {group.sections.map(id => <Link key={id} to={{ view: 'settings', section: id }} navigate={navigate} aria-current={id === current ? 'page' : undefined}
          className={cn('flex h-8 items-center justify-between gap-2 rounded-md px-3 text-sm', id === current ? 'bg-trace-soft font-medium text-foreground' : 'text-muted-foreground hover:bg-raised hover:text-foreground')}>
          {t(`settingsNav.sections.${id}`)}
          {dirty[id] && <span className="size-1.5 rounded-full bg-trace" role="img" aria-label={t('settingsNav.unsaved')} />}
        </Link>)}
      </div>)}
    </nav>
    <div className="min-w-0">
      <div {...show([...CONDITION_SECTIONS])}>
        <ConditionSettings {...props} section={isCondition(current) ? current : 'presets'} navigate={navigate} onDirty={mark} />
      </div>
      <div {...show('connections')}><ConnectionSettings {...props} navigate={navigate} /></div>
      <div {...show('assist')}><AssistSettings {...props} onDirty={value => mark({ assist: value })} /></div>
      <div {...show('machine')}><MachineSettings {...props} onDirty={value => mark({ machine: value })} /></div>
    </div>
  </div>;
}
