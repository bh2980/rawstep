import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2, Zap } from 'lucide-react';
import type { Model } from '@rawstep/project/config';
import type { ModelCheck } from '../../shared/api';
import { ApiError, api } from '../api';
import { EmptyState } from '../components/layout/EmptyState';
import { ConceptNote } from '../components/layout/ConceptNote';
import { ModelEditDialog } from '../components/ModelEditDialog';
import { ModelSetupDialog } from '../components/ModelSetupDialog';
import { ModelStatus, type CheckState } from '../components/ModelStatus';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { keyStatus, providerTextKey, usageKey } from '../lib/modelSetup';
import { cn } from '../lib/utils';
import type { PageProps } from './types';

const head = 'h-8 px-3 text-xs font-medium tracking-wide text-muted-foreground';

/**
 * Registered models as a configuration sheet (spec §33): NAME, KIND, PROVIDER and STATUS. The status is what is known without asking
 * (a key is set, missing, or there is nothing to check) until a person presses 확인, which asks the provider once and shows how it went.
 */
export function ModelsPage(props: PageProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Model>();
  const [deleting, setDeleting] = useState<Model>();
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const { config, credentialStatus } = props.view;
  const remove = (model: Model) => { setDeleting(undefined); void props.act(async () => { await props.save({ ...props.view.config, models: props.view.config.models.filter(m => m.id !== model.id) }); }); };
  async function check(model: Model) {
    setChecks(current => ({ ...current, [model.id]: { state: 'running' } }));
    try {
      const result = await api<ModelCheck>('/models/check', { method: 'POST', body: { id: model.id } });
      setChecks(current => ({ ...current, [model.id]: { state: 'done', result } }));
    } catch (error) { setChecks(current => ({ ...current, [model.id]: { state: 'failed', connection: error instanceof ApiError && error.status === 0 } })); }
  }
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-semibold tracking-tight">{t('modelSetup.heading')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('modelSetup.intro')}</p></div>
      {config.models.length > 0 && <Button size="xl" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('modelSetup.add')}</Button>}
    </div>
    {config.models.some(model => model.kind === 'decision') && <ConceptNote concept="decisionModel" />}
    {config.models.length === 0
      ? <EmptyState title={t('empty.models.title')} why={t('empty.models.why')} action={<Button size="xl" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('empty.models.action')}</Button>} />
      : <div className="overflow-x-auto rounded-md border border-edge-strong bg-surface">
        <Table className="min-w-[44rem]">
          <TableCaption className="sr-only">{t('modelSetup.listLabel')}</TableCaption>
          <TableHeader><TableRow className="bg-raised hover:bg-raised">
            <TableHead scope="col" className={head}>{t('modelSetup.columns.name')}</TableHead>
            <TableHead scope="col" className={head}>{t('modelSetup.columns.kind')}</TableHead>
            <TableHead scope="col" className={head}>{t('modelSetup.columns.provider')}</TableHead>
            <TableHead scope="col" className={head}>{t('modelSetup.columns.status')}</TableHead>
            <TableHead scope="col" className={head}><span className="sr-only">{t('modelSetup.columns.actions')}</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{config.models.map(model => {
            const status = keyStatus(model, credentialStatus), result = checks[model.id];
            return <TableRow key={model.id} className="h-12 align-top">
              <TableCell className="px-3 py-2 whitespace-normal">
                <span className="block font-medium break-all">{model.name}</span>
                <span className="block font-mono text-xs break-all text-muted-foreground">{model.modelId}</span>
                <span className="block text-xs text-muted-foreground">{t(`modelSetup.usage.${usageKey(model.inputs)}`)}{model.roles.includes('analysis') && ` · ${t('modelSetup.analysisBadge')}`}</span>
              </TableCell>
              <TableCell className="px-3 py-2 text-[13px] whitespace-nowrap">{t(`modelSetup.kinds.${model.kind}.name`)}</TableCell>
              <TableCell className="px-3 py-2 text-[13px] whitespace-nowrap">{t(`modelSetup.providers.${providerTextKey(model.kind, model.provider)}.name`)}</TableCell>
              <TableCell className="px-3 py-2 text-[13px] whitespace-normal">
                {result
                  ? <ModelStatus check={result} />
                  : <span className="grid gap-0.5"><span className={cn('font-medium', status === 'missing' && 'text-inspect')}>{t(`modelSetup.status.${status}`)}</span><span className="text-xs text-muted-foreground">{t('modelSetup.status.notChecked')}</span></span>}
              </TableCell>
              <TableCell className="px-3 py-2 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                <Button variant="outline" size="sm" className="h-7" disabled={result?.state === 'running'} aria-label={t('modelSetup.checkAria', { name: model.name })} onClick={() => void check(model)}><Zap aria-hidden="true" />{t('modelSetup.check.button')}</Button>
                <Button variant="outline" size="sm" className="h-7" aria-label={t('modelSetup.editAria', { name: model.name })} onClick={() => setEditing(model)}><Pencil aria-hidden="true" />{t('modelSetup.edit')}</Button>
                <Button variant="outline" size="sm" className="h-7" disabled={props.busy} aria-label={t('modelSetup.deleteAria', { name: model.name })} onClick={() => setDeleting(model)}><Trash2 aria-hidden="true" />{t('modelSetup.delete')}</Button>
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
