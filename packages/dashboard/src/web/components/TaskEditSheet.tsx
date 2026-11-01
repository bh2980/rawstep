import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskInputOptions } from '@rawstep/core/contracts';
import { describeApiError, type ErrorView } from '../lib/errors';
import type { BrowserChoice } from '../lib/taskBrowser';
import { inputProblems } from '../lib/taskInputs';
import { ErrorState } from './layout/ErrorState';
import { BrowserField } from './BrowserField';
import { Choice, Field, MultiChoice } from './forms';
import { NewTabLink } from './Link';
import { ProjectPathField } from './ProjectPathField';
import { TagsField } from './TagsField';
import { TaskInputsField } from './TaskInputsField';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './ui/sheet';

/**
 * What a person names when editing a task: what it is called, where it starts, what it asks, what the user knows before starting, what
 * it types, its tags, which run profiles it usually runs with, which browser it opens, which task it is a broken version of, and the
 * fewest moves it takes.
 */
export type TaskBasics = {
  name: string; url: string; goal: string; context: string; input: Record<string, string>; inputOptions: Record<string, TaskInputOptions> | undefined;
  variantOf: string; minimalSteps: string;
  /** The task's tags, in the order they were added. */
  tags: string[];
  /** The ids of the run profiles the task usually runs with, in the order they were picked; none when the person chooses at run time. */
  profiles: string[];
  /** The browser the task opens (its file's `browser` field). */
  browser: BrowserChoice;
};

/** How a save ended. A conflict means the project changed elsewhere since the sheet opened; the person's edits are still here. */
export type BasicsSave = { ok: true } | { ok: false; conflict: boolean; error: unknown };

type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  initial: TaskBasics;
  /** The 세부 설정 tab has changes that are not saved; saving here saves them too. */
  otherChanges: boolean; busy: boolean;
  /** Saves; `rebase` puts these edits on top of the project as it is now instead of the version the sheet opened on. */
  onSave: (basics: TaskBasics, rebase: boolean) => Promise<BasicsSave>;
  /** Tasks this one can be a broken version of: not itself and not a variant. Empty when this task has variants of its own. */
  bases: { id: string; name: string }[];
  /** The project's run profiles, to pick the ones the task usually runs with. */
  profiles: { id: string; name: string }[];
  /** Whether this computer has the address of a Chrome the person started (`machine.browserEndpoint`). */
  endpointSet: boolean;
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

const NONE = '__none__';

function EditForm({ initial, otherChanges, busy, onSave, bases, profiles, endpointSet, close }: Omit<Props, 'open' | 'onOpenChange'> & { close: () => void }) {
  const { t } = useTranslation();
  const [basics, setBasics] = useState(initial);
  const [problem, setProblem] = useState<{ view: ErrorView; conflict: boolean }>();
  const patch = (part: Partial<TaskBasics>) => { setBasics({ ...basics, ...part }); setProblem(undefined); };
  const filled = basics.name.trim() !== '' && basics.url.trim() !== '' && basics.goal.trim() !== '';
  const minimal = basics.minimalSteps.trim(), minimalOk = minimal === '' || (/^\d+$/.test(minimal) && Number(minimal) >= 1 && Number(minimal) <= 10000);
  const inputsOk = inputProblems(basics.input, basics.inputOptions, basics.goal).size === 0 && minimalOk;
  const changed = JSON.stringify(basics) !== JSON.stringify(initial);
  async function save(rebase: boolean) {
    const next = { ...basics, name: basics.name.trim(), url: basics.url.trim(), goal: basics.goal.trim(), context: basics.context.trim(), minimalSteps: minimal };
    const result = await onSave(next, rebase);
    if (result.ok) { close(); return; }
    setProblem({ conflict: result.conflict, view: result.conflict ? { ...describeApiError(result.error, 'setup'), what: t('taskEdit.conflictWhat'), progress: t('taskEdit.conflictProgress'), next: t('taskEdit.conflictNext') } : describeApiError(result.error, 'data') });
  }
  return <>
    <form id="task-edit-form" className="grid flex-1 content-start gap-5 overflow-y-auto px-4 pb-2" onSubmit={event => { event.preventDefault(); if (filled && inputsOk && !busy) void save(false); }}>
      <Field label={t('taskSettings.name')} value={basics.name} onChange={name => patch({ name })} />
      <TagsField label={t('tags.label')} tags={basics.tags} onChange={tags => patch({ tags })} hint={t('tags.hint')} />
      <ProjectPathField label={t('taskSettings.url')} value={basics.url} onChange={url => patch({ url })} extensions={['.html', '.htm']} allowUrl example="https://example.com/product/1" />
      <Field label={t('taskSettings.goal')} multiline plain value={basics.goal} onChange={goal => patch({ goal })} hint={t('taskSettings.goalHint')} />
      <Field label={t('taskEdit.context')} multiline plain value={basics.context} onChange={context => patch({ context })} hint={t('taskEdit.contextHint')} placeholder={t('taskEdit.contextPlaceholder')} />
      <div className="grid gap-2 border-t border-edge-strong pt-4">
        <MultiChoice label={t('taskEdit.usersTitle')} items={profiles} selected={basics.profiles} onChange={list => patch({ profiles: list })} />
        <p className="text-xs leading-5 text-muted-foreground">{t('taskEdit.usersHint')}</p>
        <NewTabLink to={{ view: 'profiles' }} className="justify-self-start text-[13px] text-trace underline underline-offset-4">{t('taskEdit.newProfile')}</NewTabLink>
      </div>
      <div className="border-t border-edge-strong pt-4">
        <BrowserField value={basics.browser} onChange={browser => patch({ browser })} endpointSet={endpointSet} />
      </div>
      <section aria-labelledby="task-edit-compare" className="grid gap-4 border-t border-edge-strong pt-4">
        <h3 id="task-edit-compare" className="text-sm font-semibold">{t('taskEdit.compareTitle')}</h3>
        {bases.length > 0 || basics.variantOf
          ? <Choice label={t('taskEdit.variantOf')} info={t('taskEdit.variantOfHint')} value={basics.variantOf || NONE} onChange={value => patch({ variantOf: value === NONE ? '' : value })}
            options={[{ id: NONE, name: t('taskEdit.notVariant') }, ...bases]} />
          : <p className="text-[13px] leading-5 text-muted-foreground">{t('taskEdit.hasVariants')}</p>}
        <Field label={t('taskEdit.minimalSteps')} type="number" value={basics.minimalSteps} onChange={minimalSteps => patch({ minimalSteps })} hint={minimalOk ? t('taskEdit.minimalHint') : t('taskEdit.minimalInvalid')} />
      </section>
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
