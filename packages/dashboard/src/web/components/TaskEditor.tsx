import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, Copy, Save } from 'lucide-react';
import type { ManagedTask, Mode } from '../../shared/config';
import { hostnameOf, slugify, uniqueTaskFile } from '../lib/taskFiles';
import type { PageProps } from '../pages/types';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Field, Section } from './forms';
import { TaskAdvancedFields, TaskBasicFields } from './TaskFields';
import { PermissionsEditor } from './PermissionsEditor';

export type TaskEditorProps = PageProps & {
  managed: ManagedTask;
  initial?: unknown;
  onSaved: (taskId: string) => void;
  onDuplicate: (task: ManagedTask, json: unknown) => void;
};

function inputNamesOf(json: string): string[] {
  try { return Object.keys(JSON.parse(json).input ?? {}); } catch { return []; }
}

/** Basic card (name, URL, goal, completion check, save) plus one collapsed advanced section holding every other setting. */
export function TaskEditor({ managed, initial, onSaved, onDuplicate, ...props }: TaskEditorProps) {
  const { t } = useTranslation();
  const [task, setTask] = useState(() => structuredClone(managed));
  const [revision, setRevision] = useState(props.view.revision);
  const [json, setJson] = useState(JSON.stringify(initial ?? {}, null, 2));
  const [mode, setMode] = useState<Mode>('keyboard');
  const [advanced, setAdvanced] = useState(false);
  const modeValue = task.modes[mode];
  const inputs = inputNamesOf(json);
  const updateMode = (value: Partial<typeof modeValue>) => setTask({ ...task, modes: { ...task.modes, [mode]: { ...modeValue, ...value } } });
  const updatePrompt = (id: string, part: Partial<(typeof modeValue.prompts)[number]>) => updateMode({ prompts: modeValue.prompts.map(p => p.id === id ? { ...p, ...part } : p) });
  const duplicate = () => {
    const copy = t('taskEditor.copyName', { name: task.name });
    const file = uniqueTaskFile(slugify(copy) || slugify(hostnameOf(String((JSON.parse(json) as { url?: unknown }).url ?? ''))), new Set(props.view.config.tasks.map(x => x.file)));
    onDuplicate({ ...structuredClone(task), id: crypto.randomUUID(), name: copy, file }, JSON.parse(json));
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
      <CardHeader><CardTitle>{t('taskEditor.basicTitle')}</CardTitle></CardHeader>
      <CardContent className="grid gap-5">
        <Field label={t('taskEditor.nameLabel')} value={task.name} onChange={name => setTask({ ...task, name })} />
        <TaskBasicFields json={json} onChange={setJson} advanced={advanced} />
      </CardContent>
      <CardFooter className="justify-end">
        <Button disabled={props.busy} onClick={() => void props.act(save)}><Save aria-hidden="true" />{t('taskEditor.save')}</Button>
      </CardFooter>
    </Card>
    <Collapsible open={advanced} onOpenChange={setAdvanced} asChild>
      <Card>
        <CardHeader>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="h-auto w-full justify-between p-0 text-left font-normal hover:bg-transparent">
              <span className="grid gap-1"><CardTitle>{t('taskEditor.advancedTitle')}</CardTitle><CardDescription>{t('taskEditor.advancedDescription')}</CardDescription></span>
              <ChevronDown aria-hidden="true" className={'transition-transform' + (advanced ? ' rotate-180' : '')} />
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="grid gap-6">
            <TaskAdvancedFields json={json} onChange={setJson} />
            <Section title={t('taskEditor.modeSettingsTitle')}>
              <Tabs value={mode} onValueChange={v => setMode(v as Mode)}>
                <TabsList><TabsTrigger value="keyboard">{t('taskEditor.keyboard')}</TabsTrigger><TabsTrigger value="screenreader">{t('taskEditor.screenreader')}</TabsTrigger></TabsList>
                {(['keyboard', 'screenreader'] as const).map(m => <TabsContent key={m} value={m} className="mt-6">
                  <div className="grid gap-6 2xl:grid-cols-2">
                    <div className="grid content-start gap-5">
                      <h4 className="font-medium">{t('taskEditor.permissionsTitle')}</h4>
                      <div className="flex items-center gap-3">
                        <Switch id={task.id + m} checked={modeValue.permissions !== null} onCheckedChange={v => updateMode({ permissions: v ? structuredClone(props.view.config.globals[mode]) : null })} />
                        <Label htmlFor={task.id + m}>{t('taskEditor.customizePerTask')}</Label>
                      </div>
                      <p className="text-xs text-muted-foreground">{modeValue.permissions ? t('taskEditor.customOverrides') : t('taskEditor.useGlobal')}</p>
                      {modeValue.permissions && <PermissionsEditor key={m} value={modeValue.permissions} onChange={permissions => updateMode({ permissions })} capabilities={props.view.capabilities[mode]} inputNames={inputs} />}
                    </div>
                    <div className="grid content-start gap-5">
                      <h4 className="font-medium">{t('taskEditor.promptVariants')}</h4>
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
            </Section>
            <Section title={t('taskEditor.analysisTitle')}>
              <Field label={t('taskEditor.analysisLabel')} multiline value={task.analysisInstructions ?? ''} hint={t('taskEditor.analysisHint')}
                onChange={analysisInstructions => {
                  const copy = { ...task };
                  if (analysisInstructions.trim()) copy.analysisInstructions = analysisInstructions; else delete copy.analysisInstructions;
                  setTask(copy);
                }} />
            </Section>
            <Section title={t('taskEditor.fileTitle')}>
              <p className="text-sm leading-6">{t('taskEditor.fileHint', { file: task.file })}</p>
            </Section>
            <Section title={t('taskEditor.duplicateTitle')} description={t('taskEditor.duplicateHint')}>
              <Button variant="outline" className="justify-self-start" onClick={() => void props.act(async () => duplicate())}><Copy aria-hidden="true" />{t('taskEditor.duplicate')}</Button>
            </Section>
            <Section title={t('taskEditor.jsonTitle')} description={t('taskEditor.jsonHint')}>
              <Field label={t('taskEditor.jsonTitle')} multiline value={json} onChange={setJson} />
            </Section>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  </div>;
}
