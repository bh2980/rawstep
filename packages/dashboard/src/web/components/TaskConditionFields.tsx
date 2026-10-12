import { useTranslation } from 'react-i18next';
import { sharedItems, taskConditions, type ProjectConfig } from '@rawstep/project/config';
import { CONDITION_KINDS, FIELD, LIST, selectable, type TaskConditionIds } from '../lib/taskConditions';
import { Choice } from './forms';

type Props = {
  config: ProjectConfig;
  /** The task's id when it exists, so its own copies can be picked; a new task picks shared items only. */
  taskId?: string | undefined;
  value: TaskConditionIds; onChange: (value: TaskConditionIds) => void;
};

const INHERIT = '__inherit__';
const NONE = '__none__';

/**
 * A task's default conditions as plain choices: the run preset, then each of the four conditions. A condition left on "따름" uses
 * the preset's item, otherwise the first shared one; the option says which that is. Run rules are changed in 세부 설정.
 */
export function TaskConditionFields({ config, taskId, value, onChange }: Props) {
  const { t } = useTranslation();
  const resolved = taskConditions(config, value);
  const inheritedFrom = taskConditions(config, { ...(value.presetId ? { presetId: value.presetId } : {}) });
  const set = (key: keyof TaskConditionIds, id: string | undefined) => {
    const { [key]: _old, ...rest } = value;
    onChange(id ? { ...rest, [key]: id } : rest);
  };
  return <div className="grid gap-4 sm:grid-cols-2">
    <div className="grid content-start gap-1.5 sm:col-span-2">
      <Choice label={t('runConditions.preset')} value={value.presetId ?? NONE}
        options={[{ id: NONE, name: t('taskConditions.noPreset') }, ...config.presets.map(({ id, name }) => ({ id, name }))]}
        onChange={id => set('presetId', id === NONE ? undefined : id)} />
      <p className="text-xs leading-5 text-muted-foreground">{t('taskConditions.presetHint')}</p>
    </div>
    {CONDITION_KINDS.map(kind => {
      const list = (config[LIST[kind]] as readonly { id: string; name: string; owner?: string | undefined }[]);
      const items = taskId ? selectable(list, taskId) : sharedItems(list);
      const own = value[FIELD[kind]];
      return <Choice key={kind} label={t(`runConditions.${kind}`)} value={own && items.some(item => item.id === own) ? own : INHERIT}
        options={[{ id: INHERIT, name: t(value.presetId ? 'taskConditions.followPreset' : 'taskConditions.followDefault', { name: inheritedFrom[kind].name }) },
          ...items.map(item => ({ id: item.id, name: item.owner ? t('taskConditions.ownItem', { name: item.name }) : item.name }))]}
        onChange={id => set(FIELD[kind], id === INHERIT ? undefined : id)} />;
    })}
    <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">{t('taskConditions.resolved', { combo: resolved.combo.name, actionSet: resolved.actionSet.name, pageEnvironment: resolved.pageEnvironment.name, atEnvironment: resolved.atEnvironment.name })}</p>
  </div>;
}
