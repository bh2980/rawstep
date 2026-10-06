import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, Trash2 } from 'lucide-react';
import {
  actionSetSchema, atEnvironmentSchema, comboSchema, defaultAtEnvironment, defaultPageEnvironment, pageEnvironmentSchema, presetSchema, runRulesSchema,
  type ActionSet, type AtEnvironment, type Combo, type ManagedTask, type PageEnvironment, type Preset, type ProjectConfig, type RunRules,
} from '@rawstep/project/config';
import type { RouteChange } from '../hooks/useRoute';
import { ActionSetEditor } from '../components/conditions/ActionSetEditor';
import { AtEnvironmentEditor } from '../components/conditions/AtEnvironmentEditor';
import { ComboEditor } from '../components/conditions/ComboEditor';
import { PageEnvironmentEditor } from '../components/conditions/PageEnvironmentEditor';
import { RunRulesEditor, runRulesValid } from '../components/conditions/RunRulesEditor';
import { SaveBar } from '../components/conditions/SaveBar';
import { Choice, Field, Toggle } from '../components/forms';
import { ConceptNote } from '../components/layout/ConceptNote';
import { PageHeader, SectionHead } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { Button } from '../components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  actionSetSummary, COMBO_PRESETS, sameValue, comboBlocker, comboFromPreset, comboSummary, environmentViewport, runRulesSummary,
} from '../lib/conditions';
import { ACTION_SET_PRESETS, presetPermissions } from '../lib/presets';
import { cn } from '../lib/utils';
import { t as translate } from '../i18n/index.js';
import type { PageProps } from './types';

type Item = { id: string; name: string; owner?: string | undefined };
type Slices = Pick<ProjectConfig, 'combos' | 'actionSets' | 'pageEnvironments' | 'atEnvironments' | 'presets'>;
type SliceKey = keyof Slices;
/** The task field that refers to each kind of item; presets refer to the same fields except their own. */
const TASK_FIELD = { combos: 'comboId', actionSets: 'actionSetId', pageEnvironments: 'pageEnvironmentId', atEnvironments: 'atEnvironmentId', presets: 'presetId' } as const satisfies Record<SliceKey, keyof ManagedTask>;
const TABS = ['combos', 'actionSets', 'environments', 'runRules', 'presets'] as const;
type Tab = (typeof TABS)[number];
const same = sameValue;
/** The fields of a full set of rules that differ from Rawstep's defaults. */
function changedRules(rules: RunRules): Partial<RunRules> {
  const defaults = runRulesSchema.parse({});
  return Object.fromEntries(Object.entries(rules).filter(([key, value]) => defaults[key as keyof RunRules] !== value)) as Partial<RunRules>;
}
const newId = () => crypto.randomUUID();

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

/**
 * 실험 조건: the named conditions a run is made of — model combos, action sets, page and assistive technology environments, the
 * project's run rules and presets that bundle them. It is a place to manage them, never a step a run has to go through: a task can pick,
 * edit or create each condition where it runs. Task-only copies stay out of the lists unless asked for.
 */
