import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { agentOf, isFilePlanner, type Connection, type Profile, type ProjectConfig, type ProjectSettings } from '@rawstep/project/config';
import type { ModelCheck } from '../../../shared/api';
import type { RouteChange } from '../../hooks/useRoute';
import { ApiError, api } from '../../api';
import { ConnectionEditDialog } from '../../components/ConnectionEditDialog';
import { ConnectionSetupDialog } from '../../components/ConnectionSetupDialog';
import { CheckStatus, type CheckState } from '../../components/CheckStatus';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { EmptyState } from '../../components/layout/EmptyState';
import { SectionHead } from '../../components/PageHeader';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { keyStatus, kindLabelKey } from '../../lib/connections';
import { cn } from '../../lib/utils';
import type { PageProps } from '../types';

type Role = 'planner' | 'analysis' | 'suggestions';
const ROLES: readonly Role[] = ['planner', 'analysis', 'suggestions'];
type Use = { role: Role; names: { label: string; to: RouteChange }[] };

/** What uses a connection, by role: run profiles that plan with it, and the project's analysis and suggestion models. */
function usesOf(config: ProjectConfig, id: string, projectLabel: string): Use[] {
  const profile = (p: Profile) => ({ label: p.name, to: { view: 'profiles' } as RouteChange });
  const project = { label: projectLabel, to: { view: 'settings', section: 'connections' } as RouteChange };
  const by: Record<Role, { label: string; to: RouteChange }[]> = {
    planner: config.profiles.filter(p => !isFilePlanner(p.planner) && p.planner?.connectionId === id).map(profile),
    analysis: config.project.analysis.model?.connectionId === id ? [project] : [],
    suggestions: config.project.suggestions.model?.connectionId === id ? [project] : [],
  };
  return ROLES.filter(role => by[role].length).map(role => ({ role, names: by[role] }));
}
/** A profile without the planner a removed connection played: it cannot run until another is picked. */
function withoutConnection(profile: Profile, id: string): Profile {
  const { planner, ...rest } = profile;
  return planner && (isFilePlanner(planner) || planner.connectionId !== id) ? { ...rest, planner } : rest;
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
 * project's analysis and suggestion settings) picks the model ID on one. 인증 is what is known without asking until a person picks 연결 확인 in ⋯, which asks the provider once.
 */
export function ConnectionSettings(props: PageProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Connection>();
  const [deleting, setDeleting] = useState<Connection>();
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const { config, credentialStatus } = props.view;
  // Profiles that used the connection lose that role (a profile without a planner cannot run until another is picked);
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
  return <section aria-labelledby="settings-connections" className="grid min-w-0">
    <SectionHead id="settings-connections" title={t('connections.heading')} count={config.connections.length}>
      {config.connections.length > 0 && <Button variant="outline" onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('connections.add')}</Button>}
    </SectionHead>
    {config.connections.length === 0
      ? <EmptyState title={t('empty.connections.title')} why={t('empty.connections.why')} action={<Button onClick={() => setAdding(true)}><Plus aria-hidden="true" />{t('empty.connections.action')}</Button>} />
      : <div className="overflow-x-auto">
        <Table className="min-w-[44rem] table-fixed">
          <TableCaption className="sr-only">{t('connections.listLabel')}</TableCaption>
          <colgroup><col /><col className="w-52" /><col className="w-32" /><col className="w-48" /><col className="w-14" /></colgroup>
          <TableHeader><TableRow>
            <TableHead scope="col">{t('connections.columns.name')}</TableHead>
            <TableHead scope="col">{t('connections.columns.kind')}</TableHead>
            <TableHead scope="col" className="text-right">{t('connections.columns.timeout')}</TableHead>
            <TableHead scope="col">{t('connections.columns.auth')}</TableHead>
            <TableHead scope="col"><span className="sr-only">{t('connections.columns.actions')}</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{config.connections.map(connection => {
            const status = keyStatus(connection, credentialStatus), result = checks[connection.id], agent = agentOf(connection);
            return <TableRow key={connection.id}>
              <TableCell className="truncate font-medium" title={connection.baseURL ?? agent?.command}>{connection.name}</TableCell>
              <TableCell className="truncate text-ink-2">{t('connections.typeLine', { kind: t(`connections.kinds.${kindLabelKey(connection)}.name`), provider: t(`connections.providers.${connection.provider}.name`) })}</TableCell>
              <TableCell className="text-right tabular-nums">{t('connections.seconds', { n: Math.round(connection.timeoutMs / 100) / 10 })}</TableCell>
              <TableCell className="whitespace-normal">
                {result
                  ? <CheckStatus check={result} signIn={agent ? { available: !!agent.signIn, onClick: () => void signIn(connection) } : undefined} />
                  : <span className={cn(status === 'missing' ? 'text-inspect' : 'text-ink-2')}>{agent ? t('connections.status.cli') : t(`connections.status.${status}`)}</span>}
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('connections.moreAria', { name: connection.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={result?.state === 'running'} onSelect={() => void check(connection)}><Zap aria-hidden="true" />{t('connections.checkMenu')}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setEditing(connection)}><Pencil aria-hidden="true" />{t('connections.edit')}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={props.busy} onSelect={() => setDeleting(connection)}><Trash2 aria-hidden="true" />{t('connections.delete')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </div>}
    <ConnectionSetupDialog open={adding} onOpenChange={setAdding} pageProps={props} onAdded={(id, result) => setChecks(current => ({ ...current, [id]: result }))} />
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
  </section>;
}
