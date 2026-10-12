import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { resolveRunRules, taskConditions, type ManagedTask } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { comboSummary } from '../lib/conditions';
import { CONDITION_KINDS, FIELD, type TaskConditionIds } from '../lib/taskConditions';
import { taskInputOptions, taskInputs } from '../lib/taskInputs';
import { asObject, parseTaskJson, updateTaskJson, type Json } from '../lib/taskJson';
import { Choice, Field, Panel } from './forms';
import { RunRulesEditor } from './conditions/RunRulesEditor';
import { TaskConditionFields } from './TaskConditionFields';
import { ErrorState } from './layout/ErrorState';
import { ReachCheck } from './ReachCheck';
import { TaskInputsField } from './TaskInputsField';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Switch } from './ui/switch';

type Props = {
  task: ManagedTask; onTask: (task: ManagedTask) => void;
  /** The Task JSON text: start URL, goal, limits, inputs and the rest of the file. */
  json: string; onJson: (json: string) => void;
  view: ConfigView;
  /** Opens the 작업 수정 sheet, where the name, address and goal are edited. */
  onEdit: () => void;
};

/**
 * The "세부 설정" tab: what a run does beyond the basics, in closed sections. The name, address and goal are shown here as they are
 * but edited only in the 작업 수정 sheet. The default conditions (preset, model combo, action set, environments) can be picked here
 * too; the conditions themselves are edited in the run box or under 실험 조건. A task can override any run rule and replace the
 * project's analysis instructions.
 */