export function ConditionsPage({ navigate, ...props }: PageProps & { navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const config = props.view.config;
  const [tab, setTab] = useState<Tab>('combos');
  const [drafts, setDrafts] = useState<Slices>(() => structuredClone({ combos: config.combos, actionSets: config.actionSets, pageEnvironments: config.pageEnvironments, atEnvironments: config.atEnvironments, presets: config.presets }));
  // The project's rules as overrides of Rawstep's defaults, so a field that was never changed reads as inherited.
  const [rules, setRules] = useState<Partial<RunRules>>(() => changedRules(config.runRules));
  const [showOwned, setShowOwned] = useState(false);
  const setSlice = <K extends SliceKey>(key: K) => (items: Slices[K]) => setDrafts(current => ({ ...current, [key]: items }));
  /** Writes one kind of item on top of the latest config (so edits saved elsewhere are kept) and drops references to removed ones. */
  const saveSlice = (key: SliceKey) => void props.act(async () => {
    const latest = props.view.config, next = { ...withoutRemoved(latest, key, drafts[key]), [key]: drafts[key] };
    await props.save(next, undefined, props.view.revision);
    // Presets that named a removed item lost that reference; an unedited presets draft follows so it does not look changed.
    setDrafts(current => same(current.presets, latest.presets) ? { ...current, presets: next.presets } : current);
  });
  const saveRules = () => void props.act(async () => { await props.save({ ...props.view.config, runRules: runRulesSchema.parse(rules) }, undefined, props.view.revision); });
  const dirty: Record<Tab, boolean> = {
    combos: !same(drafts.combos, config.combos), actionSets: !same(drafts.actionSets, config.actionSets),
    environments: !same(drafts.pageEnvironments, config.pageEnvironments) || !same(drafts.atEnvironments, config.atEnvironments),
    runRules: !runRulesValid(rules) || !same(runRulesSchema.parse(rules), config.runRules), presets: !same(drafts.presets, config.presets),
  };
  const usage = (key: SliceKey, id: string) => ({
    tasks: config.tasks.filter(task => task[TASK_FIELD[key]] === id).length,
    presets: key === 'presets' ? 0 : config.presets.filter(preset => (preset as Record<string, unknown>)[TASK_FIELD[key]] === id).length,
  });
  const common = { config, busy: props.busy, showOwned, setShowOwned };
  const projectRules = runRulesValid(rules) ? runRulesSchema.parse(rules) : config.runRules;
  return <div className="grid gap-5">
    <PageHeader title={t('conditions.heading')} description={t('conditions.intro')} />
    <ConceptNote concept="conditions" />
    <Tabs value={tab} onValueChange={value => setTab(value as Tab)} className="gap-5">
      <TabsList variant="line" aria-label={t('conditions.tabsLabel')} className="overflow-x-auto overflow-y-hidden">
        {TABS.map(id => <TabsTrigger key={id} value={id}>{t(`conditions.tabs.${id}`)}{dirty[id] && <span className="ml-1 text-trace" aria-label={t('conditions.unsavedMark')}>•</span>}</TabsTrigger>)}
      </TabsList>

      <TabsContent value="combos">
        <ItemSection<Combo> {...common} kind="combos" items={drafts.combos} saved={config.combos} onItems={setSlice('combos')} onSave={() => saveSlice('combos')} usage={id => usage('combos', id)}
          summary={combo => comboSummary(combo, config.connections)}
          blocker={combo => { const reason = comboBlocker(combo); return reason ? t(`conditions.combo.blockers.${reason}`, { name: combo.name }) : comboSchema.safeParse(combo).success ? undefined : t('conditions.invalid', { name: combo.name }); }}
          addOptions={(['solo', 'planned'] as const).flatMap(structure => COMBO_PRESETS[structure].map(preset => ({
            id: preset, group: t(`conditions.structure.${structure}.name`), label: t(`conditions.combo.presets.${preset}.name`), hint: t(`conditions.combo.presets.${preset}.hint`),
            note: [(preset === 'decision' || preset === 'plannedDecision') && !config.connections.some(c => c.kind === 'decision') && t('conditions.combo.presets.noDecision'),
              preset !== 'blank' && preset !== 'decision' && !config.connections.some(c => c.kind === 'llm') && t('conditions.combo.presets.noLlm')].filter(Boolean).join(' '),
            make: (n: number) => comboFromPreset(preset, newId(), t('conditions.combo.newName', { n }), config.connections),
          })))}
          aside={!config.connections.length && <p className="text-xs leading-5 text-muted-foreground">{t('conditions.combo.connectionsFirst')} <Link to={{ view: 'connections' }} navigate={navigate} className="font-semibold text-trace underline underline-offset-4">{t('conditions.combo.toConnections')}</Link></p>}
          editor={(combo, update) => <ComboEditor key={combo.id} combo={combo} onChange={update} connections={config.connections} />} />
      </TabsContent>

      <TabsContent value="actionSets">
        <ItemSection<ActionSet> {...common} kind="actionSets" items={drafts.actionSets} saved={config.actionSets} onItems={setSlice('actionSets')} onSave={() => saveSlice('actionSets')} usage={id => usage('actionSets', id)}
          summary={set => actionSetSummary(set, props.view.capabilities)}
          blocker={set => !set.name.trim() ? t('conditions.nameMissing') : actionSetSchema.safeParse(set).success ? undefined : t('conditions.invalid', { name: set.name })}
          addOptions={ACTION_SET_PRESETS.map(preset => ({ id: preset, label: t(`conditions.actionSet.presets.${preset}.name`), hint: t(`conditions.actionSet.presets.${preset}.hint`),
            make: () => ({ id: newId(), name: t(`conditions.actionSet.presets.${preset}.name`), ...presetPermissions(preset) }) }))}
          editor={(set, update) => <ActionSetEditor key={set.id} actionSet={set} onChange={update} capabilities={props.view.capabilities} />} />
      </TabsContent>

      <TabsContent value="environments" className="grid gap-10">
        <section aria-labelledby="page-environments" className="grid gap-3">
          <SectionHead id="page-environments" title={t('conditions.pageEnv.title')} aside={t('conditions.pageEnv.aside')} />
          <ItemSection<PageEnvironment> {...common} kind="pageEnvironments" items={drafts.pageEnvironments} saved={config.pageEnvironments} onItems={setSlice('pageEnvironments')} onSave={() => saveSlice('pageEnvironments')} usage={id => usage('pageEnvironments', id)}
            summary={environment => t('conditions.pageEnv.viewport', environmentViewport(environment.profile, props.view.environmentPresets))} mono
            blocker={environment => !environment.name.trim() ? t('conditions.nameMissing') : pageEnvironmentSchema.safeParse(environment).success ? undefined : t('conditions.invalid', { name: environment.name })}
            addOptions={[{ id: 'default', label: t('conditions.pageEnv.add'), hint: t('conditions.pageEnv.addHint'), make: (n: number) => defaultPageEnvironment(newId(), t('conditions.pageEnv.newName', { n })) }]}
            editor={(environment, update) => <PageEnvironmentEditor key={environment.id} environment={environment} onChange={update} presets={props.view.environmentPresets} />} />
        </section>
        <section aria-labelledby="at-environments" className="grid gap-3">
          <SectionHead id="at-environments" title={t('conditions.atEnv.title')} aside={t('conditions.atEnv.aside')} />
          <ItemSection<AtEnvironment> {...common} kind="atEnvironments" items={drafts.atEnvironments} saved={config.atEnvironments} onItems={setSlice('atEnvironments')} onSave={() => saveSlice('atEnvironments')} usage={id => usage('atEnvironments', id)}
            summary={environment => t(`conditions.backends.${environment.backend}`)}
            blocker={environment => !environment.name.trim() ? t('conditions.nameMissing') : atEnvironmentSchema.safeParse(environment).success ? undefined : t('conditions.invalid', { name: environment.name })}
            addOptions={[{ id: 'simulation', label: t('conditions.atEnv.add'), hint: t('conditions.atEnv.addHint'), make: (n: number) => defaultAtEnvironment(newId(), t('conditions.atEnv.newName', { n })) }]}
            editor={(environment, update) => <AtEnvironmentEditor key={environment.id} environment={environment} onChange={update} capabilities={props.view.capabilities} />} />
        </section>
      </TabsContent>

      <TabsContent value="runRules" className="grid gap-5">
        <SaveBar dirty={dirty.runRules} busy={props.busy} blocked={runRulesValid(rules) ? undefined : t('conditions.runRules.invalid')} onSave={saveRules}
          lead={<div className="grid gap-0.5"><p className="text-sm font-semibold">{t('conditions.runRules.projectTitle')}</p><p className="text-xs leading-5 text-muted-foreground">{t('conditions.runRules.projectIntro')}</p></div>} />
        <RunRulesEditor value={rules} onChange={setRules} inherited={runRulesSchema.parse({})} />
      </TabsContent>

      <TabsContent value="presets">
        <ItemSection<Preset> {...common} kind="presets" items={drafts.presets} saved={config.presets} onItems={setSlice('presets')} onSave={() => saveSlice('presets')} usage={id => usage('presets', id)} minItems={0}
          summary={preset => presetSummary(preset, config)}
          blocker={preset => !preset.name.trim() ? t('conditions.nameMissing') : !runRulesValid(preset.runRules ?? {}) ? t('conditions.runRules.invalid') : presetSchema.safeParse(preset).success ? undefined : t('conditions.invalid', { name: preset.name })}
          addOptions={[{ id: 'empty', label: t('conditions.preset.add'), hint: t('conditions.preset.addHint'), make: (n: number) => ({ id: newId(), name: t('conditions.preset.newName', { n }) }) }]}
          empty={t('conditions.preset.empty')}
          editor={(preset, update) => <PresetEditor key={preset.id} preset={preset} onChange={update} config={config} projectRules={projectRules} />} />
      </TabsContent>
    </Tabs>
  </div>;
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
  return <div className="grid gap-6">
    <section className="grid gap-4" aria-labelledby="preset-conditions">
      <h3 id="preset-conditions" className="border-b border-edge-strong pb-1.5 text-sm font-semibold">{t('conditions.preset.conditionsTitle')}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {pick('comboId', config.combos, t('conditions.tabs.combos'))}
        {pick('actionSetId', config.actionSets, t('conditions.tabs.actionSets'))}
        {pick('pageEnvironmentId', config.pageEnvironments, t('conditions.pageEnv.title'))}
        {pick('atEnvironmentId', config.atEnvironments, t('conditions.atEnv.title'))}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{t('conditions.preset.savedOnly')}</p>
    </section>
    <section className="grid gap-3" aria-labelledby="preset-rules">
      <h3 id="preset-rules" className="border-b border-edge-strong pb-1.5 text-sm font-semibold">{t('conditions.preset.rulesTitle')}</h3>
      <p className="text-xs leading-5 text-muted-foreground">{t('conditions.preset.rulesIntro', { rules: runRulesSummary(projectRules) })}</p>
      <RunRulesEditor compact value={preset.runRules ?? {}} inherited={projectRules} inheritedLabel={t('conditions.runRules.projectDefault')}
        onChange={runRules => { const { runRules: _old, ...rest } = preset; onChange(Object.keys(runRules).length ? { ...rest, runRules } : rest); }} />
    </section>
  </div>;
}

type AddOption<T> = { id: string; label: string; hint: string; group?: string; note?: string; make: (n: number) => T };
type SectionProps<T extends Item> = {
  kind: SliceKey; config: ProjectConfig; busy: boolean; showOwned: boolean; setShowOwned: (on: boolean) => void;
  items: T[]; saved: readonly T[]; onItems: (items: T[]) => void; onSave: () => void;
  summary: (item: T) => string; usage: (id: string) => { tasks: number; presets: number }; blocker: (item: T) => string | undefined;
  addOptions: AddOption<T>[]; editor: (item: T, update: (item: T) => void) => ReactNode;
  /** The fewest items the project may have of this kind. */
  minItems?: number; mono?: boolean; aside?: ReactNode; empty?: string;
};

/**
 * One kind of condition: the list on the left (shared items; task-only copies on request, with their task) and the chosen item's
 * editor on the right, with 저장 · 복제 · 삭제 and the save state at its top. 저장 writes every item of this kind at once.
 */
function ItemSection<T extends Item>({ kind, config, busy, showOwned, setShowOwned, items, saved, onItems, onSave, summary, usage, blocker, addOptions, editor, minItems = 1, mono, aside, empty }: SectionProps<T>) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | undefined>(() => (items.find(item => !item.owner) ?? items[0])?.id);
  const [adding, setAdding] = useState(false);
  const owned = items.filter(item => item.owner);
  const visible = showOwned ? items : items.filter(item => !item.owner);
  const selected = visible.find(item => item.id === selectedId) ?? visible[0];
  const changes = items.filter(item => !same(item, saved.find(s => s.id === item.id))).length + saved.filter(s => !items.some(item => item.id === s.id)).length;
  const blocked = items.map(item => blocker(item)).find(Boolean);
  const update = (next: T) => onItems(items.map(item => item.id === next.id ? next : item));
  const add = (item: T) => { onItems([...items, item]); setSelectedId(item.id); setAdding(false); };
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
  const groups = [...new Set(addOptions.map(option => option.group ?? ''))];
  return <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
    <div className="grid gap-3">
      {visible.length > 0 && <ul aria-label={t(`conditions.listLabel.${kind}`)} className="grid border-y border-edge-strong">
        {visible.map(item => <li key={item.id} className="border-b border-edge last:border-b-0">
          <button type="button" aria-current={item.id === selected?.id ? 'true' : undefined} onClick={() => setSelectedId(item.id)}
            data-selected={item.id === selected?.id} className={cn('row-rail rail-divider grid min-h-11 w-full gap-0.5 py-2.5 pr-3 pl-4 text-left text-sm', item.id === selected?.id ? 'bg-trace-soft font-medium' : 'hover:bg-raised')}>
            <span className="break-words">{item.name || t('conditions.unnamed')}{!same(item, saved.find(s => s.id === item.id)) && <span className="ml-1 text-trace" aria-label={t('conditions.unsavedMark')}>•</span>}</span>
            {item.owner && <span className="text-xs leading-4 font-normal text-inspect">{ownedLabel(item.owner)}</span>}
            <span className={cn('text-xs leading-4 font-normal break-words text-muted-foreground', mono && 'font-mono')}>{summary(item)}</span>
          </button>
        </li>)}
      </ul>}
      {owned.length > 0 && <Toggle label={t('conditions.list.showOwned')} hint={showOwned ? undefined : t('conditions.list.hiddenOwned', { count: owned.length })} checked={showOwned} onChange={setShowOwned} />}
      <Collapsible open={adding} onOpenChange={setAdding} className="grid gap-2">
        <CollapsibleTrigger asChild><Button variant="outline"><Plus aria-hidden="true" />{t(`conditions.add.${kind}`)}</Button></CollapsibleTrigger>
        <CollapsibleContent className="grid gap-2">
          {groups.map(group => <div key={group} className="grid gap-1">
            {group && <p className="pl-1 text-xs font-medium text-muted-foreground">{group}</p>}
            <ul className="grid border-y border-edge-strong">
              {addOptions.filter(option => (option.group ?? '') === group).map(option => <li key={option.id} className="border-b border-edge last:border-b-0">
                <button type="button" onClick={() => add(option.make(items.length + 1))} className="grid w-full gap-0.5 py-2 pr-3 pl-4 text-left text-sm hover:bg-raised">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs leading-4 text-muted-foreground">{option.hint}</span>
                  {option.note && <span className="text-xs leading-4 text-inspect">{option.note}</span>}
                </button>
              </li>)}
            </ul>
          </div>)}
        </CollapsibleContent>
      </Collapsible>
      {aside}
    </div>
    <div className="grid min-w-0 gap-5">
      <SaveBar dirty={changes > 0} changes={changes} busy={busy} blocked={blocked} onSave={onSave}
        lead={selected && <div className="grid max-w-md gap-1">
          <Field label={t('conditions.bar.name')} value={selected.name} onChange={name => update({ ...selected, name })} />
          <p className="text-xs leading-5 text-muted-foreground">
            {selected.owner ? ownedLabel(selected.owner)
              : [t('conditions.list.shared'), used && used.tasks ? t('conditions.list.usedBy', { count: used.tasks }) : '', used && used.presets ? t('conditions.list.usedByPresets', { count: used.presets }) : '', used && !used.tasks && !used.presets ? t('conditions.list.unused') : ''].filter(Boolean).join(' · ')}
          </p>
        </div>}>
        {selected && <>
          <Button variant="outline" onClick={() => duplicate(selected)}><Copy aria-hidden="true" />{t('conditions.bar.duplicate')}</Button>
          <Button variant="outline" disabled={items.length <= minItems} title={items.length <= minItems ? t('conditions.bar.deleteLast') : undefined} onClick={() => remove(selected)}><Trash2 aria-hidden="true" />{t('conditions.bar.delete')}</Button>
        </>}
      </SaveBar>
      {selected && used && (used.tasks > 0 || used.presets > 0) && <p className="-mt-2 text-xs leading-5 text-muted-foreground">{t('conditions.bar.deleteNote')}</p>}
      {selected ? editor(selected, update) : <p className="text-sm text-muted-foreground">{empty ?? t('conditions.nothingSelected')}</p>}
    </div>
  </div>;
}
