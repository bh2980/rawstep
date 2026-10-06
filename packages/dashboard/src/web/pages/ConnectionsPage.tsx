import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2, Zap } from 'lucide-react';
import type { Agent, Connection, ProjectConfig } from '@rawstep/project/config';
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
import { keyStatus, providerTextKey } from '../lib/connections';
import { cn } from '../lib/utils';
import type { PageProps } from './types';

const head = 'h-8 px-3 text-xs font-medium tracking-wide text-muted-foreground';

/** Whether an agent plans or executes (in either mode) with a connection. */
const agentUses = (agent: Agent, id: string) => agent.planner?.connectionId === id || agent.executors.screenreader?.connectionId === id || agent.executors.keyboard?.connectionId === id;
/** What uses a connection: the agents that plan or execute with it, and whether post-run analysis does. */
const usersOf = (config: Pick<ProjectConfig, 'agents' | 'analysis'>, id: string) => ({ agents: config.agents.filter(agent => agentUses(agent, id)), analysis: config.analysis.model?.connectionId === id });
/** An agent without the parts that used a removed connection: the planner, or the executor of a mode. */
function withoutConnection(agent: Agent, id: string): Agent {
  const { planner, executors, ...rest } = agent;
  const { screenreader, keyboard } = executors;
  return {
    ...rest, ...(planner && planner.connectionId !== id ? { planner } : {}),
    executors: { ...(screenreader && screenreader.connectionId !== id ? { screenreader } : {}), ...(keyboard && keyboard.connectionId !== id ? { keyboard } : {}) },
  };
}

/**
 * Connections: where models are reached (a provider with its key, or a custom server). A connection holds no model; an agent (or post-run
 * analysis) picks the model ID on one. The status is what is known without asking until a person presses 확인, which asks the provider once.
 */
export function ConnectionsPage({ navigate, ...props }: PageProps & { navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Connection>();
  const [deleting, setDeleting] = useState<Connection>();
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const { config, credentialStatus } = props.view;
  // Agents that used the connection lose that planner or executor (a mode without an executor cannot run until another is picked);
  // post-run analysis falls back to the rule-based analysis.
  const remove = (connection: Connection) => { setDeleting(undefined); void props.act(async () => {
    const latest = props.view.config, agents = latest.agents.map(agent => withoutConnection(agent, connection.id));
    const { model, ...analysis } = latest.analysis;
    await props.save({ ...latest, agents, analysis: model && model.connectionId !== connection.id ? { ...analysis, model } : analysis, connections: latest.connections.filter(c => c.id !== connection.id) });
  }); };
  async function check(connection: Connection) {
    setChecks(current => ({ ...current, [connection.id]: { state: 'running' } }));
    try {
      const result = await api<ModelCheck>('/connections/check', { method: 'POST', body: { connectionId: connection.id } });
      setChecks(current => ({ ...current, [connection.id]: { state: 'done', result } }));
    } catch (error) { setChecks(current => ({ ...current, [connection.id]: { state: 'failed', connection: error instanceof ApiError && error.status === 0 } })); }
  }
  const deletingUsers = deleting ? usersOf(config, deleting.id) : undefined;
  const deletingNames = deletingUsers ? [...deletingUsers.agents.map(agent => agent.name), ...(deletingUsers.analysis ? [t('connections.analysisUser')] : [])] : [];
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
            const status = keyStatus(connection, credentialStatus), result = checks[connection.id], users = usersOf(config, connection.id);
            return <TableRow key={connection.id} className="h-12 align-top">
              <TableCell className="px-3 py-2.5 whitespace-normal">
                <span className="block font-medium break-all">{connection.name}</span>
                <span className="block text-xs text-muted-foreground">{t(`connections.providers.${providerTextKey(connection.kind, connection.provider)}.name`)}{connection.baseURL && <> · <span className="font-mono break-all">{connection.baseURL}</span></>}</span>
              </TableCell>
              <TableCell className="px-3 py-2.5 text-[13px] whitespace-nowrap">{t(`connections.kinds.${connection.kind}.name`)}</TableCell>
              <TableCell className="px-3 py-2.5 text-[13px] whitespace-normal">
                {users.agents.length || users.analysis
                  ? <>
                    {users.agents.map((agent, index) => <span key={agent.id}>{index > 0 && ', '}<Link to={{ view: 'agents' }} navigate={navigate} className="underline underline-offset-2">{agent.name}</Link></span>)}
                    {users.analysis && <span>{users.agents.length > 0 && ', '}<Link to={{ view: 'settings' }} navigate={navigate} className="underline underline-offset-2">{t('connections.analysisUser')}</Link></span>}
                  </>
                  : <span className="text-muted-foreground">{t('connections.unused')}</span>}
              </TableCell>
              <TableCell className="px-3 py-2.5 text-[13px] whitespace-normal">
                {result
                  ? <CheckStatus check={result} />
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
