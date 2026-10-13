import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { ManagedTask } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { taskInputOptions, taskInputs } from '../lib/taskInputs';
import { asObject, parseTaskJson, updateTaskJson, type Json } from '../lib/taskJson';
import { Choice, Field } from './forms';
import { Disclosure } from './layout/Disclosure';
import { ErrorState } from './layout/ErrorState';
import { SectionHead } from './layout/PageHeader';
import { ReachCheck } from './ReachCheck';
import { TaskInputsField } from './TaskInputsField';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent } from './ui/collapsible';
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
 * The "설정" tab: how this task runs beyond its conditions (those are in the header's conditions sheet). The basics as they are, with
 * 작업 수정; then limits, where navigation may go, typed inputs and commentary instructions as open sections; the file and its raw
 * JSON last, folded.
 */
export function TaskSettings({ task, onTask, json, onJson, view: _view, onEdit }: Props) {
  const { t } = useTranslation();
  const uid = useId();
  const [rawOpen, setRawOpen] = useState(false);
  const parsed = parseTaskJson(json);
  const update = (part: Json) => onJson(updateTaskJson(json, part));
  if (!parsed) return <div className="grid gap-4">
    <ErrorState alert view={{ kind: 'data', what: t('taskSettings.invalidJson'), progress: t('taskSettings.invalidJsonProgress'), next: t('taskSettings.invalidJsonNext') }} />
    <Field label={t('taskSettings.jsonTitle')} multiline value={json} onChange={onJson} />
  </div>;
  const navigation = asObject(parsed.navigation);
  return <div className="grid max-w-3xl gap-8">
    <section aria-labelledby="task-basics" className="grid gap-3">
      <SectionHead id="task-basics" title={t('taskSettings.basicsTitle')} aside={<Button variant="outline" size="sm" onClick={onEdit}>{t('taskPage.edit')}</Button>} />
      <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{t('taskSettings.name')}</dt><dd className="break-words">{task.name}</dd>
        <dt className="text-muted-foreground">{t('taskSettings.url')}</dt><dd className="font-mono text-[13px] break-all">{String(parsed.url ?? '')}</dd>
        <dt className="text-muted-foreground">{t('taskSettings.goal')}</dt><dd className="leading-6">{String(parsed.goal ?? '')}</dd>
      </dl>
    </section>

    <section aria-labelledby="task-limits" className="grid gap-4">
      <SectionHead id="task-limits" title={t('taskSettings.limitsTitle')} info={t('taskSettings.limitsHint')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('taskSettings.maxSteps')} type="number" value={String(parsed.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps)} onChange={value => update({ maxSteps: Number(value) })} />
        <Field label={t('taskSettings.timeoutMs')} type="number" value={String(parsed.timeoutMs ?? RAWSTEP_DEFAULTS.task.timeoutMs)} onChange={value => update({ timeoutMs: Number(value) })} />
      </div>
      <ReachCheck taskId={task.id} maxSteps={Number(parsed.maxSteps ?? RAWSTEP_DEFAULTS.task.maxSteps)} onMaxSteps={maxSteps => update({ maxSteps })} />
    </section>

    <section aria-labelledby="task-navigation" className="grid gap-4">
      <SectionHead id="task-navigation" title={t('taskSettings.navigationTitle')} />
      <Choice label={t('taskSettings.navScope')} value={String(navigation.strategy ?? 'same-origin')}
        options={[{ id: 'same-origin', name: t('taskSettings.navSameOrigin') }, { id: 'start-url-prefix', name: t('taskSettings.navStartUrlPrefix') }, { id: 'allow-url-list', name: t('taskSettings.navAllowUrlList') }]}
        onChange={strategy => { const next: Json = { ...navigation, strategy }; if (strategy === 'allow-url-list') Object.assign(next, { allowUrlList: [] }); else delete next.allowUrlList; update({ navigation: next }); }} />
      {navigation.strategy === 'allow-url-list' && <Field label={t('taskSettings.allowUrls')} multiline value={Array.isArray(navigation.allowUrlList) ? navigation.allowUrlList.join('\n') : ''} onChange={value => update({ navigation: { ...navigation, allowUrlList: value.split('\n').filter(Boolean) } })} />}
      <div className="flex items-center gap-3"><Switch id={uid} checked={navigation.readOnly === true} onCheckedChange={readOnly => update({ navigation: { ...navigation, readOnly } })} /><Label htmlFor={uid}>{t('taskSettings.readOnly')}</Label></div>
    </section>

    <section aria-labelledby="task-inputs" className="grid gap-4">
      <SectionHead id="task-inputs" title={t('taskSettings.inputsTitle')} info={t('taskSettings.inputsSummary')} />
      <TaskInputsField input={taskInputs(parsed)} options={taskInputOptions(parsed)} goal={String(parsed.goal ?? '')} onChange={update} />
    </section>

    <section aria-labelledby="task-analysis" className="grid gap-4">
      <SectionHead id="task-analysis" title={t('taskSettings.analysisTitle')} info={t('taskSettings.analysisHint')} />
      <Field label={t('taskSettings.analysisLabel')} multiline plain value={task.analysisInstructions ?? ''}
        onChange={analysisInstructions => { const copy = { ...task }; if (analysisInstructions.trim()) copy.analysisInstructions = analysisInstructions; else delete copy.analysisInstructions; onTask(copy); }} />
    </section>

    <Collapsible open={rawOpen} onOpenChange={setRawOpen} className="grid gap-3 border-t border-edge-strong pt-3">
      <Disclosure label={t('taskSettings.fileTitle')} />
      <CollapsibleContent className="grid gap-4">
        <p className="text-sm leading-6">{t('taskSettings.fileHint', { file: task.file })} {t('taskSettings.cliHint')} <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">rawstep run {task.id}</code></p>
        <Field label={t('taskSettings.jsonTitle')} multiline value={json} onChange={onJson} info={t('taskSettings.jsonHint')} />
      </CollapsibleContent>
    </Collapsible>
  </div>;
}
