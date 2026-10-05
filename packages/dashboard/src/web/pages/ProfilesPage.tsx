import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, Save, Trash2 } from 'lucide-react';
import { defaultProfile, type Mode, type RunProfile } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { EnvironmentFields } from '../components/EnvironmentFields';
import { Field } from '../components/forms';
import { PermissionsEditor } from '../components/PermissionsEditor';
import { PolicyFields } from '../components/PolicyFields';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { profileSummary } from '../lib/profileSummary';
import type { PageProps } from './types';

/** Run profiles: named sets of experiment conditions (allowed actions, stuck detection, page environment, analysis). */
export function ProfilesPage({ capabilities, ...props }: PageProps & { capabilities: ConfigView['capabilities'] }) {
  const { t } = useTranslation();
  const config = props.view.config;
  const [profiles, setProfiles] = useState<RunProfile[]>(() => structuredClone(config.profiles));
  const [selectedId, setSelectedId] = useState(() => config.profiles[0]!.id);
  const selected = profiles.find(profile => profile.id === selectedId) ?? profiles[0]!;
  const usedBy = config.tasks.filter(task => task.profileId === selected.id).length;
  const dirty = JSON.stringify(profiles) !== JSON.stringify(config.profiles);
  const update = (part: Partial<RunProfile>) => setProfiles(list => list.map(profile => profile.id === selected.id ? { ...profile, ...part } : profile));
  const add = (profile: RunProfile) => { setProfiles(list => [...list, profile]); setSelectedId(profile.id); };
  const remove = () => {
    const next = profiles.filter(profile => profile.id !== selected.id);
    setProfiles(next); setSelectedId(next[0]!.id);
  };
  // Writes only the profiles (and the task references to deleted ones) on top of the latest config.
  const save = () => void props.act(async () => {
    const tasks = props.view.config.tasks.map(task => {
      if (!task.profileId || profiles.some(profile => profile.id === task.profileId)) return task;
      const { profileId: _removed, ...rest } = task;
      return rest;
    });
    await props.save({ ...props.view.config, tasks, profiles }, undefined, props.view.revision);
  });
  return <div className="grid gap-6">
    <div><h2 className="text-lg font-semibold tracking-tight">{t('profiles.heading')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('profiles.intro')}</p></div>
    <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="grid gap-3">
        <ul aria-label={t('profiles.listLabel')} className="grid gap-2">
          {profiles.map(profile => <li key={profile.id}>
            <button type="button" aria-current={profile.id === selected.id ? 'true' : undefined} onClick={() => setSelectedId(profile.id)}
              className={'grid w-full gap-1 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none' + (profile.id === selected.id ? ' border-primary bg-accent' : '')}>
              <span className="font-medium">{profile.name}</span>
              <span className="text-xs leading-5 text-muted-foreground">{profileSummary(profile)}</span>
            </button>
          </li>)}
        </ul>
        <Button variant="outline" onClick={() => add(defaultProfile(crypto.randomUUID(), t('profiles.newName', { n: profiles.length + 1 })))}><Plus aria-hidden="true" />{t('profiles.add')}</Button>
      </div>
      <div className="grid min-w-0 gap-6">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label={t('profiles.name')} value={selected.name} onChange={name => update({ name })} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => add({ ...structuredClone(selected), id: crypto.randomUUID(), name: t('profiles.copyName', { name: selected.name }) })}><Copy aria-hidden="true" />{t('profiles.duplicate')}</Button>
            <Button variant="outline" disabled={profiles.length <= 1} onClick={remove}><Trash2 aria-hidden="true" />{t('profiles.delete')}</Button>
          </div>
        </div>
        {usedBy > 0 && <p className="-mt-3 text-xs leading-5 text-muted-foreground">{t('profiles.usedBy', { count: usedBy })}</p>}
        <ProfileTabs key={selected.id} profile={selected} update={update} capabilities={capabilities} presets={props.view.environmentPresets} />
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={props.busy || !dirty} onClick={save}><Save aria-hidden="true" />{t('profiles.save')}</Button>
      <p className="text-xs text-muted-foreground">{dirty ? t('profiles.unsaved') : t('profiles.saved')}</p>
    </div>
  </div>;
}

function ProfileTabs({ profile, update, capabilities, presets }: { profile: RunProfile; update: (part: Partial<RunProfile>) => void; capabilities: ConfigView['capabilities']; presets: Record<string, unknown> }) {
  const { t } = useTranslation();
  const setPermissions = (mode: Mode, permissions: RunProfile['permissions'][Mode]) => update({ permissions: { ...profile.permissions, [mode]: permissions } });
  return <Tabs defaultValue="permissions">
    <TabsList aria-label={t('profiles.tabsLabel')}>
      <TabsTrigger value="permissions">{t('profiles.tabPermissions')}</TabsTrigger>
      <TabsTrigger value="stuck">{t('profiles.tabStuck')}</TabsTrigger>
      <TabsTrigger value="environment">{t('profiles.tabEnvironment')}</TabsTrigger>
      <TabsTrigger value="analysis">{t('profiles.tabAnalysis')}</TabsTrigger>
    </TabsList>
    <TabsContent value="permissions" className="grid gap-5 pt-4">
      <p className="text-xs leading-5 text-muted-foreground">{t('profiles.permissionsHint')}</p>
      <div className="grid gap-6 xl:grid-cols-2">
        {(['keyboard', 'screenreader'] as const).map(mode => <div key={mode} className="grid content-start gap-3">
          <h4 className="text-sm font-medium">{t(`profiles.mode.${mode}`)}</h4>
          <PermissionsEditor value={profile.permissions[mode]} onChange={permissions => setPermissions(mode, permissions)} capabilities={capabilities[mode]} />
        </div>)}
      </div>
    </TabsContent>
    <TabsContent value="stuck" className="grid gap-5 pt-4">
      <p className="text-xs leading-5 text-muted-foreground">{t('profiles.stuckHint')}</p>
      <PolicyFields value={profile.policy} onChange={policy => update({ policy })} />
    </TabsContent>
    <TabsContent value="environment" className="grid gap-5 pt-4">
      <p className="text-xs leading-5 text-muted-foreground">{t('profiles.environmentHint')}</p>
      <EnvironmentFields value={profile.environment} onChange={environment => update({ environment })} presets={presets} id={profile.id} />
    </TabsContent>
    <TabsContent value="analysis" className="grid gap-5 pt-4">
      <Field label={t('profiles.analysisLabel')} multiline value={profile.analysisInstructions} onChange={analysisInstructions => update({ analysisInstructions })} hint={t('profiles.analysisHint')} />
    </TabsContent>
  </Tabs>;
}
