import { useTranslation } from 'react-i18next';
import { OctagonAlert, ShieldAlert, Signpost, UserCheck } from 'lucide-react';
import type { RunNotice, StepView } from '../../shared/api';
import type { RunRecord } from '../../shared/config';
import { Button } from './ui/button';

type Props = { run: RunRecord; steps: StepView[]; notices: RunNotice[]; onSelect: (step: number) => void };

/**
 * Why a finished run ended where it did, before the timeline: who stopped it (the model's own stop choice, Rawstep's repetition
 * guard or a limit) and the setting that allowed it, plus what the page did that explains the run — a bot check page or navigations
 * the task's range blocked. Each line points at the step it is about.
 */
export function RunDiagnosis({ run, steps, notices, onSelect }: Props) {
  const { t } = useTranslation();
  const stopped = [...steps].reverse().find(step => step.stop);
  const reason = run.outcome?.reason;
  const lines: { key: string; icon: typeof OctagonAlert; text: string; note?: string; step?: number }[] = [];
  if (stopped?.stop?.source === 'model' && stopped.stop.stop !== 'success') {
    const giveUp = run.snapshot.globals.policy.modelGiveUp;
    lines.push({ key: 'stop', icon: OctagonAlert, step: stopped.step,
      text: t('diagnosis.modelStop', { n: stopped.step, reason: t(`steps.stopReasons.${stopped.stop.stop}`, { defaultValue: stopped.stop.stop }) }),
      note: giveUp ? t('diagnosis.modelStopAllowed') : undefined });
  } else if (stopped?.stop?.stop === 'success' && reason === 'verification-failed') {
    lines.push({ key: 'stop', icon: OctagonAlert, step: stopped.step, text: t('diagnosis.successStopFailed', { n: stopped.step }), note: t('diagnosis.successStopFailedNote') });
  } else if (stopped?.stop?.source === 'exploration-guard') {
    lines.push({ key: 'stop', icon: OctagonAlert, step: stopped.step, text: t('diagnosis.guardStop', { n: stopped.step }), note: t('diagnosis.guardStopNote') });
  } else if (reason === 'maxSteps' || reason === 'timeout') {
    lines.push({ key: 'stop', icon: OctagonAlert, text: t(`diagnosis.${reason}`) });
  }
  const personPassed = notices.some(notice => notice.kind === 'person-check');
  for (const notice of notices) lines.push({
    key: notice.kind, icon: notice.kind === 'bot-check' ? ShieldAlert : notice.kind === 'person-check' ? UserCheck : Signpost, step: notice.step,
    text: t(`diagnosis.${notice.kind}`, { hosts: notice.hosts.join(', '), count: notice.count, seconds: notice.kind === 'person-check' ? Math.round(notice.waitedMs / 1000) : 0 }),
    note: notice.kind === 'bot-check' && personPassed ? t('diagnosis.bot-checkPassedNote') : t(`diagnosis.${notice.kind}Note`, { setting: t('machine.personCheck') }),
  });
  if (!lines.length) return null;
  return <section aria-labelledby="run-diagnosis" className="grid gap-1.5">
    <h2 id="run-diagnosis" className="border-b border-edge-strong pb-1.5 text-base font-semibold">{t('diagnosis.title')}</h2>
    <ul className="grid divide-y divide-edge">
      {lines.map(line => <li key={line.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 py-2.5 pl-1">
        <line.icon aria-hidden="true" className="mt-0.5 size-4 text-inspect" />
        <div className="grid gap-0.5">
          <p className="text-sm leading-6 font-medium">{line.text}</p>
          {line.note && <p className="text-[13px] leading-5 text-muted-foreground">{line.note}</p>}
        </div>
        {line.step !== undefined && <Button type="button" variant="link" className="h-auto p-0 text-[13px]" onClick={() => onSelect(line.step!)}>{t('diagnosis.openStep', { n: line.step })}</Button>}
      </li>)}
    </ul>
  </section>;
}
