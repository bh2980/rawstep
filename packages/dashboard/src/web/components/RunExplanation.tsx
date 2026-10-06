import { useTranslation } from 'react-i18next';
import type { RunExplanation as Explanation } from '../../shared/api';
import { Panel } from './forms';
import { Button } from './ui/button';

/**
 * What the run profile's LLM wrote about the run: a summary and hypotheses, each with the steps it cites so a person can check them.
 * Shown as hypotheses, below the evidence, closed by default; it never changes the run's result.
 */
export function RunExplanation({ explanation, model, onSelect }: { explanation: Explanation; model: string | undefined; onSelect: (step: number) => void }) {
  const { t } = useTranslation();
  return <Panel title={t('explanation.title')} description={[model, explanation.status === 'failed' ? t('explanation.failedShort') : t('explanation.count', { count: explanation.findings.length })].filter(Boolean).join(' · ')}>
        <p className="text-[13px] leading-5 text-muted-foreground">{t('explanation.note')}</p>
        {explanation.status === 'failed'
          ? <p className="text-sm leading-6">{t('explanation.failed')}</p>
          : <>
            {explanation.summary && <p className="text-sm leading-6">{explanation.summary}</p>}
            {explanation.findings.length > 0 && <ol className="grid divide-y divide-edge border-y border-edge">
              {explanation.findings.map((finding, index) => <li key={index} className="grid gap-1 py-2.5 pl-1">
                <p className="text-sm leading-6 font-medium"><span className="mr-2 text-xs font-normal text-model">{t(`explanation.severity.${finding.severity}`)}</span>{finding.title}</p>
                <p className="text-[13px] leading-5 text-muted-foreground">{finding.description}</p>
                {finding.steps.length > 0 && <p className="flex flex-wrap gap-x-3 text-[13px]">{finding.steps.map(step =>
                  <Button key={step} type="button" variant="link" className="h-auto p-0 text-[13px]" onClick={() => onSelect(step)}>{step === 0 ? t('explanation.startStep') : t('explanation.step', { n: step })}</Button>)}</p>}
              </li>)}
            </ol>}
          </>}
  </Panel>;
}
