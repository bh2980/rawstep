import { useId, useState, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  resolveRunRules, taskConditions,
  type ActionSet, type AtEnvironment, type Combo, type ManagedTask, type Mode, type PageEnvironment, type ProjectConfig, type RunRulesOverride,
} from '@rawstep/project/config';
import type { RouteChange } from '../hooks/useRoute';
import { actionSetSummary, choiceName, comboModesOf, comboSummary, environmentViewport, runRulesSummary } from '../lib/conditions';
import { QUICK_RUN_REPEATS, comboProblem, type RunOptions } from '../lib/quickRun';
import type { RunRef } from '../lib/runs';
import {
  CONDITION_KINDS, FIELD, LIST, blankItem, conditionSource, freshId, pointTask, selectable, taskCopy, withItem, withTask,
  type ConditionKind, type ConditionSource,
} from '../lib/taskConditions';
import { cn } from '../lib/utils';
import type { PageProps } from '../pages/types';
import { ActionSetEditor } from './conditions/ActionSetEditor';
import { AtEnvironmentEditor } from './conditions/AtEnvironmentEditor';
import { ComboEditor } from './conditions/ComboEditor';
import { PageEnvironmentEditor } from './conditions/PageEnvironmentEditor';
import { RunRulesEditor, runRulesValid } from './conditions/RunRulesEditor';
import { Link } from './Link';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type Props = {
  pageProps: PageProps;
  /** The task whose conditions the box shows and changes. */
  taskId: string;
  /** Runs of this task that are queued or running. */
  active: RunRef[];
  onRun: (options: RunOptions) => void; onCompare: () => void;
  navigate: (change: RouteChange) => void;
};
type Owned = { id: string; name: string; owner?: string | undefined; copiedFrom?: string | undefined };
/** The editor open in the box: a condition being changed (a task-only copy, a copy of a shared item, or a new item) or the task's run rules. */
type Editing = { kind: ConditionKind; draft: Owned; mode: 'own' | 'copy' | 'new' } | { kind: 'runRules'; draft: RunRulesOverride };

const MAX_REPEATS = 20;
const NO_PRESET = '__none__';
const label = 'text-[11px] leading-4 font-medium tracking-[0.08em] text-muted-foreground uppercase';
const chip = 'inline-flex items-center rounded-sm border px-1.5 text-[11px] leading-5 whitespace-nowrap';

/**
 * The run box of a task (spec §5): the mode (starting at one the model combo can run), the run preset, and the five experiment
 * conditions, each marked as shared, task-only or from the preset. Every condition can be loaded from the shared items or this task's
 * own, changed in place, or made new; changing a shared item makes a copy only this task uses and leaves the shared one as it was.
 * Saving a copy as shared, or the conditions as a preset, happens only when a person asks. Below the conditions it names the models
 * this run uses by role, separating the experiment conditions (planner, executor) from the commentary that never changes a result.
 * Every change is saved to the project at once; the element has the id `task-run-control` so an empty state can send a person here.
 */
