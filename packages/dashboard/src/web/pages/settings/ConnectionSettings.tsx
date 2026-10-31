import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { agentOf, executorModel, isFilePlanner, type Connection, type Profile, type ProjectConfig, type ProjectSettings } from '@rawstep/project/config';
import type { ModelCheck } from '../../../shared/api';
import type { RouteChange } from '../../hooks/useRoute';
import { ApiError, api } from '../../api';
import { ConnectionEditDialog } from '../../components/ConnectionEditDialog';
import { ConnectionSetupDialog } from '../../components/ConnectionSetupDialog';
import { CheckStatus, type CheckState } from '../../components/CheckStatus';
import { InfoTip } from '../../components/layout/InfoTip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { EmptyState } from '../../components/layout/EmptyState';
import { PageHeader } from '../../components/layout/PageHeader';
import { Link } from '../../components/Link';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { keyStatus, kindLabelKey, providerTextKey } from '../../lib/connections';
import { cn } from '../../lib/utils';
import type { PageProps } from '../types';

const head = 'h-8 px-3 text-xs font-medium text-muted-foreground';

type Role = 'planner' | 'executor' | 'analysis' | 'suggestions';
const ROLES: readonly Role[] = ['planner', 'executor', 'analysis', 'suggestions'];
type Use = { role: Role; names: { label: string; to: RouteChange }[] };

