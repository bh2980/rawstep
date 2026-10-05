import { useRef, useState, type ChangeEvent } from 'react';
import { ChevronDown, FileUp } from 'lucide-react';
import { defaultModes } from '../../shared/config';
import { api } from '../api';
import { useTranslation } from 'react-i18next';
import { createManagedTask, slugify } from '../lib/taskFiles';
import type { PageProps } from '../pages/types';
import { Field } from './forms';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

type Props = PageProps & { open: boolean; onOpenChange: (open: boolean) => void; onImported: (taskId: string) => void };

const NAME_LIMIT = 60;

/** Registers a Task JSON file: picked from the computer (copied into tasks/), or linked by its path inside the project. */
export function TaskImportDialog({ open, onOpenChange, onImported, ...props }: Props) {
  const { t } = useTranslation();
  const picker = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState('');
  const [linking, setLinking] = useState(false);
  const finish = (id: string) => { setPath(''); setLinking(false); onOpenChange(false); onImported(id); };
  async function importPicked(file: File) {
    let parsed: unknown;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error(t('task.importInvalidJson')); }
    const base = file.name.replace(/\.json$/i, '');
    const goal = typeof (parsed as { goal?: unknown } | null)?.goal === 'string' ? (parsed as { goal: string }).goal.trim() : '';
    const name = goal ? (goal.length > NAME_LIMIT ? goal.slice(0, NAME_LIMIT - 1) + '…' : goal) : base || t('task.importFallbackName');
    finish(await createManagedTask(props, { name, slug: slugify(base), task: parsed }));
  }
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void props.act(() => importPicked(file));
  };
  async function linkByPath() {
    await api<unknown>('/tasks/import', { method: 'POST', body: { file: path } });
    const id = crypto.randomUUID();
    const task = { id, name: path.split('/').pop() ?? t('task.importFallbackName'), file: path, modes: defaultModes() };
    await props.save({ ...props.view.config, tasks: [...props.view.config.tasks, task] });
    finish(id);
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t('task.importTitle')}</DialogTitle><DialogDescription>{t('task.importDescription')}</DialogDescription></DialogHeader>
      <input ref={picker} type="file" accept=".json,application/json" className="hidden" onChange={picked} />
      <Button disabled={props.busy} onClick={() => picker.current?.click()}><FileUp aria-hidden="true" />{t('task.importPick')}</Button>
      <Collapsible open={linking} onOpenChange={setLinking} className="grid gap-3 border-t pt-4">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="justify-between px-0 font-normal hover:bg-transparent">{t('task.importLinkTitle')}<ChevronDown aria-hidden="true" className={'transition-transform' + (linking ? ' rotate-180' : '')} /></Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-3">
          <p className="text-xs leading-5 text-muted-foreground">{t('task.importLinkDescription')}</p>
          <Field label={t('task.importPath')} value={path} onChange={setPath} hint={t('task.importPathHint')} />
          <DialogFooter>
            <Button variant="outline" disabled={props.busy || !path.trim()} onClick={() => void props.act(linkByPath)}>{t('task.importAction')}</Button>
          </DialogFooter>
        </CollapsibleContent>
      </Collapsible>
    </DialogContent>
  </Dialog>;
}
