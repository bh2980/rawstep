import { useTranslation } from 'react-i18next';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';

type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  name: string; file: string;
  /** Recorded runs of the task; they stay in .rawstep. */
  runCount: number;
  /** Runs that are queued or running: the task cannot be deleted until they end. */
  activeCount: number;
  onConfirm: () => void;
};

/** Asks before a task is deleted and says exactly what goes: the task in rawstep.config.json and its file. Run records stay. */
export function DeleteTaskDialog({ open, onOpenChange, name, file, runCount, activeCount, onConfirm }: Props) {
  const { t } = useTranslation();
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('taskDelete.title', { name })}</AlertDialogTitle>
        <AlertDialogDescription className="grid gap-2 text-left">
          <span>{t('taskDelete.removes', { file })}</span>
          <span>{runCount > 0 ? t('taskDelete.keepsRuns', { count: runCount }) : t('taskDelete.noRuns')}</span>
          <span>{t('taskDelete.final')}</span>
          {activeCount > 0 && <span role="alert" className="font-medium text-foreground">{t('taskDelete.active', { count: activeCount })}</span>}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t('taskDelete.cancel')}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={activeCount > 0} onClick={onConfirm}>{t('taskDelete.confirm')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
