import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VerifyRule } from '@rawstep/core/contracts';
import type { ConfigView } from '../../shared/config';
import { CheckEditor } from './CheckEditor';
import { CheckSuggestions } from './CheckSuggestions';
import { Button } from './ui/button';

type Props = { rules: VerifyRule[]; onRules: (rules: VerifyRule[]) => void; url: string; goal: string; view: ConfigView };

/** The "완료 확인" tab: the goal boundary and its editor; AI suggestions open below only when asked for with their button. */
export function TaskChecks({ rules, onRules, url, goal, view }: Props) {
  const { t } = useTranslation();
  const [suggesting, setSuggesting] = useState(false);
  return <div className="grid max-w-3xl gap-8">
    <section aria-labelledby="task-checks" className="grid min-w-0 gap-4">
      <div className="grid gap-1">
        <h2 id="task-checks" className="text-base font-semibold">{t('taskPage.checksTitle')}</h2>
        <p className="max-w-2xl text-[13px] leading-5 text-muted-foreground">{t('taskPage.checksNote')}</p>
      </div>
      <CheckEditor rules={rules} onChange={onRules} url={url} keepOne />
    </section>
    <section className="grid gap-3 border-t border-edge-strong pt-4">
      {suggesting
        ? <CheckSuggestions view={view} url={url} goal={goal} autoStart onAdd={rule => onRules([...rules, rule])} />
        : <div className="grid justify-items-start gap-1.5">
          <Button type="button" variant="outline" onClick={() => setSuggesting(true)}><Sparkles aria-hidden="true" />{t('checkSuggest.open')}</Button>
          <p className="text-xs leading-5 text-muted-foreground">{t('checkSuggest.openNote')}</p>
        </div>}
    </section>
  </div>;
}
