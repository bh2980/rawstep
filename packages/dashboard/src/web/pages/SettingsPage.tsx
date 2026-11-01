import { useEffect } from 'react';
import { DEFAULT_SETTINGS_SECTION, type RouteChange, type SettingsSection } from '../hooks/useRoute';
import { AssistSettings } from './settings/AssistSettings';
import { ConnectionSettings } from './settings/ConnectionSettings';
import { MachineSettings } from './settings/MachineSettings';
import type { MarkUnsaved, PageProps } from './types';

/**
 * 설정: AI 연결 (where models are reached, and the models that only comment on finished runs) and 이 컴퓨터. The left navigation
 * lists the two, so the page is only the one chosen; both stay mounted so a draft survives a visit to the other. Leaving 설정 drops
 * the drafts, so it tells the navigation there are none left.
 */
export function SettingsPage({ section, navigate, onUnsaved, ...props }: PageProps & { section?: SettingsSection | undefined; navigate: (change: RouteChange) => void; onUnsaved: MarkUnsaved }) {
  const current: SettingsSection = section ?? DEFAULT_SETTINGS_SECTION;
  useEffect(() => () => { onUnsaved('connections', false); onUnsaved('machine', false); }, []);
  return <div className="min-w-0">
    <div hidden={current !== 'connections'} className="grid gap-12">
      <ConnectionSettings {...props} navigate={navigate} />
      <AssistSettings {...props} onDirty={value => onUnsaved('connections', value)} />
    </div>
    <div hidden={current !== 'machine'}><MachineSettings {...props} onDirty={value => onUnsaved('machine', value)} /></div>
  </div>;
}
