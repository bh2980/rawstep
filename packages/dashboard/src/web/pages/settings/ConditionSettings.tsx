import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import {
  actionSetSchema, atEnvironmentSchema, comboSchema, defaultAtEnvironment, defaultPageEnvironment, pageEnvironmentSchema, presetSchema, runRulesSchema,
  type ActionSet, type AtEnvironment, type Combo, type ManagedTask, type PageEnvironment, type Preset, type ProjectConfig, type RunRules,
} from '@rawstep/project/config';
import type { RouteChange, SettingsSection } from '../../hooks/useRoute';
import { ActionSetEditor } from '../../components/conditions/ActionSetEditor';
import { AtEnvironmentEditor } from '../../components/conditions/AtEnvironmentEditor';
import { ComboEditor } from '../../components/conditions/ComboEditor';
import { PageEnvironmentEditor } from '../../components/conditions/PageEnvironmentEditor';
import { RunRulesEditor, runRulesValid } from '../../components/conditions/RunRulesEditor';
import { SaveBar } from '../../components/conditions/SaveBar';
import { Choice } from '../../components/forms';
import { PageHeader } from '../../components/layout/PageHeader';
import { Link } from '../../components/Link';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  actionSetSummary, COMBO_PRESETS, sameValue, comboBlocker, comboFromPreset, comboSummary, environmentViewport, runRulesSummary,
} from '../../lib/conditions';
import { ACTION_SET_PRESETS, presetPermissions } from '../../lib/presets';
import { cn } from '../../lib/utils';
import { t as translate } from '../../i18n/index.js';
import type { PageProps } from '../types';

type Item = { id: string; name: string; owner?: string | undefined };
type Slices = Pick<ProjectConfig, 'combos' | 'actionSets' | 'pageEnvironments' | 'atEnvironments' | 'presets'>;
type SliceKey = keyof Slices;
/** The 설정 sections this component draws: one per kind of experiment condition, plus the project's run rules. */
export const CONDITION_SECTIONS = ['presets', 'combos', 'actionSets', 'pageEnvironments', 'atEnvironments', 'runRules'] as const satisfies readonly SettingsSection[];
export type ConditionSection = (typeof CONDITION_SECTIONS)[number];
/** The task field that refers to each kind of item; presets refer to the same fields except their own. */
const TASK_FIELD = { combos: 'comboId', actionSets: 'actionSetId', pageEnvironments: 'pageEnvironmentId', atEnvironments: 'atEnvironmentId', presets: 'presetId' } as const satisfies Record<SliceKey, keyof ManagedTask>;
const same = sameValue;
/** The fields of a full set of rules that differ from Rawstep's defaults. */
function changedRules(rules: RunRules): Partial<RunRules> {
  const defaults = runRulesSchema.parse({});
  return Object.fromEntries(Object.entries(rules).filter(([key, value]) => defaults[key as keyof RunRules] !== value)) as Partial<RunRules>;
}
const newId = () => crypto.randomUUID();
const slicesOf = (config: ProjectConfig): Slices => structuredClone({ combos: config.combos, actionSets: config.actionSets, pageEnvironments: config.pageEnvironments, atEnvironments: config.atEnvironments, presets: config.presets });

/** The config with references to removed items dropped: tasks and presets that named one fall back to the usual default. */
function withoutRemoved(config: ProjectConfig, key: SliceKey, kept: readonly Item[]): ProjectConfig {
  const field = TASK_FIELD[key], ids = new Set(kept.map(item => item.id));
  const drop = <T extends object>(entry: T): T => {
    const value = (entry as Record<string, unknown>)[field];
    if (typeof value !== 'string' || ids.has(value)) return entry;
    const copy = { ...entry } as Record<string, unknown>;
    delete copy[field];
    return copy as unknown as T;
  };
  return { ...config, tasks: config.tasks.map(drop), presets: key === 'presets' ? config.presets : config.presets.map(drop) };
}

