import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { credentialId, modelKeyEnv, modelKeyRequired, type Model } from '@rawstep/project/config';
import { ModelEditDialog } from '../components/ModelEditDialog';
import { ModelSetupDialog } from '../components/ModelSetupDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { providerTextKey, usageKey } from '../lib/modelSetup';
import type { PageProps } from './types';

/** Registered models as a dense list; provider details and capabilities stay behind the add/edit dialogs. */
export function ModelsPage(props: PageProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Model>();
  const [deleting, setDeleting] = useState<Model>();
  const { config, credentialStatus } = props.view;
  const remove = (model: Model) => { setDeleting(undefined); void props.act(async () => { await props.save({ ...props.view.config, models: props.view.config.models.filter(m => m.id !== model.id) }); }); };
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-semibold tracking-tight">{t('modelSetup.heading')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('modelSetup.intro')}</p></div>
      {config.models.length > 0 && <Button size="xl" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('modelSetup.add')}</Button>}
    </div>
    {config.models.length === 0
      ? <div className="grid justify-items-center gap-3 rounded-lg border border-dashed py-12 text-center"><div className="grid gap-1"><p className="font-medium">{t('modelSetup.emptyTitle')}</p><p className="max-w-md text-sm text-muted-foreground">{t('modelSetup.emptyDescription')}</p></div><Button size="xl" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('modelSetup.add')}</Button></div>
      : <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-[40rem]">
          <TableCaption className="sr-only">{t('modelSetup.listLabel')}</TableCaption>
          <TableHeader><TableRow className="h-9 text-xs">
            <TableHead scope="col" className="px-3 text-muted-foreground">{t('modelSetup.columns.name')}</TableHead>
            <TableHead scope="col" className="px-3 text-muted-foreground">{t('modelSetup.columns.provider')}</TableHead>
            <TableHead scope="col" className="px-3 text-muted-foreground">{t('modelSetup.columns.usage')}</TableHead>
            <TableHead scope="col" className="px-3 text-muted-foreground">{t('modelSetup.columns.key')}</TableHead>
            <TableHead scope="col" className="px-3"><span className="sr-only">{t('modelSetup.columns.actions')}</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{config.models.map(model => {
            const keyUsed = modelKeyRequired(model) || !!modelKeyEnv(model), keySet = !!credentialStatus[credentialId(model)];
            return <TableRow key={model.id} className="h-12">
              <TableCell className="px-3 whitespace-normal">
                <span className="flex flex-wrap items-center gap-2"><span className="font-medium break-all">{model.name}</span><Badge variant="outline">{t(`modelSetup.kinds.${model.kind}.name`)}</Badge></span>
                <span className="block font-mono text-xs break-all text-muted-foreground">{model.modelId}</span>
              </TableCell>
              <TableCell className="px-3">{t(`modelSetup.providers.${providerTextKey(model.kind, model.provider)}.name`)}</TableCell>
              <TableCell className="px-3 whitespace-normal">
                <span className="flex flex-wrap items-center gap-1.5">{t(`modelSetup.usage.${usageKey(model.inputs)}`)}{model.roles.includes('analysis') && <Badge variant="secondary">{t('modelSetup.analysisBadge')}</Badge>}</span>
              </TableCell>
              <TableCell className="px-3">{keyUsed ? <span className={keySet ? 'text-positive' : 'text-warning'}>{keySet ? t('modelSetup.keySet') : t('modelSetup.keyMissing')}</span> : <span className="text-muted-foreground">{t('modelSetup.keyNotUsed')}</span>}</TableCell>
              <TableCell className="px-3 text-right"><span className="inline-flex gap-1.5">
                <Button variant="outline" size="sm" className="h-8" aria-label={t('modelSetup.editAria', { name: model.name })} onClick={() => setEditing(model)}><Pencil aria-hidden="true" />{t('modelSetup.edit')}</Button>
                <Button variant="outline" size="sm" className="h-8" disabled={props.busy} aria-label={t('modelSetup.deleteAria', { name: model.name })} onClick={() => setDeleting(model)}><Trash2 aria-hidden="true" />{t('modelSetup.delete')}</Button>
              </span></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>}
    <ModelSetupDialog open={adding} onOpenChange={setAdding} pageProps={props} />
    <ModelEditDialog model={editing} onClose={() => setEditing(undefined)} pageProps={props} />
    <AlertDialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(undefined); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('modelSetup.deleteTitle')}</AlertDialogTitle><AlertDialogDescription>{t('modelSetup.deleteDescription', { name: deleting?.name ?? '' })}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('modelSetup.cancel')}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => deleting && remove(deleting)}>{t('modelSetup.delete')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
