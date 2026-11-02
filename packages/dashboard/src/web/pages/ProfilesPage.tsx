import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { defaultProfile, profileSchema, type Profile, type ProjectConfig } from '@rawstep/project/config';
import type { RouteChange } from '../hooks/useRoute';
import { SaveBar } from '../components/conditions/SaveBar';
import { PageHeader } from '../components/PageHeader';
import { Link } from '../components/Link';
import { changedSettingCount, ProfileEditor } from '../components/ProfileEditor';
import { Button } from '../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import { comboBlocker, newCombo, sameValue } from '../lib/conditions';
import { withoutProfiles } from '../lib/usualProfiles';
import { cn } from '../lib/utils';
import { t as translate } from '../i18n/index.js';
import type { MarkUnsaved, PageProps } from './types';

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

/** The saved tasks that run with a profile: those that name it, and those that name none when it is the project's first. */
function tasksUsing(config: ProjectConfig, profileId: string): number {
  const first = config.profiles[0]?.id;
  return config.tasks.filter(task => task.profiles?.length ? task.profiles.includes(profileId) : profileId === first).length;
}

/**
 * 실행 프로필: the project's run profiles, a list on the left and the chosen one on the right — its name as the title, 복제, and 이름
 * 바꾸기 and 삭제 in a ⋯ menu, then its four questions as sheet rows. Edits of every profile save together from the bar at the bottom;
 * a removed profile's tasks fall back to the first one. Leaving the page drops unsaved edits, so it also tells the navigation there are
 * none left.
 */
export function ProfilesPage({ navigate, onUnsaved, ...props }: PageProps & { navigate: (change: RouteChange) => void; onUnsaved: MarkUnsaved }) {
  const { t } = useTranslation();
  const listId = useId();
  const config = props.view.config;
  const [items, setItems] = useState<Profile[]>(() => structuredClone(config.profiles));
  const [selectedId, setSelectedId] = useState<string | undefined>(() => config.profiles[0]?.id);
  const [renaming, setRenaming] = useState(false);
  const saved = config.profiles;
  const changes = items.filter(item => !same(item, saved.find(s => s.id === item.id))).length + saved.filter(s => !items.some(item => item.id === s.id)).length;
  useEffect(() => { onUnsaved('profiles', changes > 0); }, [changes > 0]);
  useEffect(() => () => onUnsaved('profiles', false), []);
  const selected = items.find(item => item.id === selectedId) ?? items[0];
  const blocked = items.map(item => profileBlocker(item)).find(Boolean);
  const update = (next: Profile) => setItems(items.map(item => item.id === next.id ? next : item));
  const add = (item: Profile, rename = false) => { setItems([...items, item]); setSelectedId(item.id); setRenaming(rename); };
  const remove = (item: Profile) => { const next = items.filter(other => other.id !== item.id); setItems(next); setSelectedId(next[0]?.id); setRenaming(false); };
  const removed = saved.filter(s => !items.some(item => item.id === s.id));
  /** Writes the profiles on top of the latest config; a deleted profile is also taken off the tasks that usually run with it. */
  const save = () => void props.act(async () => {
    const latest = props.view.config;
    await props.save({ ...latest, profiles: items, tasks: withoutProfiles(latest.tasks, removed.map(profile => profile.id)) }, undefined, props.view.revision);
  });
  const duplicate = (profile: Profile) => add({ ...structuredClone(profile), id: newId(), name: t('profile.copyName', { name: profile.name }) });
  return <div className="grid gap-4">
    <div className="grid items-start gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="grid min-w-0 gap-2">
        {/* A long list scrolls on its own. */}
        <div className="flex h-8 items-center border-b border-edge px-3 text-xs font-medium text-ink-2" id={listId}>
          {t('profile.listHead')}<span className="ml-1.5 tabular-nums">{items.length}</span>
        </div>
        <ul aria-labelledby={listId} className="-mt-2 grid max-h-[60vh] content-start overflow-y-auto overscroll-contain">
          {items.map(item => {
            const current = item.id === selected?.id, dirty = !same(item, saved.find(s => s.id === item.id));
            return <li key={item.id} className="border-b border-edge">
              <button type="button" aria-current={current ? 'true' : undefined} onClick={() => { setSelectedId(item.id); setRenaming(false); }}
                data-selected={current} className={cn('row-rail rail-divider flex min-h-10 w-full items-center gap-1.5 px-3 py-2 text-left', current ? 'bg-raised' : 'hover:bg-raised')}>
                <span className="min-w-0 truncate">{item.name || t('profile.unnamed')}</span>
                {dirty && <span className="text-ink-2" aria-label={t('settingsNav.unsaved')} title={t('settingsNav.unsaved')}>•</span>}
              </button>
            </li>;
          })}
        </ul>
        <Button variant="ghost" className="-ml-3 justify-self-start" onClick={() => add(newProfile(newId(), t('profile.newName', { n: items.length + 1 }), config), true)}>
          <Plus aria-hidden="true" />{t('profile.add')}
        </Button>
        {!config.connections.length && <p className="text-ink-2">{t('conditions.combo.connectionsFirst')} <Link to={{ view: 'settings', section: 'connections' }} navigate={navigate} className="text-foreground underline underline-offset-4">{t('conditions.combo.toConnections')}</Link></p>}
      </div>
      {selected && <div className="grid min-w-0 content-start">
        <PageHeader className="mb-3"
          title={renaming
            ? <Input autoFocus aria-label={t('profile.name')} value={selected.name} className="h-9 max-w-md text-xl font-semibold"
              onChange={event => update({ ...selected, name: event.target.value })}
              onBlur={() => setRenaming(false)} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') setRenaming(false); }} />
            : <span className="min-w-0 break-words">{selected.name || t('profile.unnamed')}</span>}
          meta={[t('profile.usedBy', { count: tasksUsing(config, selected.id) }), t('profile.questions.changedCount', { count: changedSettingCount(selected) })]}
          actions={<>
            <Button variant="outline" onClick={() => duplicate(selected)}><Copy aria-hidden="true" />{t('profile.duplicate')}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label={t('profile.more', { name: selected.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil aria-hidden="true" />{t('profile.rename')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={items.length <= 1} onSelect={() => remove(selected)}><Trash2 aria-hidden="true" />{items.length <= 1 ? t('profile.deleteLast') : t('profile.delete')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>} />
        <ProfileEditor key={selected.id} profile={selected} onChange={update} view={props.view} />
      </div>}
    </div>
    {removed.length > 0 && <p className="text-ink-2">{t('profile.deleteNote')}</p>}
    <SaveBar dirty={changes > 0} changes={changes} busy={props.busy} blocked={blocked} onSave={save} onDiscard={() => { setItems(structuredClone(config.profiles)); setSelectedId(config.profiles[0]?.id); setRenaming(false); }} />
  </div>;
}