type Props = PageProps & {
  /** The section on screen; the others keep their drafts while hidden. */
  section: ConditionSection;
  navigate: (change: RouteChange) => void;
  /** Tells the 설정 navigation which sections hold unsaved edits. */
  onDirty: (dirty: Record<ConditionSection, boolean>) => void;
};

/**
 * The experiment-condition sections of 설정: presets, model combos, action sets, page and AT environments, and the project's run
 * rules. Every kind keeps its own draft and saves on its own, so leaving a section for another keeps what was typed.
 */
export function ConditionSettings({ section, navigate, onDirty, ...props }: Props) {
  const { t } = useTranslation();
  const config = props.view.config;
  const [drafts, setDrafts] = useState<Slices>(() => slicesOf(config));
  // The project's rules as overrides of Rawstep's defaults, so a field that was never changed reads as inherited.
  const [rules, setRules] = useState<Partial<RunRules>>(() => changedRules(config.runRules));
  const [showOwned, setShowOwned] = useState(false);
  const setSlice = <K extends SliceKey>(key: K) => (items: Slices[K]) => setDrafts(current => ({ ...current, [key]: items }));
  const resetSlice = (key: SliceKey) => setDrafts(current => ({ ...current, [key]: structuredClone(config[key]) }));
  /** Writes one kind of item on top of the latest config (so edits saved elsewhere are kept) and drops references to removed ones. */
  const saveSlice = (key: SliceKey) => void props.act(async () => {
    const latest = props.view.config, next = { ...withoutRemoved(latest, key, drafts[key]), [key]: drafts[key] };
    await props.save(next, undefined, props.view.revision);
    // Presets that named a removed item lost that reference; an unedited presets draft follows so it does not look changed.
    setDrafts(current => same(current.presets, latest.presets) ? { ...current, presets: next.presets } : current);
  });
  const saveRules = () => void props.act(async () => { await props.save({ ...props.view.config, runRules: runRulesSchema.parse(rules) }, undefined, props.view.revision); });
  const dirty: Record<ConditionSection, boolean> = {
    presets: !same(drafts.presets, config.presets), combos: !same(drafts.combos, config.combos), actionSets: !same(drafts.actionSets, config.actionSets),
    pageEnvironments: !same(drafts.pageEnvironments, config.pageEnvironments), atEnvironments: !same(drafts.atEnvironments, config.atEnvironments),
    runRules: !runRulesValid(rules) || !same(runRulesSchema.parse(rules), config.runRules),
  };
  const dirtyKey = JSON.stringify(dirty);
  useEffect(() => { onDirty(dirty); }, [dirtyKey]);
  const usage = (key: SliceKey, id: string) => ({
    tasks: config.tasks.filter(task => task[TASK_FIELD[key]] === id).length,
    presets: key === 'presets' ? 0 : config.presets.filter(preset => (preset as Record<string, unknown>)[TASK_FIELD[key]] === id).length,
  });
  const common = { config, busy: props.busy, showOwned, setShowOwned };
  const projectRules = runRulesValid(rules) ? runRulesSchema.parse(rules) : config.runRules;
  const head = (id: ConditionSection) => <PageHeader title={t(`settingsNav.sections.${id}`)} info={t(`settingsNav.info.${id}`)} />;

  switch (section) {
    case 'combos': return <div className="grid gap-5">{head('combos')}
      <ItemSection<Combo> {...common} kind="combos" items={drafts.combos} saved={config.combos} onItems={setSlice('combos')} onSave={() => saveSlice('combos')} onDiscard={() => resetSlice('combos')} usage={id => usage('combos', id)}
        summary={combo => comboSummary(combo, config.connections)}
        blocker={combo => { const reason = comboBlocker(combo); return reason ? t(`conditions.combo.blockers.${reason}`, { name: combo.name }) : comboSchema.safeParse(combo).success ? undefined : t('conditions.invalid', { name: combo.name }); }}
        addOptions={(['solo', 'planned'] as const).flatMap(structure => COMBO_PRESETS[structure].map(preset => ({
          id: preset, group: t(`conditions.structure.${structure}.name`), label: t(`conditions.combo.presets.${preset}.name`), hint: t(`conditions.combo.presets.${preset}.hint`),
          note: [(preset === 'decision' || preset === 'plannedDecision') && !config.connections.some(c => c.kind === 'decision') && t('conditions.combo.presets.noDecision'),
            preset !== 'blank' && preset !== 'decision' && !config.connections.some(c => c.kind === 'llm') && t('conditions.combo.presets.noLlm')].filter(Boolean).join(' '),
          make: (n: number) => comboFromPreset(preset, newId(), t('conditions.combo.newName', { n }), config.connections),
        })))}
        aside={!config.connections.length && <p className="text-[13px] leading-5 text-inspect">{t('conditions.combo.connectionsFirst')} <Link to={{ view: 'settings', section: 'connections' }} navigate={navigate} className="font-medium text-trace underline underline-offset-4">{t('conditions.combo.toConnections')}</Link></p>}
        editor={(combo, update) => <ComboEditor key={combo.id} combo={combo} onChange={update} connections={config.connections} />} />
    </div>;
    case 'actionSets': return <div className="grid gap-5">{head('actionSets')}
      <ItemSection<ActionSet> {...common} kind="actionSets" items={drafts.actionSets} saved={config.actionSets} onItems={setSlice('actionSets')} onSave={() => saveSlice('actionSets')} onDiscard={() => resetSlice('actionSets')} usage={id => usage('actionSets', id)}
        summary={set => actionSetSummary(set, props.view.capabilities)}
        blocker={set => !set.name.trim() ? t('conditions.nameMissing') : actionSetSchema.safeParse(set).success ? undefined : t('conditions.invalid', { name: set.name })}
        addOptions={ACTION_SET_PRESETS.map(preset => ({ id: preset, label: t(`conditions.actionSet.presets.${preset}.name`), hint: t(`conditions.actionSet.presets.${preset}.hint`),
          make: () => ({ id: newId(), name: t(`conditions.actionSet.presets.${preset}.name`), ...presetPermissions(preset) }) }))}
        editor={(set, update) => <ActionSetEditor key={set.id} actionSet={set} onChange={update} capabilities={props.view.capabilities} />} />
    </div>;
    case 'pageEnvironments': return <div className="grid gap-5">{head('pageEnvironments')}
      <ItemSection<PageEnvironment> {...common} kind="pageEnvironments" items={drafts.pageEnvironments} saved={config.pageEnvironments} onItems={setSlice('pageEnvironments')} onSave={() => saveSlice('pageEnvironments')} onDiscard={() => resetSlice('pageEnvironments')} usage={id => usage('pageEnvironments', id)}
        summary={environment => t('conditions.pageEnv.viewport', environmentViewport(environment.profile, props.view.environmentPresets))} mono
        blocker={environment => !environment.name.trim() ? t('conditions.nameMissing') : pageEnvironmentSchema.safeParse(environment).success ? undefined : t('conditions.invalid', { name: environment.name })}
        addOptions={[{ id: 'default', label: t('conditions.pageEnv.add'), hint: t('conditions.pageEnv.addHint'), make: (n: number) => defaultPageEnvironment(newId(), t('conditions.pageEnv.newName', { n })) }]}
        editor={(environment, update) => <PageEnvironmentEditor key={environment.id} environment={environment} onChange={update} presets={props.view.environmentPresets} />} />
    </div>;
    case 'atEnvironments': return <div className="grid gap-5">{head('atEnvironments')}
      <ItemSection<AtEnvironment> {...common} kind="atEnvironments" items={drafts.atEnvironments} saved={config.atEnvironments} onItems={setSlice('atEnvironments')} onSave={() => saveSlice('atEnvironments')} onDiscard={() => resetSlice('atEnvironments')} usage={id => usage('atEnvironments', id)}
        summary={environment => t(`conditions.backends.${environment.backend}`)}
        blocker={environment => !environment.name.trim() ? t('conditions.nameMissing') : atEnvironmentSchema.safeParse(environment).success ? undefined : t('conditions.invalid', { name: environment.name })}
        addOptions={[{ id: 'simulation', label: t('conditions.atEnv.add'), hint: t('conditions.atEnv.addHint'), make: (n: number) => defaultAtEnvironment(newId(), t('conditions.atEnv.newName', { n })) }]}
        editor={(environment, update) => <AtEnvironmentEditor key={environment.id} environment={environment} onChange={update} capabilities={props.view.capabilities} />} />
    </div>;
    case 'runRules': return <div className="grid max-w-3xl gap-5">{head('runRules')}
      <RunRulesEditor value={rules} onChange={setRules} inherited={runRulesSchema.parse({})} />
      <SaveBar dirty={dirty.runRules} busy={props.busy} blocked={runRulesValid(rules) ? undefined : t('conditions.runRules.invalid')} onSave={saveRules} onDiscard={() => setRules(changedRules(config.runRules))} />
    </div>;
    default: return <div className="grid gap-5">{head('presets')}
      <ItemSection<Preset> {...common} kind="presets" items={drafts.presets} saved={config.presets} onItems={setSlice('presets')} onSave={() => saveSlice('presets')} onDiscard={() => resetSlice('presets')} usage={id => usage('presets', id)} minItems={0}
        summary={preset => presetSummary(preset, config)}
        blocker={preset => !preset.name.trim() ? t('conditions.nameMissing') : !runRulesValid(preset.runRules ?? {}) ? t('conditions.runRules.invalid') : presetSchema.safeParse(preset).success ? undefined : t('conditions.invalid', { name: preset.name })}
        addOptions={[{ id: 'empty', label: t('conditions.preset.add'), hint: t('conditions.preset.addHint'), make: (n: number) => ({ id: newId(), name: t('conditions.preset.newName', { n }) }) }]}
        empty={t('conditions.preset.empty')}
        editor={(preset, update) => <PresetEditor key={preset.id} preset={preset} onChange={update} config={config} projectRules={projectRules} />} />
    </div>;
  }
}

