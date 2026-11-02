import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SETTINGS_SECTION, settingsSections, type RouteChange, type SettingsSection } from '../hooks/useRoute';
import { PageHeader } from '../components/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { AssistSettings } from './settings/AssistSettings';
import { ConnectionSettings } from './settings/ConnectionSettings';
import { MachineSettings } from './settings/MachineSettings';
import { RuleDefaults } from './settings/RuleDefaults';
import type { MarkUnsaved, PageProps } from './types';

/**
 * 설정: AI 연결 (where models are reached, and the models that only comment on finished runs), 이 컴퓨터, and 기본 실행 규칙, as
 * tabs whose choice is in the address (`&section=`). Every tab stays mounted so a draft survives a visit to another. Leaving 설정
 * drops the drafts, so it tells the navigation there are none left.
 */
export function SettingsPage({ section, navigate, onUnsaved, ...props }: PageProps & { section?: SettingsSection | undefined; navigate: (change: RouteChange) => void; onUnsaved: MarkUnsaved }) {
  const { t } = useTranslation();
  const current: SettingsSection = section ?? DEFAULT_SETTINGS_SECTION;
  useEffect(() => () => { onUnsaved('connections', false); onUnsaved('machine', false); }, []);
  const panel = 'pt-6 data-[state=inactive]:hidden';
  return <div className="min-w-0">
    <PageHeader title={t('settingsPage.title')} meta={[t('settingsPage.project', { name: props.view.projectName })]} />
    <Tabs value={current} onValueChange={next => navigate({ view: 'settings', section: next as SettingsSection })}>
      <TabsList variant="line" aria-label={t('settingsPage.tabsLabel')}>
        {settingsSections.map(id => <TabsTrigger key={id} value={id}>{t(`settingsNav.sections.${id}`)}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="connections" forceMount className={panel}>
        <div className="grid gap-10">
          <ConnectionSettings {...props} />
          <AssistSettings {...props} onDirty={value => onUnsaved('connections', value)} />
        </div>
      </TabsContent>
      <TabsContent value="machine" forceMount className={panel}><MachineSettings {...props} onDirty={value => onUnsaved('machine', value)} /></TabsContent>
      <TabsContent value="rules" forceMount className={panel}><RuleDefaults /></TabsContent>
    </Tabs>
  </div>;
}
