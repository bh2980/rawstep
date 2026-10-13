import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskInputOptions } from '@rawstep/core/contracts';
import { describeApiError, type ErrorView } from '../lib/errors';
import { inputProblems } from '../lib/taskInputs';
import { ErrorState } from './layout/ErrorState';
import { Field } from './forms';
import { TaskInputsField } from './TaskInputsField';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './ui/sheet';

/** What a person names when editing a task: what it is called, where it starts, what it asks, and what it types. */
export type TaskBasics = { name: string; url: string; goal: string; input: Record<string, string>; inputOptions: Record<string, TaskInputOptions> | undefined };

/** How a save ended. A conflict means the project changed elsewhere since the sheet opened; the person's edits are still here. */
export type BasicsSave = { ok: true } | { ok: false; conflict: boolean; error: unknown };

type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  initial: TaskBasics;
  /** The 세부 설정 tab has changes that are not saved; saving here saves them too. */
  otherChanges: boolean; busy: boolean;
  /** Saves; `rebase` puts these edits on top of the project as it is now instead of the version the sheet opened on. */
  onSave: (basics: TaskBasics, rebase: boolean) => Promise<BasicsSave>;
};

/**
 * The one place the name, address, goal and typed inputs of a task are edited (its run profile is chosen in the header,
 * its completion check in its own tab). It saves against the revision it opened on; if the project changed since, it says so, keeps
 * the edits and offers to apply them on top of the newer version.
 */
export function TaskEditSheet({ open, onOpenChange, ...rest }: Props) {
  const { t } = useTranslation();
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="data-[side=right]:sm:max-w-xl" aria-describedby="task-edit-description">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="text-lg">{t('taskEdit.title')}</SheetTitle>
        <SheetDescription id="task-edit-description">{t('taskEdit.description')}</SheetDescription>
      </SheetHeader>
      {open && <EditForm {...rest} close={() => onOpenChange(false)} />}
    </SheetContent>
  </Sheet>;
}

function EditForm({ initial, otherChanges, busy, onSave, close }: Omit<Props, 'open' | 'onOpenChange'> & { close: () => void }) {
  const { t } = useTranslation();
  const [basics, setBasics] = useState(initial);
  const [problem, setProblem] = useState<{ view: ErrorView; conflict: boolean }>();
  const patch = (part: Partial<TaskBasics>) => { setBasics({ ...basics, ...part }); setProblem(undefined); };
  const filled = basics.name.trim() !== '' && basics.url.trim() !== '' && basics.goal.trim() !== '';
  const inputsOk = inputProblems(basics.input, basics.inputOptions, basics.goal).size === 0;
  const changed = JSON.stringify(basics) !== JSON.stringify(initial);
  async function save(rebase: boolean) {
    const next = { ...basics, name: basics.name.trim(), url: basics.url.trim(), goal: basics.goal.trim() };
    const result = await onSave(next, rebase);
    if (result.ok) { close(); return; }
    setProblem({ conflict: result.conflict, view: result.conflict ? { ...describeApiError(result.error, 'setup'), what: t('taskEdit.conflictWhat'), progress: t('taskEdit.conflictProgress'), next: t('taskEdit.conflictNext') } : describeApiError(result.error, 'data') });
  }
  return <>
    <form id="task-edit-form" className="grid flex-1 content-start gap-5 overflow-y-auto px-4 pb-2" onSubmit={event => { event.preventDefault(); if (filled && inputsOk && !busy) void save(false); }}>
      <Field label={t('taskSettings.name')} value={basics.name} onChange={name => patch({ name })} />
      <Field label={t('taskSettings.url')} value={basics.url} onChange={url => patch({ url })} hint={t('taskSettings.urlHint')} />
      <Field label={t('taskSettings.goal')} multiline plain value={basics.goal} onChange={goal => patch({ goal })} hint={t('taskSettings.goalHint')} />
      <section aria-labelledby="task-edit-inputs" className="grid gap-2 border-t border-edge-strong pt-4">
        <h3 id="task-edit-inputs" className="text-sm font-semibold">{t('taskInputs.title')}</h3>
        <TaskInputsField input={basics.input} options={basics.inputOptions} goal={basics.goal} onChange={fields => patch({ input: fields.input ?? {}, inputOptions: fields.inputOptions })} />
      </section>
      {problem && <ErrorState alert view={problem.view} actions={problem.conflict ? <>
        <Button type="button" size="sm" disabled={busy || !filled || !inputsOk} onClick={() => void save(true)}>{t('taskEdit.rebase')}</Button>
        <Button type="button" size="sm" variant="outline" onClick={close}>{t('taskEdit.discard')}</Button>
      </> : undefined} />}
    </form>
    <SheetFooter className="border-t sm:flex-row sm:items-center sm:justify-between">
      <p role="status" className="text-xs leading-5 text-muted-foreground">{!filled ? t('taskEdit.required') : !inputsOk ? t('taskEdit.inputInvalid') : otherChanges ? t('taskEdit.alsoSaves') : changed ? t('taskEdit.unsaved') : t('taskEdit.unchanged')}</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={close}>{t('taskEdit.cancel')}</Button>
        <Button type="submit" form="task-edit-form" disabled={busy || !filled || !inputsOk || (!changed && !otherChanges)}>{t('taskEdit.save')}</Button>
      </div>
    </SheetFooter>
  </>;
}