function presetSummary(preset: Preset, config: ProjectConfig): string {
  const names = [
    config.combos.find(c => c.id === preset.comboId)?.name, config.actionSets.find(a => a.id === preset.actionSetId)?.name,
    config.pageEnvironments.find(e => e.id === preset.pageEnvironmentId)?.name, config.atEnvironments.find(e => e.id === preset.atEnvironmentId)?.name,
  ].filter(Boolean);
  const overrides = Object.keys(preset.runRules ?? {}).length;
  return [names.join(' · '), overrides ? translate('conditions.preset.rulesOverridden', { count: overrides }) : ''].filter(Boolean).join(' · ') || translate('conditions.preset.nothing');
}

/** A preset: the condition of each kind it names (or the first shared item when it names none), and run rules over the project's. */
function PresetEditor({ preset, onChange, config, projectRules }: { preset: Preset; onChange: (p: Preset) => void; config: ProjectConfig; projectRules: RunRules }) {
  const { t } = useTranslation();
  const NONE = '__none__';
  const pick = (field: 'comboId' | 'actionSetId' | 'pageEnvironmentId' | 'atEnvironmentId', list: readonly Item[], label: string) => {
    const options = list.filter(item => !item.owner || item.id === preset[field]);
    return <Choice label={label} value={preset[field] ?? NONE}
      onChange={next => { const { [field]: _old, ...rest } = preset; onChange(next === NONE ? rest : { ...rest, [field]: next }); }}
      options={[{ id: NONE, name: t('conditions.preset.firstShared') }, ...options.map(item => ({ id: item.id, name: item.name }))]} />;
  };
  return <div className="grid gap-8">
    <section className="grid gap-3" aria-labelledby="preset-conditions">
      <h3 id="preset-conditions" className="text-sm font-semibold">{t('conditions.preset.conditionsTitle')}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {pick('comboId', config.combos, t('settingsNav.sections.combos'))}
        {pick('actionSetId', config.actionSets, t('settingsNav.sections.actionSets'))}
        {pick('pageEnvironmentId', config.pageEnvironments, t('settingsNav.sections.pageEnvironments'))}
        {pick('atEnvironmentId', config.atEnvironments, t('settingsNav.sections.atEnvironments'))}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t('conditions.preset.savedOnly')}</p>
    </section>
    <section className="grid gap-3" aria-labelledby="preset-rules">
      <h3 id="preset-rules" className="text-sm font-semibold">{t('conditions.preset.rulesTitle')}</h3>
      <RunRulesEditor compact value={preset.runRules ?? {}} inherited={projectRules} inheritedLabel={t('conditions.runRules.projectDefault')}
        onChange={runRules => { const { runRules: _old, ...rest } = preset; onChange(Object.keys(runRules).length ? { ...rest, runRules } : rest); }} />
    </section>
  </div>;
}

