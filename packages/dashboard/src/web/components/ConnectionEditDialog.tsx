import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { credentialId, modelKeyEnv, providerPreset, type Connection } from '@rawstep/project/config';
import { api } from '../api';
import { ENV_NAME, generateEnvName, providerTextKey } from '../lib/connections';
import { useGuardedAct } from '../lib/useGuardedAct';
import type { PageProps } from '../pages/types';
import { Field, Panel, ReadonlyField, SecretField } from './forms';
import { ErrorState } from './layout/ErrorState';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

/** Edit a connection: name, address and key up front; the request timeout and key variable in "advanced". Kind and provider are fixed. */
export function ConnectionEditDialog({ connection, onClose, pageProps }: { connection?: Connection; onClose: () => void; pageProps: PageProps }) {
  return <Dialog open={!!connection} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{connection && <EditFlow key={connection.id} initial={connection} pageProps={pageProps} close={onClose} />}</DialogContent>
  </Dialog>;
}

function EditFlow({ initial, pageProps: props, close }: { initial: Connection; pageProps: PageProps; close: () => void }) {
  const { t } = useTranslation();
  const { error, run } = useGuardedAct(props.act);
  const [connection, setConnection] = useState<Connection>(() => structuredClone(initial));
  const [revision] = useState(props.view.revision);
  const [apiKey, setApiKey] = useState('');
  const patch = (part: Partial<Connection>) => setConnection({ ...connection, ...part });
  const custom = connection.provider === 'custom', preset = providerPreset(connection), key = apiKey.trim();
  const envInvalid = custom && !!connection.apiKeyEnv && !ENV_NAME.test(connection.apiKeyEnv);
  const valid = !!connection.name.trim() && !envInvalid && (!custom || !!connection.baseURL?.trim());
  const keySet = !!props.view.credentialStatus[credentialId(connection)] && !!modelKeyEnv(connection);

  async function save() {
    const next: Connection = { ...connection, name: connection.name.trim(), ...(custom ? { baseURL: connection.baseURL!.trim() } : {}) };
    if (custom && key && !next.apiKeyEnv) next.apiKeyEnv = generateEnvName(props.view.config.connections, next.id);
    const ok = await run(async () => {
      await props.save({ ...props.view.config, connections: props.view.config.connections.map(c => c.id === next.id ? next : c) }, undefined, revision);
      if (key) await api('/credentials', { method: 'POST', body: custom ? { connectionId: next.id, value: key } : { provider: next.provider, value: key } });
    });
    if (ok) close();
  }

  const providerName = t(`connections.providers.${providerTextKey(connection.kind, connection.provider)}.name`);
  const keyHint = [keySet ? t('connections.keySavedHint') : t('connections.keyEmptyHint'), !custom ? t('connections.keySharedHint', { provider: providerName }) : undefined].filter(Boolean).join(' ');
  const reveal = async () => (await api<{ value: string | null }>('/credentials/reveal', { method: 'POST', body: custom ? { connectionId: connection.id } : { provider: connection.provider } })).value ?? undefined;
  return <>
    <DialogHeader>
      <DialogTitle>{t('connections.editTitle')}</DialogTitle>
      <DialogDescription>{t('connections.editDescription')}</DialogDescription>
    </DialogHeader>
    {error && <ErrorState alert view={error} />}
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">{t('connections.typeLine', { kind: t(`connections.kinds.${connection.kind}.name`), provider: providerName })}</p>
      <Field label={t('connections.name')} value={connection.name} onChange={name => patch({ name })} />
      {custom
        ? <Field label={t('connections.baseUrl')} value={connection.baseURL ?? ''} onChange={baseURL => patch({ baseURL })} />
        : <ReadonlyField label={t('connections.baseUrl')} value={preset.baseURL ?? t('connections.endpointManaged')} hint={t('connections.endpointPresetHint', { provider: providerName })} />}
      <SecretField label={t('connections.apiKey')} value={apiKey} onChange={setApiKey} saved={keySet} onReveal={reveal} hint={keyHint} />
    </div>
    <Panel title={t('connections.advanced')} description={t('connections.advancedDescription')}>
      <Field label={t('connections.timeout')} type="number" value={String(connection.timeoutMs)} onChange={s => patch({ timeoutMs: Number(s) })} />
      {custom && <Field label={t('connections.envName')} value={connection.apiKeyEnv ?? ''} onChange={v => { const { apiKeyEnv: _removed, ...rest } = connection; setConnection(v ? { ...rest, apiKeyEnv: v } : rest); }} hint={envInvalid ? t('connections.envNameInvalid') : t('connections.envNameHint')} />}
    </Panel>
    <DialogFooter>
      <Button type="button" variant="outline" onClick={close}>{t('connections.cancel')}</Button>
      <Button type="button" disabled={props.busy || !valid} onClick={() => void save()}>{props.busy ? t('connections.working') : t('connections.save')}</Button>
    </DialogFooter>
  </>;
}
