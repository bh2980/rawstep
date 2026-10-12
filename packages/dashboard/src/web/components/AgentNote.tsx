import { useTranslation } from 'react-i18next';
import type { ProviderPreset } from '@rawstep/project/config';

/** What a coding-agent CLI connection takes instead of an address and a key: its own login, the command Rawstep starts, and what it cannot do. */
export function AgentNote({ preset }: { preset: ProviderPreset }) {
  const { t } = useTranslation();
  const agent = preset.agent;
  if (!agent) return null;
  return <div className="grid gap-1.5 border-l-4 border-edge-strong bg-surface py-3 pl-4 text-xs leading-5 text-muted-foreground">
    <p>{t('connections.agentLogin', { command: [agent.command, ...agent.args].join(' ') })}</p>
    {agent.command === 'npx' && <p>{t('connections.agentNpx')}</p>}
    {!preset.images && <p className="text-inspect">{t('connections.agentNoImages')}</p>}
  </div>;
}
