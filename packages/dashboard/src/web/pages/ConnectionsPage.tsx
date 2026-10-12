import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { agentOf, isFilePlanner, type Combo, type Connection, type ProjectConfig, type ProjectSettings } from '@rawstep/project/config';
import type { ModelCheck } from '../../shared/api';
import type { RouteChange } from '../hooks/useRoute';
import { ApiError, api } from '../api';
import { ConnectionEditDialog } from '../components/ConnectionEditDialog';
import { ConnectionSetupDialog } from '../components/ConnectionSetupDialog';
import { CheckStatus, type CheckState } from '../components/CheckStatus';
import { ConceptNote } from '../components/layout/ConceptNote';
import { EmptyState } from '../components/layout/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import { Link } from '../components/Link';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { keyStatus, kindLabelKey, providerTextKey } from '../lib/connections';
import { cn } from '../lib/utils';
import type { PageProps } from './types';

const head = 'h-8 px-3 text-xs font-medium tracking-wide text-muted-foreground';

type Role = 'planner' | 'screenreader' | 'keyboard' | 'analysis' | 'suggestions';
const ROLES: readonly Role[] = ['planner', 'screenreader', 'keyboard', 'analysis', 'suggestions'];
type Use = { role: Role; names: { label: string; to: RouteChange }[] };

/** What uses a connection, by role: combos that plan, execute in a mode or explain with it, and the project's analysis and suggestion models. */
function usesOf(config: ProjectConfig, id: string, projectLabel: string, ownedLabel: (name: string) => string): Use[] {
  const combo = (c: Combo) => ({ label: c.owner ? ownedLabel(c.name) : c.name, to: { view: 'conditions' } as RouteChange });
  const project = { label: projectLabel, to: { view: 'settings' } as RouteChange };
  const by: Record<Role, { label: string; to: RouteChange }[]> = {
    planner: config.combos.filter(c => c.structure === 'planned' && !isFilePlanner(c.planner) && c.planner?.connectionId === id).map(combo),
    screenreader: config.combos.filter(c => c.executors.screenreader?.connectionId === id).map(combo),
    keyboard: config.combos.filter(c => c.executors.keyboard?.connectionId === id).map(combo),
    analysis: [...config.combos.filter(c => c.analysis?.connectionId === id).map(combo), ...(config.project.analysis.model?.connectionId === id ? [project] : [])],
    suggestions: config.project.suggestions.model?.connectionId === id ? [project] : [],
  };
  return ROLES.filter(role => by[role].length).map(role => ({ role, names: by[role] }));
}
/** A combo without the roles a removed connection played; a planned combo that loses its planner decides alone. */
function withoutConnection(combo: Combo, id: string): Combo {
  const { planner, executors, analysis, ...rest } = combo;
  const { screenreader, keyboard } = executors;
  const keepPlanner = planner && (isFilePlanner(planner) || planner.connectionId !== id);
  return {
    ...rest, structure: combo.structure === 'planned' && !keepPlanner ? 'solo' : combo.structure, ...(keepPlanner ? { planner } : {}),
    executors: { ...(screenreader && screenreader.connectionId !== id ? { screenreader } : {}), ...(keyboard && keyboard.connectionId !== id ? { keyboard } : {}) },
    ...(analysis && analysis.connectionId !== id ? { analysis } : {}),
  };
}
/** The project settings without models on a removed connection: analysis falls back to rules, suggestions to the analysis model. */
function projectWithout(project: ProjectSettings, id: string): ProjectSettings {
  const { model: analysisModel, ...analysis } = project.analysis;
  return {
    analysis: analysisModel && analysisModel.connectionId !== id ? { ...analysis, model: analysisModel } : analysis,
    suggestions: project.suggestions.model && project.suggestions.model.connectionId !== id ? project.suggestions : {},
  };
}

/**
 * Connections: where models are reached (a provider with its key, or a custom server). A connection holds no model; a model combo (or the
 * project's analysis and suggestion settings) picks the model ID on one. 쓰는 곳 lists those uses by role. The status is what is known without asking until a person presses 확인, which asks the provider once.
 */
