import type { ReactNode } from 'react';
import type { Experiment } from '../../shared/config';
import { ko } from '../i18n/ko';
import { ExperimentsPage } from '../pages/ExperimentsPage';
import type { PageProps } from '../pages/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; pageProps: PageProps; banner: ReactNode; editorKey: number; onCreated: (experiment: Experiment) => void };

/** The experiment planning form (task × model × prompt × environment) in a dialog. */
export function NewExperimentDialog({ open, onOpenChange, pageProps, banner, editorKey, onCreated }: Props) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
      <DialogHeader>
        <DialogTitle>{ko.newExperiment.title}</DialogTitle>
        <DialogDescription>{ko.newExperiment.description}</DialogDescription>
      </DialogHeader>
      {banner}
      <ExperimentsPage key={editorKey} {...pageProps} onRun={onCreated} />
    </DialogContent>
  </Dialog>;
}
