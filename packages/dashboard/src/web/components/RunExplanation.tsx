import { useTranslation } from 'react-i18next';
import type { RunExplanation as Explanation } from '../../shared/api';
import { SectionHead } from './PageHeader';

/**
 * What the run profile's LLM wrote about the run: a summary and hypotheses, each labelled as one and with the moves it cites so a
 * person can check them. It sits below the evidence and never changes the run's result or its hints.
 */
export function RunExplanation({ explanation, model, onSelect }: { explanation: Explanation; model: string | undefined; onSelect: (step: number) => void }) {
  const { t } = useTranslation();
  return <section aria-labelledby="run-explanation" className="mt-6">
    <SectionHead id="run-explanation" title={t('explanation.title')} count={explanation.status === 'failed' ? undefined : explanation.findings.length}>
      {model && <span className="text-sm text-ink-2">{model}</span>}
    </SectionHead>
    <p className="mb-2 text-sm text-ink-2">{t('explanation.note')}</p>
    {explanation.status === 'failed'
      ? <p>{t('explanation.failed')}</p>
      : <>
        {explanation.summary && <p className="mb-2">{explanation.summary}</p>}
        {explanation.findings.length > 0 && <ol className="border-t border-edge">
          {explanation.findings.map((finding, index) => <li key={index} className="grid gap-0.5 border-b border-edge py-2">
            <p><span className="mr-2 text-sm text-ink-2">{t('runDetail.hypothesis')} · {t(`explanation.severity.${finding.severity}`)}</span><span className="font-medium">{finding.title}</span></p>
            <p className="text-ink-2">{finding.description}</p>
            {finding.steps.length > 0 && <p className="flex flex-wrap gap-x-3 text-sm">{finding.steps.map(step =>
              <button key={step} type="button" onClick={() => onSelect(step)} className="border-b border-edge-strong tabular-nums hover:border-foreground">
                {step === 0 ? t('explanation.startStep') : t('explanation.step', { n: step })}</button>)}</p>}
          </li>)}
        </ol>}
      </>}
  </section>;
}
