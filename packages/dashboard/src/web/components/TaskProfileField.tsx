import { useTranslation } from 'react-i18next';
import type { ProjectConfig } from '@rawstep/project/config';
import { Choice } from './forms';

type Props = {
  profiles: ProjectConfig['profiles'];
  /** The task's own profile id; the project's first profile when unset or no longer there. */
  value: string | undefined; onChange: (profileId: string) => void;
};

/** The run profile a task uses unless one is picked for a run: a labelled list of the project's profiles. */
export function TaskProfileField({ profiles, value, onChange }: Props) {
  const { t } = useTranslation();
  const current = profiles.find(profile => profile.id === value) ?? profiles[0];
  return <Choice label={t('taskProfile.label')} info={t('help.conditions')} value={current?.id ?? ''} onChange={onChange} options={profiles.map(({ id, name }) => ({ id, name }))} />;
}
