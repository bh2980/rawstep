import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, Save, Trash2 } from 'lucide-react';
import { defaultProfile, type RunProfile } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { EnvironmentFields } from '../components/EnvironmentFields';
import { Field } from '../components/forms';
import { ConceptNote } from '../components/layout/ConceptNote';
import { PermissionPresets } from '../components/PermissionPresets';
import { PolicyFields } from '../components/PolicyFields';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { profileConditions } from '../lib/profileSummary';
import { cn } from '../lib/utils';
import type { PageProps } from './types';

/**
 * Run profiles (spec §34): each one is an experiment condition. The sheet states it as four lines (allowed actions, blocked detection,
 * viewport, analysis) and below them is the editor for each. Two runs of the same task differ by these lines when only the profile differs.
 */
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
  const conditions = profileConditions(selected, capabilities.screenreader, props.view.environmentPresets);
  return <div className="grid gap-5">
    <div><h2 className="text-lg font-semibold tracking-tight">{t('profiles.heading')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('profiles.intro')}</p></div>
    <ConceptNote concept="profile" />
    <div className="grid items-start gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="grid gap-3">
        <ul aria-label={t('profiles.listLabel')} className="grid border-y border-edge-strong">
          {profiles.map(profile => <li key={profile.id} className="border-b border-edge last:border-b-0">
            <button type="button" aria-current={profile.id === selected.id ? 'true' : undefined} onClick={() => setSelectedId(profile.id)}
              data-selected={profile.id === selected.id} className={cn('row-rail rail-divider grid min-h-11 w-full gap-0.5 py-2.5 pr-3 pl-4 text-left text-sm', profile.id === selected.id ? 'bg-trace-soft font-medium' : 'hover:bg-raised')}>
              <span>{profile.name}</span>
              <span className="text-xs leading-4 font-normal text-muted-foreground">{profileConditions(profile, capabilities.screenreader, props.view.environmentPresets)[0]!.value}</span>
            </button>
          </li>)}
        </ul>
        <Button variant="outline" onClick={() => add(defaultProfile(crypto.randomUUID(), t('profiles.newName', { n: profiles.length + 1 })))}><Plus aria-hidden="true" />{t('profiles.add')}</Button>
      </div>
      <div className="grid min-w-0 gap-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_auto] sm:items-end sm:justify-between">
          <Field label={t('profiles.name')} value={selected.name} onChange={name => update({ name })} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => add({ ...structuredClone(selected), id: crypto.randomUUID(), name: t('profiles.copyName', { name: selected.name }) })}><Copy aria-hidden="true" />{t('profiles.duplicate')}</Button>
            <Button variant="outline" disabled={profiles.length <= 1} onClick={remove}><Trash2 aria-hidden="true" />{t('profiles.delete')}</Button>
          </div>
        </div>
        {usedBy > 0 && <p className="-mt-3 text-xs leading-5 text-muted-foreground">{t('profiles.usedBy', { count: usedBy })}</p>}
        <section aria-labelledby="profile-conditions" className="grid gap-1.5">
          <h3 id="profile-conditions" className="border-b border-edge-strong pb-1.5 text-sm font-semibold">{t('profiles.conditionTitle', { name: selected.name })}</h3>
          <dl className="grid">
            {conditions.map(condition => <div key={condition.id} className="grid gap-x-4 border-b border-edge py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <dt className="text-sm text-muted-foreground">{t(`profiles.condition.labels.${condition.id}`)}</dt>
              <dd className="text-sm leading-6">{condition.value}</dd>
            </div>)}
          </dl>
        </section>
        <ProfileTabs key={selected.id} profile={selected} update={update} capabilities={capabilities} presets={props.view.environmentPresets} />
        <div className="flex flex-wrap items-center gap-3 border-t border-edge-strong pt-4">
          <Button size="xl" disabled={props.busy || !dirty} onClick={save}><Save aria-hidden="true" />{t('profiles.save')}</Button>
          <p role="status" className="text-xs text-muted-foreground">{dirty ? t('profiles.unsaved') : t('profiles.saved')}</p>
        </div>
      </div>
    </div>
  </div>;
}

function ProfileTabs({ profile, update, capabilities, presets }: { profile: RunProfile; update: (part: Partial<RunProfile>) => void; capabilities: ConfigView['capabilities']; presets: Record<string, unknown> }) {
  const { t } = useTranslation();
  return <Tabs defaultValue="permissions" className="gap-4">
    <TabsList variant="line" aria-label={t('profiles.tabsLabel')}>
      {(['permissions', 'stuck', 'environment', 'analysis'] as const).map(tab => <TabsTrigger key={tab} value={tab}>{t(`profiles.tabs.${tab}`)}</TabsTrigger>)}
    </TabsList>
    <TabsContent value="permissions"><PermissionPresets value={profile.permissions} onChange={permissions => update({ permissions })} capabilities={capabilities} /></TabsContent>
    <TabsContent value="stuck" className="grid gap-4">
      <p className="text-[13px] leading-5 text-muted-foreground">{t('profiles.stuckHint')}</p>
      <PolicyFields value={profile.policy} onChange={policy => update({ policy })} />
    </TabsContent>
    <TabsContent value="environment" className="grid gap-4">
      <p className="text-[13px] leading-5 text-muted-foreground">{t('profiles.environmentHint')}</p>
      <EnvironmentFields value={profile.environment} onChange={environment => update({ environment })} presets={presets} id={profile.id} />
    </TabsContent>
    <TabsContent value="analysis" className="grid gap-4">
      <Field label={t('profiles.analysisLabel')} multiline value={profile.analysisInstructions} onChange={analysisInstructions => update({ analysisInstructions })} hint={t('profiles.analysisHint')} />
    </TabsContent>
  </Tabs>;
}
