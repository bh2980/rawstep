import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { createManagedTask, hostnameOf, slugify } from '../lib/taskFiles';
import type { PageProps } from '../pages/types';
import { Choice, Field } from './forms';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

type Props = PageProps & { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (taskId: string) => void };
type VerifyKind = 'textVisible' | 'urlIncludes';

/** Creates a task from the four things a first-time user needs; everything else keeps its default. */
export function NewTaskDialog({ open, onOpenChange, onCreated, ...props }: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(''), [goal, setGoal] = useState(''), [name, setName] = useState('');
  const [kind, setKind] = useState<VerifyKind>('textVisible'), [value, setValue] = useState('');
  const host = hostnameOf(url);
  const ready = url.trim() !== '' && goal.trim() !== '' && value.trim() !== '';
  async function create() {
    const title = name.trim() || host || t('newTask.fallbackName');
    const task = {
      url: url.trim(), goal: goal.trim(), maxSteps: RAWSTEP_DEFAULTS.task.maxSteps, timeoutMs: RAWSTEP_DEFAULTS.task.timeoutMs,
      verify: { all: [{ [kind]: value.trim() }] },
    };
    const id = await createManagedTask(props, { name: title, slug: slugify(name) || slugify(host), task });
    setUrl(''); setGoal(''); setName(''); setKind('textVisible'); setValue('');
    onOpenChange(false); onCreated(id);
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t('newTask.title')}</DialogTitle><DialogDescription>{t('newTask.description')}</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        <Field label={t('newTask.url')} value={url} onChange={setUrl} placeholder="https://" hint={t('taskFields.startUrlHint')} />
        <Field label={t('newTask.goal')} multiline value={goal} onChange={setGoal} hint={t('newTask.goalHint')} />
        <Choice label={t('newTask.verifyKind')} value={kind} onChange={next => setKind(next as VerifyKind)}
          options={[{ id: 'textVisible', name: t('taskFields.ruleKinds.textVisible') }, { id: 'urlIncludes', name: t('taskFields.ruleKinds.urlIncludes') }]} />
        <Field label={t('newTask.verifyValue')} value={value} onChange={setValue} hint={t('newTask.verifyHint')} />
        <Field label={t('newTask.name')} value={name} onChange={setName} placeholder={host || t('newTask.fallbackName')} hint={t('newTask.nameHint')} />
      </div>
      <DialogFooter>
        <Button disabled={props.busy || !ready} onClick={() => void props.act(create)}>{t('newTask.create')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
