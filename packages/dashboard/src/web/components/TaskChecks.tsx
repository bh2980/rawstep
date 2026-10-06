import { useTranslation } from 'react-i18next';
import type { VerifyRule } from '@rawstep/core/contracts';
import type { ConfigView } from '../../shared/config';
import { CheckEditor } from './CheckEditor';
import { CheckSuggestions } from './CheckSuggestions';

type Props = { rules: VerifyRule[]; onRules: (rules: VerifyRule[]) => void; url: string; goal: string; view: ConfigView };

/** The "완료 확인" tab: the task's checks as cards with the builder, and the AI suggestions next to them. */
export function TaskChecks({ rules, onRules, url, goal, view }: Props) {
  const { t } = useTranslation();
  return <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
    <section aria-labelledby="task-checks" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="task-checks" className="text-base font-semibold">{t('taskPage.checksTitle')}</h2>
        <p className="text-[13px] leading-5 text-muted-foreground">{t('taskPage.checksNote')}</p>
      </div>
      <CheckEditor rules={rules} onChange={onRules} url={url} keepOne />
    </section>
    <CheckSuggestions view={view} url={url} goal={goal} onUse={rule => onRules([rule])} onAdd={rule => onRules([...rules, rule])} />
  </div>;
}
