import { useId, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { taskProfile, type ManagedTask, type Mode } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { policyInheritedSummary } from '../lib/profileSummary';
import { taskInputOptions, taskInputs } from '../lib/taskInputs';
import { asObject, parseTaskJson, updateTaskJson, type Json } from '../lib/taskJson';
import { Choice, Field, Panel, Toggle } from './forms';
import { ErrorState } from './layout/ErrorState';
import { PermissionPresets } from './PermissionPresets';
import { PolicyFields } from './PolicyFields';
import { TaskInputsField } from './TaskInputsField';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

type Props = {
  task: ManagedTask; onTask: (task: ManagedTask) => void;
  /** The Task JSON text: start URL, goal, limits, inputs and the rest of the file. */
  json: string; onJson: (json: string) => void;
  view: ConfigView;
  /** Opens the 작업 수정 sheet, where the name, address, goal and run profile are edited. */
  onEdit: () => void;
};

/** Keyboard / screen reader tabs sharing one selected mode; renders `children` for each mode. */
function ModeTabs({ mode, onMode, children }: { mode: Mode; onMode: (mode: Mode) => void; children: (mode: Mode) => ReactNode }) {
  const { t } = useTranslation();
  return <Tabs value={mode} onValueChange={value => onMode(value as Mode)}>
    <TabsList><TabsTrigger value="keyboard">{t('sidebar.modes.keyboard')}</TabsTrigger><TabsTrigger value="screenreader">{t('sidebar.modes.screenreader')}</TabsTrigger></TabsList>
    {(['keyboard', 'screenreader'] as const).map(m => <TabsContent key={m} value={m} className="mt-4">{children(m)}</TabsContent>)}
  </Tabs>;
}

/**
 * The "세부 설정" tab: what a run does beyond the basics, in closed sections. The name, address, goal and run profile are shown
 * here as they are but edited only in the 작업 수정 sheet, so there is one editor for them.
 */
export function TaskSettings({ task, onTask, json, onJson, view, onEdit }: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const [mode, setMode] = useState<Mode>('keyboard');
  const parsed = parseTaskJson(json);
  const profile = taskProfile(view.config, task);
  const update = (part: Json) => onJson(updateTaskJson(json, part));
  const updateMode = (m: Mode, value: Partial<ManagedTask['modes'][Mode]>) => onTask({ ...task, modes: { ...task.modes, [m]: { ...task.modes[m], ...value } } });
  const updatePrompt = (m: Mode, id: string, part: Partial<ManagedTask['modes'][Mode]['prompts'][number]>) => updateMode(m, { prompts: task.modes[m].prompts.map(p => p.id === id ? { ...p, ...part } : p) });
  if (!parsed) return <div className="grid gap-4">
    <ErrorState alert view={{ kind: 'data', what: t('taskSettings.invalidJson'), progress: t('taskSettings.invalidJsonProgress'), next: t('taskSettings.invalidJsonNext') }} />
    <Field label={t('taskSettings.jsonTitle')} multiline value={json} onChange={onJson} />
  </div>;
  const navigation = asObject(parsed.navigation);
  const overridden = task.modes.keyboard.permissions !== null || task.modes.screenreader.permissions !== null;
  const permissions = { keyboard: task.modes.keyboard.permissions ?? profile.permissions.keyboard, screenreader: task.modes.screenreader.permissions ?? profile.permissions.screenreader };
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
        <dt className="text-muted-foreground">{t('taskSettings.profile')}</dt><dd>{profile.name}</dd>
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">{t('taskSettings.basicsHint')}</p>
    </section>

    <Panel title={t('taskSettings.overrideTitle')} description={t('taskSettings.overrideSummary')}>
      <p className="text-xs leading-5 text-muted-foreground">{t('taskSettings.overrideDescription', { profile: profile.name })}</p>
      <div className="grid gap-3">
        <h4 className="text-sm font-semibold">{t('taskSettings.permissionsTitle')}</h4>
        <Toggle label={t('taskSettings.permissionsToggle')} checked={overridden}
          hint={overridden ? t('taskSettings.permissionsCustom') : t('taskSettings.permissionsInherited', { profile: profile.name })}
          onChange={on => onTask({ ...task, modes: {
            keyboard: { ...task.modes.keyboard, permissions: on ? structuredClone(profile.permissions.keyboard) : null },
            screenreader: { ...task.modes.screenreader, permissions: on ? structuredClone(profile.permissions.screenreader) : null },
          } })} />
        {overridden && <PermissionPresets value={permissions} capabilities={view.capabilities}
          onChange={next => onTask({ ...task, modes: { keyboard: { ...task.modes.keyboard, permissions: next.keyboard }, screenreader: { ...task.modes.screenreader, permissions: next.screenreader } } })} />}
      </div>
      <div className="grid gap-3 border-t pt-4">
        <h4 className="text-sm font-semibold">{t('taskSettings.policyTitle')}</h4>
        <Toggle label={t('taskSettings.policyToggle')} checked={task.policy !== undefined}
          hint={task.policy ? t('taskSettings.policyCustom') : t('taskSettings.policyInherited', { profile: profile.name, values: policyInheritedSummary(profile.policy) })}
          onChange={on => { const copy = { ...task }; if (on) copy.policy = { ...profile.policy }; else delete copy.policy; onTask(copy); }} />
        {task.policy && <PolicyFields value={{ ...profile.policy, ...task.policy }} onChange={policy => onTask({ ...task, policy })} />}
      </div>
      <div className="grid gap-3 border-t pt-4">
        <h4 className="text-sm font-semibold">{t('taskSettings.limitsTitle')}</h4>
        <p className="text-xs leading-5 text-muted-foreground">{t('taskSettings.limitsHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('taskSettings.maxSteps')} type="number" value={String(parsed.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps)} onChange={value => update({ maxSteps: Number(value) })} />
          <Field label={t('taskSettings.timeoutMs')} type="number" value={String(parsed.timeoutMs ?? RAWSTEP_DEFAULTS.task.timeoutMs)} onChange={value => update({ timeoutMs: Number(value) })} />
        </div>
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

    <Panel title={t('taskSettings.promptTitle')} description={t('taskSettings.promptSummary')}>
      <p className="text-xs leading-5 text-muted-foreground">{t('taskSettings.promptHint')}</p>
      <ModeTabs mode={mode} onMode={setMode}>{m => {
        const value = task.modes[m];
        return <div className="grid gap-5">
          {value.prompts.map((p, i) => <div key={p.id} className="grid gap-3 border-t pt-4 first:border-t-0 first:pt-0">
            <Field label={t('taskSettings.variantName', { n: i + 1 })} value={p.name} onChange={name => updatePrompt(m, p.id, { name })} />
            <Field label={t('taskSettings.version', { n: i + 1 })} value={p.version} onChange={version => updatePrompt(m, p.id, { version })} />
            <Field label={t('taskSettings.instructions', { n: i + 1 })} multiline value={p.instructions} onChange={instructions => updatePrompt(m, p.id, { instructions })} />
          </div>)}
          <Button variant="outline" className="justify-self-start" onClick={() => updateMode(m, { prompts: [...value.prompts, { ...value.prompts[0]!, id: crypto.randomUUID(), name: t('taskSettings.newVariant'), version: '1' }] })}><Plus aria-hidden="true" />{t('taskSettings.addVariant')}</Button>
        </div>;
      }}</ModeTabs>
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