/** What uses a connection, by role: run profiles that plan or execute with it, and the project's analysis and suggestion models. */
function usesOf(config: ProjectConfig, id: string, projectLabel: string): Use[] {
  const profile = (p: Profile) => ({ label: p.name, to: { view: 'settings', section: 'profiles' } as RouteChange });
  const project = { label: projectLabel, to: { view: 'settings', section: 'connections' } as RouteChange };
  const by: Record<Role, { label: string; to: RouteChange }[]> = {
    planner: config.profiles.filter(p => !isFilePlanner(p.planner) && p.planner?.connectionId === id).map(profile),
    executor: config.profiles.filter(p => executorModel(p)?.connectionId === id).map(profile),
    analysis: config.project.analysis.model?.connectionId === id ? [project] : [],
    suggestions: config.project.suggestions.model?.connectionId === id ? [project] : [],
  };
  return ROLES.filter(role => by[role].length).map(role => ({ role, names: by[role] }));
}
/** A profile without the roles a removed connection played: it may lose its planner or executor, and cannot run until new ones are picked. */
function withoutConnection(profile: Profile, id: string): Profile {
  const { planner, executor } = profile;
  const keepPlanner = planner && (isFilePlanner(planner) || planner.connectionId !== id);
  const keepExecutor = executor && ('followPlan' in executor || executor.connectionId !== id);
  const { planner: _planner, executor: _executor, ...rest } = profile;
  return { ...rest, ...(keepPlanner ? { planner } : {}), ...(keepExecutor ? { executor } : {}) };
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
 * 설정 · 연결: where models are reached (a provider with its key, or a custom server). A connection holds no model; a run profile (or the
 * project's analysis and suggestion settings) picks the model ID on one. 쓰는 곳 lists those uses by role. The status is what is known without asking until a person presses 확인, which asks the provider once.
 */
export function ConnectionSettings({ navigate, ...props }: PageProps & { navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Connection>();
  const [deleting, setDeleting] = useState<Connection>();
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const { config, credentialStatus } = props.view;
  // Profiles that used the connection lose that role (a profile without an executor or planner cannot run until another is picked);
  // the project's analysis falls back to the rule-based analysis.
  const remove = (connection: Connection) => { setDeleting(undefined); void props.act(async () => {
    const latest = props.view.config;
    await props.save({ ...latest, profiles: latest.profiles.map(profile => withoutConnection(profile, connection.id)), project: projectWithout(latest.project, connection.id), connections: latest.connections.filter(c => c.id !== connection.id) });
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
  const uses = (id: string) => usesOf(config, id, t('connections.projectUser'));
  const deletingUses = deleting ? uses(deleting.id) : [];
  const deletingNames = [...new Set(deletingUses.flatMap(use => use.names.map(n => n.label)))];
  return <div className="grid max-w-6xl gap-5">
    <PageHeader title={t('settingsNav.sections.connections')} info={t('settingsNav.info.connections')}
      actions={config.connections.length > 0 && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('connections.add')}</Button>} />
    {config.connections.length === 0
      ? <EmptyState title={t('empty.connections.title')} why={t('empty.connections.why')} action={<Button onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('empty.connections.action')}</Button>} />
      : <div className="overflow-x-auto rounded-md border border-edge-strong bg-surface">
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
                <span className="block min-w-32 font-medium break-words">{connection.name}</span>
                <span className="block text-xs text-muted-foreground">{t(`connections.providers.${providerTextKey(connection.kind, connection.provider)}.name`)}{connection.baseURL && <> · <span className="font-mono break-all">{connection.baseURL}</span></>}{agentOf(connection) && <> · <span className="font-mono break-all">{agentOf(connection)!.command}</span></>}</span>
              </TableCell>
              <TableCell className="px-3 py-2.5 text-[13px] whitespace-nowrap"><span className="inline-flex items-center gap-1">{t(`connections.kinds.${kindLabelKey(connection)}.name`)}{connection.kind === 'decision' && <InfoTip term={t(`connections.kinds.${kindLabelKey(connection)}.name`)}>{t('help.decisionModel')}</InfoTip>}</span></TableCell>
              <TableCell className="px-3 py-2.5 text-[13px] whitespace-normal">
                {users.length
                  ? <ul className="flex flex-wrap gap-1.5">{users.map(use => <li key={use.role}><UsePopover use={use} navigate={navigate} /></li>)}</ul>
                  : <span className="text-muted-foreground">{t('connections.unused')}</span>}
              </TableCell>
              <TableCell className="min-w-36 px-3 py-2.5 text-[13px] whitespace-normal">
                {result
                  ? <CheckStatus check={result} signIn={agentOf(connection) ? { available: !!agentOf(connection)!.signIn, onClick: () => void signIn(connection) } : undefined} />
                  : <span className="grid gap-0.5"><span className={cn('font-medium', status === 'missing' && 'text-inspect')}>{t(`connections.status.${status}`)}</span><span className="text-xs text-muted-foreground">{t('connections.status.notChecked')}</span></span>}
              </TableCell>
              <TableCell className="px-3 py-2.5 text-right whitespace-nowrap"><span className="inline-flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7" disabled={result?.state === 'running'} aria-label={t('connections.checkAria', { name: connection.name })} onClick={() => void check(connection)}><Zap aria-hidden="true" />{t('connections.check')}</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('connections.moreAria', { name: connection.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(connection)}><Pencil aria-hidden="true" />{t('connections.edit')}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={props.busy} onSelect={() => setDeleting(connection)}><Trash2 aria-hidden="true" />{t('connections.delete')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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

/** One role a connection plays, as a count ("계획 5개"); opening it lists the profiles (or project settings) that use it. */
function UsePopover({ use, navigate }: { use: Use; navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const label = t('connections.useCount', { role: t(`connections.roles.${use.role}`), count: use.names.length });
  return <Popover>
    <PopoverTrigger asChild><button type="button" className="rounded-md border border-edge px-2 py-0.5 text-[13px] whitespace-nowrap hover:bg-raised">{label}</button></PopoverTrigger>
    <PopoverContent align="start" className="w-72 p-2">
      <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="grid max-h-64 overflow-y-auto text-[13px]">{use.names.map((name, index) => <li key={index}>
        <Link to={name.to} navigate={navigate} className="block rounded-sm px-1 py-1 hover:bg-raised hover:underline">{name.label}</Link>
      </li>)}</ul>
    </PopoverContent>
  </Popover>;
}
