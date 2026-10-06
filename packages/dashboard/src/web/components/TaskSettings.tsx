import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { taskAgent, taskEnvironment, type ManagedTask, type Mode } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { agentModelsLine, policyInheritedSummary } from '../lib/agentSummary';
import { taskInputOptions, taskInputs } from '../lib/taskInputs';
import { asObject, parseTaskJson, updateTaskJson, type Json } from '../lib/taskJson';
import { Choice, Field, Panel, Toggle } from './forms';
import { ErrorState } from './layout/ErrorState';
import { PermissionPresets } from './PermissionPresets';
import { PolicyFields } from './PolicyFields';
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

const MODES = ['keyboard', 'screenreader'] as const satisfies readonly Mode[];

/**
 * The "세부 설정" tab: what a run does beyond the basics, in closed sections. The name, address and goal are shown here as they are
 * but edited only in the 작업 수정 sheet. The default agent and environment can be picked here too. Instructions belong to the
 * agent's executors, so a task has none of its own; it can only narrow or widen actions per mode, change the policy and replace the
 * project's analysis instructions.
 */
export function TaskSettings({ task, onTask, json, onJson, view, onEdit }: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const parsed = parseTaskJson(json);
  const { config } = view, agent = taskAgent(config, task), environment = taskEnvironment(config, task);
  const update = (part: Json) => onJson(updateTaskJson(json, part));
  const setPermissions = (m: Mode, permissions: ManagedTask['permissions'][Mode]) => onTask({ ...task, permissions: { ...task.permissions, [m]: permissions } });
  if (!parsed) return <div className="grid gap-4">
    <ErrorState alert view={{ kind: 'data', what: t('taskSettings.invalidJson'), progress: t('taskSettings.invalidJsonProgress'), next: t('taskSettings.invalidJsonNext') }} />
    <Field label={t('taskSettings.jsonTitle')} multiline value={json} onChange={onJson} />
  </div>;
  const navigation = asObject(parsed.navigation);
  const overridden = MODES.some(m => task.permissions[m] !== null);
  const permissions = { keyboard: task.permissions.keyboard ?? agent.permissions.keyboard, screenreader: task.permissions.screenreader ?? agent.permissions.screenreader };
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
        <dt className="text-muted-foreground">{t('taskSettings.agentModels')}</dt><dd className="break-words">{agentModelsLine(agent, config.connections)}</dd>
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">{t('taskSettings.basicsHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <Choice label={t('taskSettings.agent')} value={agent.id} options={config.agents.map(({ id, name }) => ({ id, name }))} onChange={agentId => onTask({ ...task, agentId })} />
          <p className="text-xs leading-5 text-muted-foreground">{t('taskSettings.agentHint')}</p>
        </div>
        <div className="grid content-start gap-1.5">
          <Choice label={t('taskSettings.environment')} value={environment.id} options={config.environments.map(({ id, name }) => ({ id, name }))} onChange={environmentId => onTask({ ...task, environmentId })} />
          <p className="text-xs leading-5 text-muted-foreground">{t('taskSettings.environmentHint')}</p>
        </div>
      </div>
    </section>

    <Panel title={t('taskSettings.overrideTitle')} description={t('taskSettings.overrideSummary')}>
      <p className="text-xs leading-5 text-muted-foreground">{t('taskSettings.overrideDescription', { agent: agent.name })}</p>
      <div className="grid gap-3">
        <h4 className="text-sm font-semibold">{t('taskSettings.permissionsTitle')}</h4>
        {MODES.map(m => { const mode = t(`sidebar.modes.${m}`), on = task.permissions[m] !== null;
          return <Toggle key={m} label={t('taskSettings.permissionsToggle', { mode })} checked={on}
            hint={on ? t('taskSettings.permissionsCustom', { mode }) : t('taskSettings.permissionsInherited', { agent: agent.name, mode })}
            onChange={next => setPermissions(m, next ? structuredClone(agent.permissions[m]) : null)} />; })}
        {/* Both modes are shown together; changing a mode that still follows the agent starts overriding that mode only. */}
        {overridden && <PermissionPresets value={permissions} capabilities={view.capabilities}
          onChange={next => onTask({ ...task, permissions: {
            keyboard: task.permissions.keyboard !== null || JSON.stringify(next.keyboard) !== JSON.stringify(permissions.keyboard) ? next.keyboard : null,
            screenreader: task.permissions.screenreader !== null || JSON.stringify(next.screenreader) !== JSON.stringify(permissions.screenreader) ? next.screenreader : null,
          } })} />}
      </div>
      <div className="grid gap-3 border-t pt-4">
        <h4 className="text-sm font-semibold">{t('taskSettings.policyTitle')}</h4>
        <Toggle label={t('taskSettings.policyToggle')} checked={task.policy !== undefined}
          hint={task.policy ? t('taskSettings.policyCustom') : t('taskSettings.policyInherited', { agent: agent.name, values: policyInheritedSummary(agent.policy) })}
          onChange={on => { const copy = { ...task }; if (on) copy.policy = { ...agent.policy }; else delete copy.policy; onTask(copy); }} />
        {task.policy && <PolicyFields value={{ ...agent.policy, ...task.policy }} onChange={policy => onTask({ ...task, policy })} />}
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
