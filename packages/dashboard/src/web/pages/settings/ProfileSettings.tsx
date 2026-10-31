import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { defaultProfile, profileSchema, type Profile, type ProjectConfig } from '@rawstep/project/config';
import type { RouteChange } from '../../hooks/useRoute';
import { SaveBar } from '../../components/conditions/SaveBar';
import { PageHeader } from '../../components/layout/PageHeader';
import { Link } from '../../components/Link';
import { ProfileEditor } from '../../components/ProfileEditor';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { comboBlocker, comboSummary, newCombo, sameValue } from '../../lib/conditions';
import { cn } from '../../lib/utils';
import { t as translate } from '../../i18n/index.js';
import type { PageProps } from '../types';

const newId = () => crypto.randomUUID();
const same = sameValue;

/** A new profile planned by the first connection's model, with Rawstep's default actions, page, screen reader and rules. */
export function newProfile(id: string, name: string, config: Pick<ProjectConfig, 'connections'>): Profile {
  const { planner } = newCombo(id, name, config.connections);
  return { ...defaultProfile(id, name), ...(planner ? { planner } : {}) };
}

/** Why a profile cannot be saved yet, if it cannot. */
export function profileBlocker(profile: Profile): string | undefined {
  if (!profile.name.trim()) return translate('profile.blockers.name');
  const reason = comboBlocker(profile);
  if (reason) return translate(`conditions.combo.blockers.${reason}`, { name: profile.name });
  return profileSchema.safeParse(profile).success ? undefined : translate('profile.blockers.invalid', { name: profile.name });
}

/**
 * 설정 · 실행 프로필: the project's run profiles, a list on the left and the chosen one on the right — its name, which tasks use it,
 * 복제 and 삭제 in a ⋯ menu, then its four parts. Edits of every profile save together from the bar at the bottom; a removed profile's
 * tasks fall back to the first one.
 */
export function ProfileSettings({ navigate, onDirty, ...props }: PageProps & { navigate: (change: RouteChange) => void; onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation();
  const config = props.view.config;
  const [items, setItems] = useState<Profile[]>(() => structuredClone(config.profiles));
  const [selectedId, setSelectedId] = useState<string | undefined>(() => config.profiles[0]?.id);
  const saved = config.profiles;
  const changes = items.filter(item => !same(item, saved.find(s => s.id === item.id))).length + saved.filter(s => !items.some(item => item.id === s.id)).length;
  useEffect(() => { onDirty(changes > 0); }, [changes > 0]);
  const selected = items.find(item => item.id === selectedId) ?? items[0];
  const blocked = items.map(item => profileBlocker(item)).find(Boolean);
  const update = (next: Profile) => setItems(items.map(item => item.id === next.id ? next : item));
  const add = (item: Profile) => { setItems([...items, item]); setSelectedId(item.id); };
  const remove = (item: Profile) => { const next = items.filter(other => other.id !== item.id); setItems(next); setSelectedId(next[0]?.id); };
  const removed = saved.filter(s => !items.some(item => item.id === s.id));
  /** Writes the profiles on top of the latest config. */
  const save = () => void props.act(async () => {
    await props.save({ ...props.view.config, profiles: items }, undefined, props.view.revision);
  });
  return <div className="grid gap-5">
    <PageHeader title={t('settingsNav.sections.profiles')} info={t('settingsNav.info.profiles')} actions={
    <Button variant="outline" onClick={() => add(newProfile(newId(), t('profile.newName', { n: items.length + 1 }), config))}><Plus aria-hidden="true" />{t('profile.add')}</Button>
    } />
    <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-stretch">
      <div className="flex flex-col gap-3">
        {!config.connections.length && <p className="text-[13px] leading-5 text-inspect">{t('conditions.combo.connectionsFirst')} <Link to={{ view: 'settings', section: 'connections' }} navigate={navigate} className="font-medium text-trace underline underline-offset-4">{t('conditions.combo.toConnections')}</Link></p>}
        {/* A long list scrolls on its own; beside the editor it is exactly as tall as the editor. */}
        <div className="relative lg:min-h-48 lg:flex-1">
        <ul aria-label={t('profile.listLabel')} className="grid max-h-72 content-start overflow-y-auto overscroll-contain border-y border-edge-strong lg:absolute lg:inset-0 lg:max-h-none">
          {items.map(item => <li key={item.id} className="border-b border-edge last:border-b-0">
            <button type="button" aria-current={item.id === selected?.id ? 'true' : undefined} onClick={() => setSelectedId(item.id)}
              data-selected={item.id === selected?.id} className={cn('row-rail rail-divider grid min-h-11 w-full gap-0.5 py-2 pr-3 pl-4 text-left text-sm', item.id === selected?.id ? 'bg-trace-soft font-medium' : 'hover:bg-raised')}>
              <span className="break-words">{item.name || t('profile.unnamed')}{!same(item, saved.find(s => s.id === item.id)) && <span className="ml-1 text-trace" aria-label={t('settingsNav.unsaved')}>•</span>}</span>
              <span className="text-xs leading-4 font-normal break-words text-muted-foreground">{comboSummary(item, config.connections)} · {t(`conditions.backends.${item.screenReader}`)}</span>
            </button>
          </li>)}
        </ul>
        </div>
      </div>
      {selected && <div className="grid min-w-0 max-w-5xl content-start gap-8">
        <div className="flex items-start justify-between gap-3 border-b border-edge pb-3">
          <div className="grid min-w-0 flex-1 gap-1">
            <Label htmlFor="profile-name" className="sr-only">{t('profile.name')}</Label>
            <Input id="profile-name" value={selected.name} onChange={event => update({ ...selected, name: event.target.value })} className="h-9 max-w-md text-base font-semibold" />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t('profile.more', { name: selected.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => add({ ...structuredClone(selected), id: newId(), name: t('profile.copyName', { name: selected.name }) })}><Copy aria-hidden="true" />{t('profile.duplicate')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={items.length <= 1} onSelect={() => remove(selected)}><Trash2 aria-hidden="true" />{items.length <= 1 ? t('profile.deleteLast') : t('profile.delete')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <ProfileEditor key={selected.id} profile={selected} onChange={update} view={props.view} />
      </div>}
    </div>
    {removed.length > 0 && <p className="text-xs leading-5 text-inspect">{t('profile.deleteNote')}</p>}
    <SaveBar dirty={changes > 0} changes={changes} busy={props.busy} blocked={blocked} onSave={save} onDiscard={() => { setItems(structuredClone(config.profiles)); setSelectedId(config.profiles[0]?.id); }} />
  </div>;
}