type AddOption<T> = { id: string; label: string; hint: string; group?: string; note?: string; make: (n: number) => T };
type SectionProps<T extends Item> = {
  kind: SliceKey; config: ProjectConfig; busy: boolean; showOwned: boolean; setShowOwned: (on: boolean) => void;
  items: T[]; saved: readonly T[]; onItems: (items: T[]) => void; onSave: () => void; onDiscard: () => void;
  summary: (item: T) => string; usage: (id: string) => { tasks: number; presets: number }; blocker: (item: T) => string | undefined;
  addOptions: AddOption<T>[]; editor: (item: T, update: (item: T) => void) => ReactNode;
  /** The fewest items the project may have of this kind. */
  minItems?: number; mono?: boolean; aside?: ReactNode; empty?: string;
};

/**
 * One kind of condition: the list on the left with 추가 under it (shared items; task-only copies on request), the chosen item on the
 * right — its name and where it is used, 복제 and 삭제 in a ⋯ menu, then its editor. Edits of every item of this kind save together
 * from the bar at the bottom.
 */
function ItemSection<T extends Item>({ kind, config, busy, showOwned, setShowOwned, items, saved, onItems, onSave, onDiscard, summary, usage, blocker, addOptions, editor, minItems = 1, mono, aside, empty }: SectionProps<T>) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | undefined>(() => (items.find(item => !item.owner) ?? items[0])?.id);
  const owned = items.filter(item => item.owner);
  const visible = showOwned ? items : items.filter(item => !item.owner);
  const selected = visible.find(item => item.id === selectedId) ?? visible[0];
  const changes = items.filter(item => !same(item, saved.find(s => s.id === item.id))).length + saved.filter(s => !items.some(item => item.id === s.id)).length;
  const blocked = items.map(item => blocker(item)).find(Boolean);
  const update = (next: T) => onItems(items.map(item => item.id === next.id ? next : item));
  const add = (item: T) => { onItems([...items, item]); setSelectedId(item.id); };
  const duplicate = (item: T) => {
    const { owner: _owner, copiedFrom: _from, ...rest } = item as T & { copiedFrom?: string };
    add({ ...rest, id: newId(), name: t('conditions.bar.copyName', { name: item.name }) } as T);
  };
  const remove = (item: T) => {
    const next = items.filter(other => other.id !== item.id);
    onItems(next); setSelectedId((next.find(other => !other.owner) ?? next[0])?.id);
  };
  const ownedLabel = (owner: string) => { const task = config.tasks.find(entry => entry.id === owner); return task ? t('conditions.list.ownedBy', { task: task.name }) : t('conditions.list.owned'); };
  const used = selected ? usage(selected.id) : undefined;
  const usedLine = selected && (selected.owner ? ownedLabel(selected.owner)
    : [t('conditions.list.shared'), used?.tasks ? t('conditions.list.usedBy', { count: used.tasks }) : '', used?.presets ? t('conditions.list.usedByPresets', { count: used.presets }) : '', used && !used.tasks && !used.presets ? t('conditions.list.unused') : ''].filter(Boolean).join(' · '));
  const groups = [...new Set(addOptions.map(option => option.group ?? ''))];
  const ownedId = `owned-${kind}`;
  return <div className="grid gap-4">
    <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="grid gap-3">
        {visible.length > 0 && <ul aria-label={t(`conditions.listLabel.${kind}`)} className="grid border-y border-edge-strong">
          {visible.map(item => <li key={item.id} className="border-b border-edge last:border-b-0">
            <button type="button" aria-current={item.id === selected?.id ? 'true' : undefined} onClick={() => setSelectedId(item.id)}
              data-selected={item.id === selected?.id} className={cn('row-rail rail-divider grid min-h-11 w-full gap-0.5 py-2 pr-3 pl-4 text-left text-sm', item.id === selected?.id ? 'bg-trace-soft font-medium' : 'hover:bg-raised')}>
              <span className="break-words">{item.name || t('conditions.unnamed')}{!same(item, saved.find(s => s.id === item.id)) && <span className="ml-1 text-trace" aria-label={t('conditions.unsavedMark')}>•</span>}</span>
              {item.owner && <span className="text-xs leading-4 font-normal text-inspect">{ownedLabel(item.owner)}</span>}
              <span className={cn('text-xs leading-4 font-normal break-words text-muted-foreground', mono && 'font-mono')}>{summary(item)}</span>
            </button>
          </li>)}
        </ul>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" className="justify-self-start"><Plus aria-hidden="true" />{t(`conditions.add.${kind}`)}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80">
            {groups.map((group, index) => <div key={group}>
              {index > 0 && <DropdownMenuSeparator />}
              {group && <DropdownMenuLabel className="text-xs text-muted-foreground">{group}</DropdownMenuLabel>}
              {addOptions.filter(option => (option.group ?? '') === group).map(option => <DropdownMenuItem key={option.id} onSelect={() => add(option.make(items.length + 1))} className="grid items-start gap-0.5">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs leading-4 text-muted-foreground">{option.hint}</span>
                {option.note && <span className="text-xs leading-4 text-inspect">{option.note}</span>}
              </DropdownMenuItem>)}
            </div>)}
          </DropdownMenuContent>
        </DropdownMenu>
        {owned.length > 0 && <div className="flex items-center gap-2">
          <Checkbox id={ownedId} checked={showOwned} onCheckedChange={value => setShowOwned(value === true)} />
          <Label htmlFor={ownedId} className="text-[13px] font-normal text-muted-foreground">{t('conditions.list.showOwnedCount', { count: owned.length })}</Label>
        </div>}
        {aside}
      </div>
      <div className="grid min-w-0 content-start gap-6">
        {selected ? <>
          <div className="flex items-start justify-between gap-3 border-b border-edge pb-3">
            <div className="grid min-w-0 flex-1 gap-1">
              <Label htmlFor={`name-${kind}`} className="sr-only">{t('conditions.bar.name')}</Label>
              <Input id={`name-${kind}`} value={selected.name} onChange={event => update({ ...selected, name: event.target.value })} className="h-9 max-w-md text-base font-semibold" />
              <p className="text-xs leading-5 text-muted-foreground">{usedLine}</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t('conditions.bar.more', { name: selected.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => duplicate(selected)}><Copy aria-hidden="true" />{t('conditions.bar.duplicate')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={items.length <= minItems} onSelect={() => remove(selected)}><Trash2 aria-hidden="true" />{items.length <= minItems ? t('conditions.bar.deleteLast') : t('conditions.bar.delete')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {editor(selected, update)}
        </> : <p className="text-sm text-muted-foreground">{empty ?? t('conditions.nothingSelected')}</p>}
      </div>
    </div>
    {changes > 0 && saved.some(item => !items.some(kept => kept.id === item.id)) && <p className="text-xs leading-5 text-inspect">{t('conditions.bar.deleteNote')}</p>}
    <SaveBar dirty={changes > 0} changes={changes} busy={busy} blocked={blocked} onSave={onSave} onDiscard={onDiscard} />
  </div>;
}