export function TaskSettings({ task, onTask, json, onJson, view, onEdit }: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const parsed = parseTaskJson(json);
  const { config } = view, conditions = taskConditions(config, task);
  const preset = conditions.preset, inherited = resolveRunRules(config, preset?.runRules);
  const update = (part: Json) => onJson(updateTaskJson(json, part));
  const ids: TaskConditionIds = Object.fromEntries((['presetId', ...CONDITION_KINDS.map(kind => FIELD[kind])] as const).flatMap(key => task[key] ? [[key, task[key]]] : []));
  const setConditions = (next: TaskConditionIds) => {
    const rest = { ...task };
    for (const key of ['presetId', ...CONDITION_KINDS.map(kind => FIELD[kind])] as const) delete rest[key];
    onTask({ ...rest, ...next });
  };
  if (!parsed) return <div className="grid gap-4">
    <ErrorState alert view={{ kind: 'data', what: t('taskSettings.invalidJson'), progress: t('taskSettings.invalidJsonProgress'), next: t('taskSettings.invalidJsonNext') }} />
    <Field label={t('taskSettings.jsonTitle')} multiline value={json} onChange={onJson} />
  </div>;
  const navigation = asObject(parsed.navigation);
  const overrides = Object.keys(task.runRules ?? {}).length;
  return <div className="grid max-w-3xl gap-1">
    <section aria-labelledby="task-basics" className="grid gap-3 pb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="task-basics" className="text-base font-semibold">{t('taskSettings.basicsTitle')}</h2>
        <Button variant="outline" size="sm" onClick={onEdit}>{t('taskPage.edit')}</Button>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{t('taskSettings.name')}</dt><dd className="break-words">{task.name}</dd>
        <dt className="text-muted-foreground">{t('taskSettings.url')}</dt><dd className="font-mono text-[13px] break-all">{String(parsed.url ?? '')}</dd>
        <dt className="text-muted-foreground">{t('taskSettings.goal')}</dt><dd className="leading-6">{String(parsed.goal ?? '')}</dd>
        <dt className="text-muted-foreground">{t('runConditions.combo')}</dt><dd className="break-words">{conditions.combo.name} <span className="text-muted-foreground">· {comboSummary(conditions.combo, config.connections)}</span></dd>
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">{t('taskSettings.basicsHint')}</p>
      <TaskConditionFields config={config} taskId={task.id} value={ids} onChange={setConditions} />
    </section>

    <Panel title={t('taskSettings.overrideTitle')} description={t('taskSettings.overrideSummary')}>
      <div className="grid gap-3">
        <h4 className="text-sm font-semibold">{t('runConditions.runRules')}</h4>
        <p className="text-xs leading-5 text-muted-foreground">{overrides ? t('taskSettings.runRulesCustom', { count: overrides }) : t('taskSettings.runRulesInherited')}</p>
        <RunRulesEditor value={task.runRules ?? {}} inherited={inherited} inheritedLabel={preset ? t('taskSettings.fromPreset', { name: preset.name }) : t('taskSettings.fromProject')}
          onChange={runRules => { const copy = { ...task }; if (Object.keys(runRules).length) copy.runRules = runRules; else delete copy.runRules; onTask(copy); }} />
      </div>
      <div className="grid gap-3 border-t pt-4">
        <h4 className="text-sm font-semibold">{t('taskSettings.limitsTitle')}</h4>
        <p className="text-xs leading-5 text-muted-foreground">{t('taskSettings.limitsHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('taskSettings.maxSteps')} type="number" value={String(parsed.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps)} onChange={value => update({ maxSteps: Number(value) })} />
          <Field label={t('taskSettings.timeoutMs')} type="number" value={String(parsed.timeoutMs ?? RAWSTEP_DEFAULTS.task.timeoutMs)} onChange={value => update({ timeoutMs: Number(value) })} />
        </div>
        <ReachCheck taskId={task.id} maxSteps={Number(parsed.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps)} onMaxSteps={maxSteps => update({ maxSteps })} />
      </div>
      <div className="grid gap-3 border-t pt-4">
        <h4 className="text-sm font-semibold">{t('taskSettings.navigationTitle')}</h4>
        <Choice label={t('taskSettings.navScope')} value={String(navigation.strategy ?? 'same-origin')}
          options={[{ id: 'same-origin', name: t('taskSettings.navSameOrigin') }, { id: 'start-url-prefix', name: t('taskSettings.navStartUrlPrefix') }, { id: 'allow-url-list', name: t('taskSettings.navAllowUrlList') }]}
          onChange={strategy => { const next: Json = { ...navigation, strategy }; if (strategy === 'allow-url-list') Object.assign(next, { allowUrlList: [] }); else delete next.allowUrlList; update({ navigation: next }); }} />
        {navigation.strategy === 'allow-url-list' && <Field label={t('taskSettings.allowUrls')} multiline value={Array.isArray(navigation.allowUrlList) ? navigation.allowUrlList.join('\n') : ''} onChange={value => update({ navigation: { ...navigation, allowUrlList: value.split('\n').filter(Boolean) } })} />}
        <div className="flex items-center gap-3"><Switch id={uid} checked={navigation.readOnly === true} onCheckedChange={readOnly => update({ navigation: { ...navigation, readOnly } })} /><Label htmlFor={uid}>{t('taskSettings.readOnly')}</Label></div>
      </div>
    </Panel>

    <Panel title={t('taskSettings.inputsTitle')} description={t('taskSettings.inputsSummary')}>
      <TaskInputsField input={taskInputs(parsed)} options={taskInputOptions(parsed)} goal={String(parsed.goal ?? '')} onChange={update} />
    </Panel>

    <Panel title={t('taskSettings.fileTitle')} description={task.file}>
      <p className="text-sm leading-6">{t('taskSettings.fileHint', { file: task.file })}</p>
      <p className="text-sm leading-6">{t('taskSettings.cliHint')} <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">rawstep run {task.id}</code></p>
    </Panel>

    <Panel title={t('taskSettings.analysisTitle')}>
      <Field label={t('taskSettings.analysisLabel')} multiline plain value={task.analysisInstructions ?? ''} hint={t('taskSettings.analysisHint')}
        onChange={analysisInstructions => { const copy = { ...task }; if (analysisInstructions.trim()) copy.analysisInstructions = analysisInstructions; else delete copy.analysisInstructions; onTask(copy); }} />
    </Panel>

    <Panel title={t('taskSettings.jsonTitle')} description={t('taskSettings.jsonSummary')}>
      <Field label={t('taskSettings.jsonTitle')} multiline value={json} onChange={onJson} hint={t('taskSettings.jsonHint')} />
    </Panel>
  </div>;
}
