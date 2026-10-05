import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Model } from '../../shared/config';
import { ModelEditDialog } from '../components/ModelEditDialog';
import { ModelSetupDialog } from '../components/ModelSetupDialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { usageKey } from '../lib/modelSetup';
import type { PageProps } from './types';

/** Registered models as a plain list; connections and capability details stay behind the add/edit dialogs. */
export function ModelsPage(props: PageProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Model>();
  const [deleting, setDeleting] = useState<Model>();
  const { config, credentialStatus } = props.view;
  const remove = (model: Model) => { setDeleting(undefined); void props.act(async () => { await props.save({ ...props.view.config, models: props.view.config.models.filter(m => m.id !== model.id) }); }); };
  return <>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-lg font-semibold tracking-tight">{t('modelSetup.heading')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('modelSetup.intro')}</p></div>
      {config.models.length > 0 && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('modelSetup.add')}</Button>}
    </div>
    {config.models.length === 0
      ? <Card><CardContent className="grid justify-items-center gap-4 py-10 text-center"><div className="grid gap-1"><p className="font-medium">{t('modelSetup.emptyTitle')}</p><p className="max-w-md text-sm text-muted-foreground">{t('modelSetup.emptyDescription')}</p></div><Button onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('modelSetup.add')}</Button></CardContent></Card>
      : <ul aria-label={t('modelSetup.listLabel')} className="grid gap-3">{config.models.map(model => {
        const connection = config.connections.find(c => c.id === model.connectionId);
        const keySet = !!connection && !!credentialStatus[connection.id];
        return <li key={model.id}><Card size="sm"><CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid min-w-0 gap-1.5">
            <p className="break-all font-medium">{model.name}</p>
            <p className="text-sm text-muted-foreground">{connection ? t(`modelSetup.where.${connection.provider}`) : '-'} · {t(`modelSetup.usage.${usageKey(model.inputs)}`)}</p>
            <div className="flex flex-wrap gap-1.5">
              {model.roles.includes('analysis') && <Badge variant="secondary">{t('modelSetup.analysisBadge')}</Badge>}
              <Badge variant={keySet ? 'outline' : 'ghost'}>{keySet ? t('modelSetup.keySet') : t('modelSetup.keyMissing')}</Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" aria-label={t('modelSetup.editAria', { name: model.name })} onClick={() => setEditing(model)}><Pencil aria-hidden="true" />{t('modelSetup.edit')}</Button>
            <Button variant="outline" size="sm" disabled={props.busy} aria-label={t('modelSetup.deleteAria', { name: model.name })} onClick={() => setDeleting(model)}><Trash2 aria-hidden="true" />{t('modelSetup.delete')}</Button>
          </div>
        </CardContent></Card></li>;
      })}</ul>}
    <ModelSetupDialog open={adding} onOpenChange={setAdding} pageProps={props} />
    <ModelEditDialog model={editing} onClose={() => setEditing(undefined)} pageProps={props} />
    <AlertDialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(undefined); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('modelSetup.deleteTitle')}</AlertDialogTitle><AlertDialogDescription>{t('modelSetup.deleteDescription', { name: deleting?.name ?? '' })}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('modelSetup.cancel')}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => deleting && remove(deleting)}>{t('modelSetup.delete')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
