import type { ReactNode } from 'react';
import type { Experiment } from '../../shared/config';
import { useTranslation } from 'react-i18next';
import { ExperimentsPage } from '../pages/ExperimentsPage';
import type { PageProps } from '../pages/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; pageProps: PageProps; banner: ReactNode; editorKey: number; onCreated: (experiment: Experiment) => void };

/** The experiment planning form (task × model × prompt × run profile) in a dialog. */
export function NewExperimentDialog({ open, onOpenChange, pageProps, banner, editorKey, onCreated }: Props) {
  const { t } = useTranslation();
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
      <DialogHeader>
        <DialogTitle>{t('newExperiment.title')}</DialogTitle>
        <DialogDescription>{t('newExperiment.description')}</DialogDescription>
      </DialogHeader>
      {banner}
      <ExperimentsPage key={editorKey} {...pageProps} onRun={onCreated} />
    </DialogContent>
  </Dialog>;
}
