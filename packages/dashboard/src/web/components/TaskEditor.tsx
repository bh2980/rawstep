import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, Copy, Save } from 'lucide-react';
import { taskProfile, type ManagedTask, type Mode } from '@rawstep/project/config';
import { hostnameOf, slugify, uniqueTaskFile } from '../lib/taskFiles';
import type { PageProps } from '../pages/types';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Choice, Field, Section, Toggle } from './forms';
import { PolicyFields } from './PolicyFields';
import { policyInheritedSummary } from '../lib/profileSummary';
import { TaskAdvancedFields, TaskBasicFields } from './TaskFields';
import { PermissionsEditor } from './PermissionsEditor';

export type TaskEditorProps = PageProps & {
  managed: ManagedTask;
  initial?: unknown;
  onSaved: (taskId: string) => void;
  onDuplicate: (task: ManagedTask, json: unknown) => void;
};

/** Keyboard / screen reader tabs sharing one selected mode; renders `children` for each mode. */
function ModeTabs({ mode, onMode, children }: { mode: Mode; onMode: (mode: Mode) => void; children: (mode: Mode) => ReactNode }) {
  const { t } = useTranslation();
  return <Tabs value={mode} onValueChange={value => onMode(value as Mode)}>
    <TabsList><TabsTrigger value="keyboard">{t('taskEditor.keyboard')}</TabsTrigger><TabsTrigger value="screenreader">{t('taskEditor.screenreader')}</TabsTrigger></TabsList>
    {(['keyboard', 'screenreader'] as const).map(m => <TabsContent key={m} value={m} className="mt-4">{children(m)}</TabsContent>)}
  </Tabs>;
}

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
  const profile = taskProfile(props.view.config, task);
  const modeValue = task.modes[mode];
  const inputs = inputNamesOf(json);
  const updateMode = (m: Mode, value: Partial<typeof modeValue>) => setTask({ ...task, modes: { ...task.modes, [m]: { ...task.modes[m], ...value } } });
  const updatePrompt = (m: Mode, id: string, part: Partial<(typeof modeValue.prompts)[number]>) => updateMode(m, { prompts: task.modes[m].prompts.map(p => p.id === id ? { ...p, ...part } : p) });
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
        <div className="grid gap-2">
          <Choice label={t('taskEditor.profileLabel')} value={profile.id} onChange={profileId => setTask({ ...task, profileId })} options={props.view.config.profiles.map(p => ({ id: p.id, name: p.name }))} />
          <p className="text-xs leading-5 text-muted-foreground">{t('taskEditor.profileHint')}</p>
        </div>
        <TaskBasicFields json={json} onChange={setJson} advanced={advanced} view={props.view} />
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
            <Section title={t('taskEditor.overrideTitle')} description={t('taskEditor.overrideDescription', { profile: profile.name })}>
              <div className="grid gap-3">
                <h4 className="font-medium">{t('taskEditor.policyTitle')}</h4>
                <Toggle label={t('taskEditor.policyToggle')} checked={task.policy !== undefined} onChange={on => {
                  const copy = { ...task };
                  if (on) copy.policy = { ...profile.policy }; else delete copy.policy;
                  setTask(copy);
                }} hint={task.policy ? t('taskEditor.policyCustom') : t('taskEditor.policyInherited', { profile: profile.name, values: policyInheritedSummary(profile.policy) })} />
                {task.policy && <PolicyFields value={{ ...profile.policy, ...task.policy }} onChange={policy => setTask({ ...task, policy })} />}
              </div>
              <div className="grid gap-3 border-t pt-4">
                <h4 className="font-medium">{t('taskEditor.permissionsTitle')}</h4>
                <ModeTabs mode={mode} onMode={setMode}>{m => {
                  const value = task.modes[m];
                  return <div className="grid gap-5">
                    <Toggle label={t('taskEditor.customizePerTask')} checked={value.permissions !== null}
                      onChange={on => updateMode(m, { permissions: on ? structuredClone(profile.permissions[m]) : null })}
                      hint={value.permissions ? t('taskEditor.customOverrides') : t('taskEditor.useProfile', { profile: profile.name, count: profile.permissions[m].keys.length + profile.permissions[m].intents.length })} />
                    {value.permissions && <PermissionsEditor key={m} value={value.permissions} onChange={permissions => updateMode(m, { permissions })} capabilities={props.view.capabilities[m]} inputNames={inputs} />}
                  </div>;
                }}</ModeTabs>
              </div>
            </Section>
            <Section title={t('taskEditor.promptVariants')} description={t('taskEditor.promptHint')}>
              <ModeTabs mode={mode} onMode={setMode}>{m => {
                const value = task.modes[m];
                return <div className="grid gap-5">
                  {value.prompts.map((p, i) => <div key={p.id} className="grid gap-3 border-t pt-4 first:border-t-0 first:pt-0">
                    <Field label={t('taskEditor.variantName', { n: i + 1 })} value={p.name} onChange={name => updatePrompt(m, p.id, { name })} />
                    <Field label={t('taskEditor.version', { n: i + 1 })} value={p.version} onChange={version => updatePrompt(m, p.id, { version })} />
                    <Field label={t('taskEditor.instructions', { n: i + 1 })} multiline value={p.instructions} onChange={instructions => updatePrompt(m, p.id, { instructions })} />
                  </div>)}
                  <Button variant="outline" className="justify-self-start" onClick={() => updateMode(m, { prompts: [...value.prompts, { ...value.prompts[0]!, id: crypto.randomUUID(), name: t('taskEditor.newVariant'), version: '1' }] })}><Plus aria-hidden="true" />{t('taskEditor.addVariant')}</Button>
                </div>;
              }}</ModeTabs>
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
