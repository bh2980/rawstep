import { useTranslation } from 'react-i18next';
import type { VerifyRule } from '@rawstep/core/contracts';
import type { ConfigView } from '../../shared/config';
import { CheckEditor } from './CheckEditor';
import { CheckSuggestions } from './CheckSuggestions';
import { SectionHead } from './layout/PageHeader';

type Props = { rules: VerifyRule[]; onRules: (rules: VerifyRule[]) => void; url: string; goal: string; view: ConfigView };

/** The "완료 확인" tab: the checks and their editor, with AI suggestions requested from the block under them. */
export function TaskChecks({ rules, onRules, url, goal, view }: Props) {
  const { t } = useTranslation();
  return <section aria-labelledby="task-checks" className="grid max-w-3xl min-w-0 gap-3">
    <SectionHead id="task-checks" title={t('taskPage.checksTitle')} info={t('help.check')} />
    <CheckEditor rules={rules} onChange={onRules} url={url} keepOne />
    <CheckSuggestions view={view} url={url} goal={goal} onAdd={rule => onRules([...rules, rule])} />
  </section>;
}
