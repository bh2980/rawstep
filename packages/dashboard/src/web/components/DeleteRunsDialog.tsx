import { useTranslation } from 'react-i18next';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; count: number; onConfirm: () => void };

/** Asks before recorded runs are deleted: their files go from .rawstep and cannot be brought back. */
export function DeleteRunsDialog({ open, onOpenChange, count, onConfirm }: Props) {
  const { t } = useTranslation();
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('runDelete.title', { count })}</AlertDialogTitle>
        <AlertDialogDescription className="grid gap-2 text-left">
          <span>{t('runDelete.removes')}</span>
          <span>{t('runDelete.final')}</span>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t('runDelete.cancel')}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={onConfirm}>{t('runDelete.confirm')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
