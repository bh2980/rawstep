import { useTranslation } from 'react-i18next';
import { defaultInputs, type Connection, type ModelChoice, type RunProfile } from '@rawstep/project/config';
import type { RouteChange } from '../hooks/useRoute';
import { Field, Panel, Toggle } from './forms';
import { EmptyState } from './layout/EmptyState';
import { Link } from './Link';
import { ModelPicker } from './ModelPicker';

type Props = { profile: RunProfile; update: (part: Partial<RunProfile>) => void; connections: readonly Connection[]; navigate: (change: RouteChange) => void };

/**
 * The profile's "모델" tab: the model runs decide with (a model ID on a connection) and what it can take. Keyboard runs send two
 * screenshots, so they need image input; screen reader runs send text.
 */
export function ProfileModelFields({ profile, update, connections, navigate }: Props) {
  const { t } = useTranslation();
  if (!connections.length) return <EmptyState compact title={t('profiles.model.noConnections')} why={t('profiles.model.noConnectionsWhy')}
    action={<Link to={{ view: 'connections' }} navigate={navigate} className="text-sm font-semibold text-trace underline underline-offset-4">{t('profiles.model.toConnections')}</Link>} />;
  const choice = profile.model;
  const set = (part: Partial<ModelChoice>) => update({ model: { ...(choice ?? blank(connections[0]!)), ...part } });
  const images = choice?.inputs.includes('image') ?? false;
  return <div className="grid gap-5">
    <p className="text-[13px] leading-5 text-muted-foreground">{t('profiles.model.intro')}</p>
    <ModelPicker label={t('profiles.model.title')} connections={connections} connectionId={choice?.connectionId} modelId={choice?.modelId ?? ''}
      onChange={next => {
        const connection = connections.find(c => c.id === next.connectionId)!;
        const switched = !choice || choice.connectionId !== next.connectionId;
        const inputs = next.picked?.inputsKnown ? next.picked.inputs : switched ? defaultInputs(connection) : choice!.inputs;
        update({ model: { ...(switched ? blank(connection) : choice!), connectionId: next.connectionId, modelId: next.modelId, inputs, ...(next.picked?.maxChoices ? { maxChoices: next.picked.maxChoices } : {}) } });
      }} />
    {choice && <>
      <Toggle label={t('profiles.model.images')} hint={t('profiles.model.imagesHint')} checked={images}
        onChange={on => set({ inputs: on ? ['text', 'image'] : ['text'], maxImages: on ? Math.max(2, choice.maxImages) : choice.maxImages })} />
      {!images && <p className="text-xs leading-5 text-inspect">{t('profiles.model.textOnly')}</p>}
      <Panel title={t('profiles.model.advanced')} description={t('profiles.model.advancedDescription')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('profiles.model.maxChoices')} type="number" value={String(choice.maxChoices)} onChange={s => set({ maxChoices: Number(s) })} hint={t('profiles.model.maxChoicesHint')} />
          <Field label={t('profiles.model.maxImages')} type="number" value={String(choice.maxImages)} onChange={s => set({ maxImages: Number(s) })} />
        </div>
      </Panel>
    </>}
  </div>;
}

const blank = (connection: Connection): ModelChoice => ({ connectionId: connection.id, modelId: '', inputs: defaultInputs(connection), maxChoices: 255, maxImages: 2 });
