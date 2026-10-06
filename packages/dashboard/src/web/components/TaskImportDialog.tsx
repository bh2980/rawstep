import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FileUp } from 'lucide-react';
import { defaultModes } from '@rawstep/project/config';
import { api } from '../api';
import { useTranslation } from 'react-i18next';
import { createManagedTask, slugify } from '../lib/taskFiles';
import type { PageProps } from '../pages/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

type Props = PageProps & { open: boolean; onOpenChange: (open: boolean) => void; onImported: (taskId: string) => void };
type Candidate = { file: string; goal: string; url: string };

const NAME_LIMIT = 60;
const nameFrom = (goal: string, fallback: string) => goal ? (goal.length > NAME_LIMIT ? goal.slice(0, NAME_LIMIT - 1) + '…' : goal) : fallback;

/**
 * Registers an existing Task JSON file. Files already in the project are found by the server and listed, and are linked where
 * they are (no copy); a file from anywhere else is picked from the computer and copied into tasks/. Nobody types a path.
 */
export function TaskImportDialog({ open, onOpenChange, onImported, ...props }: Props) {
  const { t } = useTranslation();
  const picker = useRef<HTMLInputElement>(null);
  const [candidates, setCandidates] = useState<Candidate[]>();
  useEffect(() => {
    if (!open) return;
    setCandidates(undefined);
    let current = true;
    api<Candidate[]>('/tasks/candidates').then(list => { if (current) setCandidates(list); }, () => { if (current) setCandidates([]); });
    return () => { current = false; };
  }, [open]);
  const finish = (id: string) => { onOpenChange(false); onImported(id); };
  async function importPicked(file: File) {
    let parsed: unknown;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error(t('task.importInvalidJson')); }
    const base = file.name.replace(/\.json$/i, '');
    const goal = typeof (parsed as { goal?: unknown } | null)?.goal === 'string' ? (parsed as { goal: string }).goal.trim() : '';
    finish((await createManagedTask(props, { name: nameFrom(goal, base || t('task.importFallbackName')), slug: slugify(base), task: parsed })).id);
  }
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void props.act(() => importPicked(file));
  };
  async function link(candidate: Candidate) {
    await api<unknown>('/tasks/import', { method: 'POST', body: { file: candidate.file } });
    const id = crypto.randomUUID();
    const fallback = candidate.file.split('/').pop()?.replace(/\.json$/i, '') ?? t('task.importFallbackName');
    await props.save({ ...props.view.config, tasks: [...props.view.config.tasks, { id, name: nameFrom(candidate.goal, fallback), file: candidate.file, modes: defaultModes() }] });
    finish(id);
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader><DialogTitle>{t('task.importTitle')}</DialogTitle><DialogDescription>{t('task.importDescription')}</DialogDescription></DialogHeader>
      <section aria-labelledby="import-found" className="grid gap-2">
        <h3 id="import-found" className="text-sm font-semibold">{t('task.importFoundTitle')}</h3>
        <p className="text-xs leading-5 text-muted-foreground">{t('task.importFoundNote')}</p>
        {candidates === undefined
          ? <p role="status" className="py-3 text-sm text-muted-foreground">{t('task.importSearching')}</p>
          : candidates.length === 0
            ? <p className="border-y border-edge py-3 pl-3 text-sm text-muted-foreground">{t('task.importNoneFound')}</p>
            : <ul className="grid max-h-72 divide-y divide-edge overflow-y-auto border-y border-edge">
              {candidates.map(candidate => <li key={candidate.file} className="flex items-center justify-between gap-4 py-2.5 pr-1 pl-3">
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate font-mono text-[13px]">{candidate.file}</span>
                  <span className="truncate text-xs text-muted-foreground">{candidate.goal}</span>
                </span>
                <Button type="button" variant="outline" size="sm" disabled={props.busy} aria-label={t('task.importLinkAria', { file: candidate.file })} onClick={() => void props.act(() => link(candidate))}>{t('task.importAction')}</Button>
              </li>)}
            </ul>}
      </section>
      <section aria-labelledby="import-other" className="grid gap-2 border-t border-edge pt-4">
        <h3 id="import-other" className="text-sm font-semibold">{t('task.importOtherTitle')}</h3>
        <p className="text-xs leading-5 text-muted-foreground">{t('task.importOtherNote')}</p>
        <input ref={picker} type="file" accept=".json,application/json" className="hidden" onChange={picked} />
        <Button type="button" variant="outline" className="justify-self-start" disabled={props.busy} onClick={() => picker.current?.click()}><FileUp aria-hidden="true" />{t('task.importPick')}</Button>
      </section>
    </DialogContent>
  </Dialog>;
}
