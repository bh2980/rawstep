import { useState } from 'react';
import { defaultModes } from '../../shared/config';
import { api } from '../api';
import { useTranslation } from 'react-i18next';
import type { PageProps } from '../pages/types';
import { Field } from './forms';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

type Props = PageProps & { open: boolean; onOpenChange: (open: boolean) => void; onImported: (taskId: string) => void };

/** Registers an existing Task JSON file as a managed task (same flow as the former Tasks page). */
export function TaskImportDialog({ open, onOpenChange, onImported, ...props }: Props) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  async function importTask() {
    await api<unknown>('/tasks/import', { method: 'POST', body: { file: path } });
    const id = crypto.randomUUID();
    const task = { id, name: path.split('/').pop() ?? t('task.importFallbackName'), file: path, modes: defaultModes() };
    await props.save({ ...props.view.config, tasks: [...props.view.config.tasks, task] });
    setPath(''); onOpenChange(false); onImported(id);
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t('task.importTitle')}</DialogTitle><DialogDescription>{t('task.importDescription')}</DialogDescription></DialogHeader>
      <Field label={t('task.importPath')} value={path} onChange={setPath} hint={t('task.importPathHint')} />
      <DialogFooter>
        <Button disabled={props.busy || !path} onClick={() => void props.act(importTask)}>{t('task.importAction')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
