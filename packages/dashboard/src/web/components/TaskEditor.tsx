import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Copy, Save } from 'lucide-react';
import type { ManagedTask, Mode } from '../../shared/config';
import type { PageProps } from '../pages/types';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Field } from './forms';
import { TaskFields } from './TaskFields';
import { PermissionsEditor } from './PermissionsEditor';

export type TaskEditorProps = PageProps & {
  managed: ManagedTask;
  initial?: unknown;
  onSaved: (taskId: string) => void;
  onDuplicate: (task: ManagedTask, json: unknown) => void;
};

const blankTask = (goal: string) => ({
  mode: 'keyboard', url: 'https://example.com', goal,
  maxSteps: RAWSTEP_DEFAULTS.task.maxSteps, timeoutMs: RAWSTEP_DEFAULTS.task.timeoutMs,
  verify: { all: [{ titleIncludes: 'Example Domain' }] },
});

function inputNamesOf(json: string): string[] {
  try { return Object.keys(JSON.parse(json).input ?? {}); } catch { return []; }
}

/** Task info, per-mode permissions (json-render preview) and prompt variants, moved from the former Tasks page. */
export function TaskEditor({ managed, initial, onSaved, onDuplicate, ...props }: TaskEditorProps) {
  const { t } = useTranslation();
  const [task, setTask] = useState(() => structuredClone(managed));
  const [revision, setRevision] = useState(props.view.revision);
  const [json, setJson] = useState(JSON.stringify(initial ?? blankTask(t('taskEditor.blankGoal')), null, 2));
  const [mode, setMode] = useState<Mode>('keyboard');
  const modeValue = task.modes[mode];
  const inputs = inputNamesOf(json);
  const updateMode = (value: Partial<typeof modeValue>) => setTask({ ...task, modes: { ...task.modes, [mode]: { ...modeValue, ...value } } });
  const updatePrompt = (id: string, part: Partial<(typeof modeValue.prompts)[number]>) => updateMode({ prompts: modeValue.prompts.map(p => p.id === id ? { ...p, ...part } : p) });
  const duplicate = () => {
    const id = crypto.randomUUID();
    onDuplicate({ ...structuredClone(task), id, name: t('taskEditor.copyName', { name: task.name }), file: 'tasks/' + id + '.json' }, JSON.parse(json));
  };
  const save = async () => {
    const parsed: unknown = JSON.parse(json);
    const saved = await props.save(
      { ...props.view.config, tasks: [...props.view.config.tasks.filter(x => x.id !== task.id), task] },
      { file: task.file, task: parsed }, revision,
    );
    setRevision(saved.revision); onSaved(task.id);
  };
  return <div className="grid gap-6">
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('taskEditor.infoTitle')}</CardTitle>
        <Button variant="outline" onClick={() => void props.act(async () => duplicate())}><Copy aria-hidden="true" />{t('taskEditor.duplicate')}</Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label={t('taskEditor.nameLabel')} value={task.name} onChange={name => setTask({ ...task, name })} />
        <Field label={t('taskEditor.fileLabel')} value={task.file} onChange={file => setTask({ ...task, file })} />
        <TaskFields json={json} onChange={setJson} />
        <details>
          <summary className="cursor-pointer text-sm font-medium">{t('taskEditor.advancedSummary')}</summary>
          <div className="mt-4">
            <Field label="Task JSON" multiline value={json} onChange={setJson} hint={t('taskEditor.jsonHint')} />
          </div>
        </details>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>{t('taskEditor.modeSettingsTitle')}</CardTitle></CardHeader>
      <CardContent>
        <Tabs value={mode} onValueChange={v => setMode(v as Mode)}>
          <TabsList><TabsTrigger value="keyboard">{t('taskEditor.keyboard')}</TabsTrigger><TabsTrigger value="screenreader">{t('taskEditor.screenreader')}</TabsTrigger></TabsList>
          {(['keyboard', 'screenreader'] as const).map(m => <TabsContent key={m} value={m} className="mt-6">
            <div className="grid gap-6 2xl:grid-cols-2">
              <div className="grid content-start gap-5">
                <h3 className="font-medium">{t('taskEditor.permissionsTitle')}</h3>
                <div className="flex items-center gap-3">
                  <Switch id={task.id + m} checked={modeValue.permissions !== null} onCheckedChange={v => updateMode({ permissions: v ? structuredClone(props.view.config.globals[mode]) : null })} />
                  <Label htmlFor={task.id + m}>{t('taskEditor.customizePerTask')}</Label>
                </div>
                <p className="text-xs text-muted-foreground">{modeValue.permissions ? t('taskEditor.customOverrides') : t('taskEditor.useGlobal')}</p>
                {modeValue.permissions && <PermissionsEditor key={m} value={modeValue.permissions} onChange={permissions => updateMode({ permissions })} capabilities={props.view.capabilities[mode]} inputNames={inputs} />}
              </div>
              <div className="grid content-start gap-5">
                <h3 className="font-medium">{t('taskEditor.promptVariants')}</h3>
                <p className="text-xs leading-5 text-muted-foreground">{t('taskEditor.promptHint')}</p>
                {modeValue.prompts.map((p, i) => <div key={p.id} className="grid gap-3 border-t pt-4">
                  <Field label={t('taskEditor.variantName', { n: i + 1 })} value={p.name} onChange={name => updatePrompt(p.id, { name })} />
                  <Field label={t('taskEditor.version', { n: i + 1 })} value={p.version} onChange={version => updatePrompt(p.id, { version })} />
                  <Field label={t('taskEditor.instructions', { n: i + 1 })} multiline value={p.instructions} onChange={instructions => updatePrompt(p.id, { instructions })} />
                </div>)}
                <Button variant="outline" onClick={() => updateMode({ prompts: [...modeValue.prompts, { ...modeValue.prompts[0]!, id: crypto.randomUUID(), name: t('taskEditor.newVariant'), version: '1' }] })}><Plus aria-hidden="true" />{t('taskEditor.addVariant')}</Button>
              </div>
            </div>
          </TabsContent>)}
        </Tabs>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>{t('taskEditor.analysisTitle')}</CardTitle></CardHeader>
      <CardContent>
        <Field label={t('taskEditor.analysisLabel')} multiline value={task.analysisInstructions ?? ''} hint={t('taskEditor.analysisHint')}
          onChange={analysisInstructions => {
            const copy = { ...task };
            if (analysisInstructions.trim()) copy.analysisInstructions = analysisInstructions; else delete copy.analysisInstructions;
            setTask(copy);
          }} />
      </CardContent>
    </Card>
    <Button className="justify-self-end" disabled={props.busy} onClick={() => void props.act(save)}><Save aria-hidden="true" />{t('taskEditor.save')}</Button>
  </div>;
}