export function ConnectionsPage({ navigate, ...props }: PageProps & { navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Connection>();
  const [deleting, setDeleting] = useState<Connection>();
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const { config, credentialStatus } = props.view;
  // Combos that used the connection lose that role (a mode without an executor cannot run until another is picked, a combo without
  // its planner decides alone); the project's analysis falls back to the rule-based analysis.
  const remove = (connection: Connection) => { setDeleting(undefined); void props.act(async () => {
    const latest = props.view.config;
    await props.save({ ...latest, combos: latest.combos.map(combo => withoutConnection(combo, connection.id)), project: projectWithout(latest.project, connection.id), connections: latest.connections.filter(c => c.id !== connection.id) });
  }); };
  async function check(connection: Connection) {
    setChecks(current => ({ ...current, [connection.id]: { state: 'running' } }));
    try {
      const result = await api<ModelCheck>('/connections/check', { method: 'POST', body: { connectionId: connection.id } });
      setChecks(current => ({ ...current, [connection.id]: { state: 'done', result } }));
    } catch (error) { setChecks(current => ({ ...current, [connection.id]: { state: 'failed', connection: error instanceof ApiError && error.status === 0 } })); }
  }
  async function signIn(connection: Connection) {
    setChecks(current => ({ ...current, [connection.id]: { state: 'running' } }));
    try {
      const result = await api<ModelCheck>('/connections/sign-in', { method: 'POST', body: { connectionId: connection.id } });
      setChecks(current => ({ ...current, [connection.id]: { state: 'done', result } }));
    } catch (error) { setChecks(current => ({ ...current, [connection.id]: { state: 'failed', connection: error instanceof ApiError && error.status === 0 } })); }
  }
  const uses = (id: string) => usesOf(config, id, t('connections.projectUser'), name => t('connections.ownedUser', { name }));
  const deletingUses = deleting ? uses(deleting.id) : [];
  const deletingNames = [...new Set(deletingUses.flatMap(use => use.names.map(n => n.label)))];
  return <div className="grid gap-5">
    <PageHeader title={t('connections.heading')} description={t('connections.intro')}
      actions={config.connections.length > 0 && <Button size="xl" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('connections.add')}</Button>} />
    {config.connections.some(c => c.kind === 'decision') && <ConceptNote concept="decisionModel" />}
    {config.connections.length === 0
      ? <EmptyState title={t('empty.connections.title')} why={t('empty.connections.why')} action={<Button size="xl" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('empty.connections.action')}</Button>} />
      : <div className="overflow-x-auto border-y border-edge-strong">
        <Table className="min-w-[48rem]">
          <TableCaption className="sr-only">{t('connections.listLabel')}</TableCaption>
          <TableHeader><TableRow className="bg-raised hover:bg-raised">
            <TableHead scope="col" className={head}>{t('connections.columns.name')}</TableHead>
            <TableHead scope="col" className={head}>{t('connections.columns.kind')}</TableHead>
            <TableHead scope="col" className={head}>{t('connections.columns.usedBy')}</TableHead>
            <TableHead scope="col" className={head}>{t('connections.columns.status')}</TableHead>
            <TableHead scope="col" className={head}><span className="sr-only">{t('connections.columns.actions')}</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{config.connections.map(connection => {
            const status = keyStatus(connection, credentialStatus), result = checks[connection.id], users = uses(connection.id);
            return <TableRow key={connection.id} className="h-12 align-top">
              <TableCell className="px-3 py-2.5 whitespace-normal">
                <span className="block font-medium break-all">{connection.name}</span>
                <span className="block text-xs text-muted-foreground">{t(`connections.providers.${providerTextKey(connection.kind, connection.provider)}.name`)}{connection.baseURL && <> · <span className="font-mono break-all">{connection.baseURL}</span></>}{agentOf(connection) && <> · <span className="font-mono break-all">{agentOf(connection)!.command}</span></>}</span>
              </TableCell>
              <TableCell className="px-3 py-2.5 text-[13px] whitespace-nowrap">{t(`connections.kinds.${kindLabelKey(connection)}.name`)}</TableCell>
              <TableCell className="px-3 py-2.5 text-[13px] whitespace-normal">
                {users.length
                  ? <dl className="grid gap-0.5">{users.map(use => <div key={use.role} className="flex flex-wrap gap-x-1.5">
                    <dt className="text-muted-foreground">{t(`connections.roles.${use.role}`)}</dt>
                    <dd>{use.names.map((name, index) => <span key={index}>{index > 0 && ', '}<Link to={name.to} navigate={navigate} className="underline underline-offset-2">{name.label}</Link></span>)}</dd>
                  </div>)}</dl>
                  : <span className="text-muted-foreground">{t('connections.unused')}</span>}
              </TableCell>
              <TableCell className="px-3 py-2.5 text-[13px] whitespace-normal">
                {result
                  ? <CheckStatus check={result} signIn={agentOf(connection) ? { available: !!agentOf(connection)!.signIn, onClick: () => void signIn(connection) } : undefined} />
                  : <span className="grid gap-0.5"><span className={cn('font-medium', status === 'missing' && 'text-inspect')}>{t(`connections.status.${status}`)}</span><span className="text-xs text-muted-foreground">{t('connections.status.notChecked')}</span></span>}
              </TableCell>
              <TableCell className="px-3 py-2.5 text-right whitespace-nowrap"><span className="inline-flex gap-1.5">
                <Button variant="outline" size="sm" className="h-7" disabled={result?.state === 'running'} aria-label={t('connections.checkAria', { name: connection.name })} onClick={() => void check(connection)}><Zap aria-hidden="true" />{t('connections.check')}</Button>
                <Button variant="outline" size="sm" className="h-7" aria-label={t('connections.editAria', { name: connection.name })} onClick={() => setEditing(connection)}><Pencil aria-hidden="true" />{t('connections.edit')}</Button>
                <Button variant="outline" size="sm" className="h-7" disabled={props.busy} aria-label={t('connections.deleteAria', { name: connection.name })} onClick={() => setDeleting(connection)}><Trash2 aria-hidden="true" />{t('connections.delete')}</Button>
              </span></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>}
    <ConnectionSetupDialog open={adding} onOpenChange={setAdding} pageProps={props} />
    <ConnectionEditDialog connection={editing} onClose={() => setEditing(undefined)} pageProps={props} />
    <AlertDialog open={!!deleting} onOpenChange={open => { if (!open) setDeleting(undefined); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('connections.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('connections.deleteDescription', { name: deleting?.name ?? '' })}{deletingNames.length > 0 && ' ' + t('connections.deleteUsed', { users: deletingNames.join(', ') })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('connections.cancel')}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => deleting && remove(deleting)}>{t('connections.delete')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