export function RunControl({ pageProps, taskId, active, onRun, onCompare, navigate }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const { view, busy } = pageProps, config = view.config, task = config.tasks.find(item => item.id === taskId);
  const [picked, setMode] = useState<Mode>();
  const [editing, setEditing] = useState<Editing>();
  const [presetName, setPresetName] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [repeats, setRepeats] = useState(String(QUICK_RUN_REPEATS));
  if (!task) return null;
  const conditions = taskConditions(config, task), preset = conditions.preset, combo = conditions.combo;
  const modes = comboModesOf(combo, config.connections);
  const mode: Mode = picked && (modes.includes(picked) || !modes.length) ? picked : modes[0] ?? 'screenreader';
  const problem = comboProblem(config, view.credentialStatus, combo, mode);
  const count = Number(repeats), valid = Number.isInteger(count) && count >= 1 && count <= MAX_REPEATS;
  const inputNames = Object.keys((view.tasks[taskId] as { input?: Record<string, unknown> } | undefined)?.input ?? {});
  const newest = active[0];

  /** Saves the project with a change and, when given, says what happened in one line. */
  const persist = (next: ProjectConfig, message?: string, after?: () => void) => void pageProps.act(async () => {
    await pageProps.save(next, undefined, view.revision);
    after?.(); setNotice(message);
  });
  const updateTask = (change: (entry: ManagedTask) => ManagedTask, message?: string, base: ProjectConfig = config) => persist(withTask(base, taskId, change), message, () => setEditing(undefined));
  const load = (kind: ConditionKind, itemId: string) => updateTask(entry => pointTask(entry, kind, itemId));
  const startEdit = (kind: ConditionKind, source: ConditionSource) => {
    setNotice(undefined);
    setEditing(source.own ? { kind, draft: structuredClone(source.item), mode: 'own' } : { kind, draft: taskCopy(source.item, config[LIST[kind]] as readonly Owned[], task), mode: 'copy' });
  };
  const startNew = (kind: Exclude<ConditionKind, 'atEnvironment'>) => { setNotice(undefined); setEditing({ kind, draft: blankItem(kind, config, task, t('runBox.newName', { kind: t(`runConditions.${kind}`), task: task.name })), mode: 'new' }); };
  const saveEdit = () => {
    if (!editing) return;
    if (editing.kind === 'runRules') { const rules = editing.draft; updateTask(entry => { const copy = { ...entry }; if (Object.keys(rules).length) copy.runRules = rules; else delete copy.runRules; return copy; }); return; }
    const { kind, draft } = editing, original = conditionSource(config, task, kind).item;
    updateTask(entry => pointTask(entry, kind, draft.id),
      editing.mode === 'copy' ? t('runBox.copied', { name: original.name }) : editing.mode === 'new' ? t('runBox.created', { name: draft.name }) : t('runBox.savedOwn', { name: draft.name }),
      withItem(config, kind, draft));
  };
  const shareItem = (kind: ConditionKind, item: Owned) => {
    const { owner: _owner, ...shared } = item;
    persist(withItem(config, kind, shared), t('runBox.shared', { name: item.name }));
  };
  const revert = (kind: ConditionKind, item: Owned) => {
    // The copy is this task's alone, so it goes once the task points back at the shared item.
    const list = (config[LIST[kind]] as readonly Owned[]).filter(entry => entry.id !== item.id);
    updateTask(entry => pointTask(entry, kind, item.copiedFrom), t('runBox.reverted', { name: item.name }), { ...config, [LIST[kind]]: list } as ProjectConfig);
  };
  const choosePreset = (presetId: string) => updateTask(entry => {
    const next = { ...entry };
    for (const kind of CONDITION_KINDS) delete next[FIELD[kind]];
    if (presetId === NO_PRESET) { delete next.presetId; return { ...next, comboId: combo.id, actionSetId: conditions.actionSet.id, pageEnvironmentId: conditions.pageEnvironment.id, atEnvironmentId: conditions.atEnvironment.id }; }
    return { ...next, presetId };
  });
  const savePreset = () => {
    const name = presetName?.trim();
    if (!name) return;
    const presetId = freshId(`preset-${name.toLowerCase()}`, config.presets);
    // A preset is shared, so it names shared items only: a task-only copy is represented by the item it was copied from, and the
    // task keeps pointing at its own copy for that condition.
    const shared = (item: Owned) => item.owner ? item.copiedFrom ?? item.id : item.id;
    const owned = (kind: ConditionKind) => !!(conditions[kind] as Owned).owner;
    const created = { id: presetId, name, comboId: shared(combo), actionSetId: shared(conditions.actionSet), pageEnvironmentId: shared(conditions.pageEnvironment), atEnvironmentId: conditions.atEnvironment.id,
      ...(task.runRules ? { runRules: structuredClone(task.runRules) } : {}) };
    setPresetName(undefined);
    updateTask(entry => { const next = { ...entry, presetId }; for (const kind of CONDITION_KINDS) if (!owned(kind)) delete next[FIELD[kind]]; return next; }, t('runBox.presetSaved', { name }), { ...config, presets: [...config.presets, created] });
  };

  const summary = (kind: ConditionKind, item: Owned): string => {
    switch (kind) {
      case 'combo': return comboSummary(item as Combo, config.connections, mode);
      case 'actionSet': return actionSetSummary(item as ActionSet, view.capabilities);
      case 'pageEnvironment': { const { width, height } = environmentViewport((item as PageEnvironment).profile, view.environmentPresets); return `${width} × ${height}`; }
      default: return t(`conditions.backends.${(item as AtEnvironment).backend}`);
    }
  };
  const editor = (current: Extract<Editing, { kind: ConditionKind }>): ReactNode => {
    const set = (draft: Owned) => setEditing({ ...current, draft });
    switch (current.kind) {
      case 'combo': return <ComboEditor compact combo={current.draft as Combo} onChange={set} connections={config.connections} />;
      case 'actionSet': return <ActionSetEditor compact actionSet={current.draft as ActionSet} onChange={set} capabilities={view.capabilities} inputNames={inputNames} />;
      case 'pageEnvironment': return <PageEnvironmentEditor compact environment={current.draft as PageEnvironment} onChange={set} presets={view.environmentPresets} />;
      default: return <AtEnvironmentEditor compact environment={current.draft as AtEnvironment} onChange={set} capabilities={view.capabilities} />;
    }
  };
  const inheritedRules = resolveRunRules(config, preset?.runRules), rules = resolveRunRules(config, preset?.runRules, task.runRules);
  const ruleOverrides = Object.keys(task.runRules ?? {}).length;
  const editingDirty = !!editing;
  const runIds = { comboId: combo.id, actionSetId: conditions.actionSet.id, pageEnvironmentId: conditions.pageEnvironment.id, atEnvironmentId: conditions.atEnvironment.id };
  const modeName = t(`sidebar.modes.${mode}`);

  return <form id="task-run-control" aria-labelledby={id + '-title'} className="grid content-start gap-4"
    onSubmit={event => { event.preventDefault(); if (!problem && valid && !busy && !editingDirty) onRun({ mode, repeats: count, conditions: runIds }); }}>
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id + '-title'} className={label}>{t('runBox.title')}</h2>
      <Link to={{ view: 'conditions' }} navigate={navigate} className="text-xs text-trace underline-offset-2 hover:underline">{t('runBox.manage')}</Link>
    </div>

    <div className="grid gap-1">
      <span id={id + '-mode'} className={label}>{t('runBox.mode')}</span>
      <div role="group" aria-labelledby={id + '-mode'} className="inline-flex w-fit overflow-hidden rounded-md border border-edge-strong text-[13px]">
        {(['screenreader', 'keyboard'] as const).map(value => { const can = modes.includes(value);
          return <button key={value} type="button" aria-pressed={mode === value} disabled={!can && modes.length > 0} title={can ? undefined : t('runBox.modeUnsupported', { mode: t(`sidebar.modes.${value}`) })}
            onClick={() => setMode(value)} className={cn('h-8 border-r border-edge-strong px-3 last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50', mode === value ? 'bg-trace-soft font-medium text-trace' : 'bg-surface text-muted-foreground hover:bg-raised')}>
            {t(`sidebar.modes.${value}`)}
          </button>; })}
      </div>
    </div>

    <div className="grid gap-1.5">
      <Label htmlFor={id + '-preset'} className={label}>{t('runConditions.preset')}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={preset?.id ?? NO_PRESET} onValueChange={choosePreset} disabled={busy}>
          <SelectTrigger id={id + '-preset'} className="h-9 min-w-0 flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {config.presets.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            <SelectItem value={NO_PRESET}>{t('runBox.noPreset')}</SelectItem>
          </SelectContent>
        </Select>
        {presetName === undefined && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setPresetName('')}>{t('runBox.saveAsPreset')}</Button>}
      </div>
      {presetName !== undefined && <div className="flex flex-wrap items-end gap-2">
        <div className="grid flex-1 gap-1"><Label htmlFor={id + '-preset-name'} className="text-xs">{t('runBox.presetName')}</Label>
          <Input id={id + '-preset-name'} className="h-8" value={presetName} onChange={event => setPresetName(event.target.value)} /></div>
        <Button type="button" size="sm" disabled={busy || !presetName.trim()} onClick={savePreset}>{t('runBox.presetSave')}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setPresetName(undefined)}>{t('runBox.cancel')}</Button>
      </div>}
      <p className="text-xs leading-5 text-muted-foreground">{preset ? t('runBox.presetHint') : t('runBox.noPresetHint')}</p>
    </div>

    <section aria-labelledby={id + '-conditions'} className="grid gap-0">
      <h3 id={id + '-conditions'} className={cn(label, 'pb-1')}>{t('runConditions.condition')}</h3>
      <p className="pb-2 text-xs leading-5 text-muted-foreground">{t('runBox.conditionsHint')}</p>
      {CONDITION_KINDS.map(kind => {
        const source = conditionSource(config, task, kind), open = editing?.kind === kind ? editing as Extract<Editing, { kind: ConditionKind }> : undefined;
        const items = selectable(config[LIST[kind]] as readonly Owned[], taskId), original = source.item.copiedFrom ? (config[LIST[kind]] as readonly Owned[]).find(item => item.id === source.item.copiedFrom) : undefined;
        return <div key={kind} className="grid gap-1.5 border-t border-edge py-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <div className="grid min-w-0 gap-0.5">
              <span className="text-xs text-muted-foreground">{t(`runConditions.${kind}`)}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium"><span className="break-words">{source.item.name}</span><SourceChip source={source} /></span>
              <span className="text-xs leading-5 text-muted-foreground">{summary(kind, source.item)}{original && <> · {t('runBox.copiedFrom', { name: original.name })}</>}</span>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              <Select value={source.item.id} onValueChange={value => load(kind, value)} disabled={busy || !!editing}>
                <SelectTrigger size="sm" aria-label={t('runBox.loadAria', { kind: t(`runConditions.${kind}`) })} className="h-7 w-auto gap-1 px-2 text-xs"><span>{t('runBox.load')}</span></SelectTrigger>
                <SelectContent>{items.map(item => <SelectItem key={item.id} value={item.id}>{item.owner ? t('taskConditions.ownItem', { name: item.name }) : item.name}</SelectItem>)}</SelectContent>
              </Select>
              {kind !== 'atEnvironment' && !open && <Button type="button" variant="outline" size="xs" disabled={busy || !!editing} onClick={() => startEdit(kind, source)}>{t('runBox.edit')}</Button>}
              {kind !== 'atEnvironment' && !open && <Button type="button" variant="ghost" size="xs" disabled={busy || !!editing} onClick={() => startNew(kind)}>{t('runBox.new')}</Button>}
            </div>
          </div>
          {source.own && !open && <div className="flex flex-wrap gap-2">
            <Button type="button" variant="link" size="xs" className="h-auto p-0" disabled={busy} onClick={() => shareItem(kind, source.item)}>{t('runBox.saveShared')}</Button>
            {original && <Button type="button" variant="link" size="xs" className="h-auto p-0" disabled={busy} onClick={() => revert(kind, source.item)}>{t('runBox.revert', { name: original.name })}</Button>}
          </div>}
          {open && <div className="grid gap-3 rounded-md border border-edge-strong bg-surface p-3">
            <p className="text-xs leading-5 text-muted-foreground">{open.mode === 'copy' ? t('runBox.editCopyNote', { name: source.item.name }) : open.mode === 'new' ? t('runBox.editNewNote') : t('runBox.editOwnNote')}</p>
            <div className="grid gap-1"><Label htmlFor={id + '-' + kind + '-name'} className="text-xs">{t('runBox.itemName')}</Label>
              <Input id={id + '-' + kind + '-name'} className="h-8" value={open.draft.name} onChange={event => setEditing({ ...open, draft: { ...open.draft, name: event.target.value } })} /></div>
            {editor(open)}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy || !open.draft.name.trim()} onClick={saveEdit}>{open.mode === 'own' ? t('runBox.save') : t('runBox.saveTaskOnly')}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(undefined)}>{t('runBox.cancel')}</Button>
            </div>
          </div>}
        </div>;
      })}
      <div className="grid gap-1.5 border-t border-edge py-2.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <div className="grid min-w-0 gap-0.5">
            <span className="text-xs text-muted-foreground">{t('runConditions.runRules')}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
              {ruleOverrides ? t('runBox.rulesOwn', { count: ruleOverrides }) : preset?.runRules && Object.keys(preset.runRules).length ? t('runBox.rulesPreset', { name: preset.name }) : t('runBox.rulesProject')}
              <span className={cn(chip, ruleOverrides ? 'border-trace text-trace' : 'border-edge-strong text-muted-foreground')}>{ruleOverrides ? t('runBox.chipOwn') : preset?.runRules && Object.keys(preset.runRules).length ? t('runBox.chipPreset') : t('runBox.chipShared')}</span>
            </span>
            <span className="text-xs leading-5 text-muted-foreground">{runRulesSummary(rules)}</span>
          </div>
          {editing?.kind !== 'runRules' && <Button type="button" variant="outline" size="xs" disabled={busy || !!editing} onClick={() => { setNotice(undefined); setEditing({ kind: 'runRules', draft: structuredClone(task.runRules ?? {}) }); }}>{t('runBox.rulesEdit')}</Button>}
        </div>
        {editing?.kind === 'runRules' && <div className="grid gap-3 rounded-md border border-edge-strong bg-surface p-3">
          <RunRulesEditor compact value={editing.draft} onChange={draft => setEditing({ kind: 'runRules', draft })} inherited={inheritedRules}
            inheritedLabel={preset ? t('taskSettings.fromPreset', { name: preset.name }) : t('taskSettings.fromProject')} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy || !runRulesValid(editing.draft)} onClick={saveEdit}>{t('runBox.save')}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(undefined)}>{t('runBox.cancel')}</Button>
          </div>
        </div>}
      </div>
    </section>
    {notice && <p role="status" className="border-l-2 border-trace pl-3 text-xs leading-5">{notice}</p>}

    <RunModels config={config} combo={combo} mode={mode} />

    <div className="grid grid-cols-[4.5rem_auto] items-end justify-start gap-2">
      <div className="grid gap-1">
        <Label htmlFor={id + '-repeats'} className={label}>{t('runBox.repeats')}</Label>
        <Input id={id + '-repeats'} type="number" min={1} max={MAX_REPEATS} className="h-9" value={repeats} aria-describedby={id + '-repeats-hint'} aria-invalid={!valid} onChange={event => setRepeats(event.target.value)} />
      </div>
      <Button type="submit" className="h-9 px-4" disabled={busy || !!problem || !valid || editingDirty}><Play aria-hidden="true" />{t('runBox.runMode', { mode: modeName })}</Button>
    </div>
    <p id={id + '-repeats-hint'} className="text-xs leading-5 text-muted-foreground">{t('runBox.repeatsHint', { max: MAX_REPEATS })}</p>
    {editingDirty && <p role="status" className="text-xs leading-5 text-muted-foreground">{t('runBox.editingBlocks')}</p>}
    {problem && <p role="status" className="text-xs leading-5 text-inspect">
      {problem} <Link to={{ view: problem === t('runBox.problem.noKey') || problem === t('runBox.problem.noPlannerKey') ? 'connections' : 'conditions' }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.fix')}</Link>
    </p>}
    {newest && <p role="status" className="text-xs leading-5 text-muted-foreground">
      {t('runBox.active', { count: active.length })} <Link to={{ task: newest.run.taskId, run: newest.run.id }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.openActive')}</Link>
    </p>}
    <Button type="button" variant="link" className="h-auto justify-self-start p-0 text-[13px]" onClick={onCompare}>{t('task.compare')}</Button>
  </form>;
}

/** Shared, task-only or from the preset: words in a bordered mark, never colour alone. */
function SourceChip({ source }: { source: ConditionSource }) {
  const { t } = useTranslation();
  const text = source.own ? t('runBox.chipOwn') : source.from === 'preset' ? t('runBox.chipPreset') : t('runBox.chipShared');
  return <span className={cn(chip, source.own ? 'border-trace text-trace' : 'border-edge-strong text-muted-foreground')}>{text}</span>;
}

/**
 * "이 실행에 쓰는 모델" by role. The planner and the executor are experiment conditions; the commentary model explains the run
 * afterwards and never changes its result. A planned combo in keyboard mode says its planner is not used.
 */
function RunModels({ config, combo, mode }: { config: ProjectConfig; combo: Combo; mode: Mode }) {
  const { t } = useTranslation();
  const planner = combo.structure === 'planned' ? choiceName(combo.planner, config.connections) : undefined;
  const executor = choiceName(combo.executors[mode], config.connections);
  const analysis = choiceName(combo.analysis, config.connections), projectAnalysis = choiceName(config.project.analysis.model, config.connections);
  const rows: { role: string; model: string; note?: string; tag: 'condition' | 'none' }[] = [
    { role: t('runConditions.roles.planner'), tag: 'condition',
      model: combo.structure !== 'planned' ? t('runBox.plannerSolo') : mode === 'keyboard' ? t('runBox.plannerKeyboard') : planner ?? t('runBox.noModel') },
    { role: t('runConditions.roles.executor'), tag: 'condition', model: executor ?? t('runBox.noModel') },
    { role: t('runConditions.roles.analysis'), tag: 'none', model: analysis ?? projectAnalysis ?? t('runBox.analysisNone'), ...(!analysis && projectAnalysis ? { note: t('runBox.projectDefault') } : {}) },
  ];
  return <section aria-labelledby="run-models" className="grid gap-1.5 rounded-md border border-edge p-3">
    <h3 id="run-models" className={label}>{t('runBox.modelsTitle')}</h3>
    <dl className="grid gap-1 text-[13px]">{rows.map(row => <div key={row.role} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-2">
      <dt className="text-muted-foreground">{row.role}</dt>
      <dd className="min-w-0 font-mono break-words">{row.model}{row.note && <span className="ml-1.5 font-sans text-xs text-muted-foreground">{row.note}</span>}</dd>
      <dd className={cn(chip, row.tag === 'condition' ? 'border-model text-model' : 'border-edge-strong text-muted-foreground')}>{row.tag === 'condition' ? t('runConditions.condition') : t('runConditions.noEffect')}</dd>
    </div>)}</dl>
  </section>;
}
