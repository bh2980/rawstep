import { useTranslation } from 'react-i18next';
import type { ProviderPreset } from '@rawstep/project/config';

/** What a coding-agent CLI connection takes instead of an address and a key: its own login, the command Rawstep starts, and what it cannot do. */
export function AgentNote({ preset }: { preset: ProviderPreset }) {
  const { t } = useTranslation();
  const agent = preset.agent;
  if (!agent) return null;
  return <div className="grid gap-1 text-[13px] leading-5 text-muted-foreground">
    <p>{t('connections.agentLogin')}</p>
    {agent.command === 'npx' && <p>{t('connections.agentNpx')}</p>}
    {!preset.images && <p className="text-inspect">{t('connections.agentNoImages')}</p>}
  </div>;
}
