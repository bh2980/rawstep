import { useTranslation } from 'react-i18next';
import type { Hint, RunNotice, RunPlanView, StepView } from '../../shared/api';
import type { RunRecord } from '../../shared/config';
import type { RunStatus } from '../lib/runStrip';
import { StatusShape } from './StatusMark';

type Props = {
  run: RunRecord; status: RunStatus; steps: StepView[]; notices: RunNotice[]; hints: Hint[];
  plan?: RunPlanView | undefined; onSelect: (step: number) => void;
};

type Line = { key: string; text: string; note?: string | undefined; step?: number | undefined };

/** The give-up's own record: the user's reason and the broken expectations it rests on. */
export function giveUpOf(hints: readonly Hint[]): { reason?: string; tried: string[] } | undefined {
  const detail = hints.find(hint => hint.kind === 'early-stop')?.detail.giveUp as { reason?: unknown; tried?: unknown } | undefined;
  if (!detail) return undefined;
  return { ...(typeof detail.reason === 'string' && detail.reason ? { reason: detail.reason } : {}), tried: Array.isArray(detail.tried) ? detail.tried.filter((id): id is string => typeof id === 'string') : [] };
}

/**
 * Why a finished run ended where it did, once, above the rail. Left: who stopped it — the user giving up (with their reason quoted), the
 * planner declaring success, Rawstep's repetition guard, a limit — and what the page did that explains the run (a bot check, blocked
 * navigations). Right: the expectations of the user that broke, each linked to the move where it broke.
 */
export function RunDiagnosis({ run, status, steps, notices, hints, plan, onSelect }: Props) {
  const { t } = useTranslation();
  const stopped = [...steps].reverse().find(step => step.stop);
  const reason = run.outcome?.reason, rules = run.snapshot.spec.settings.runRules, source = stopped?.stop?.source;
  const giveUp = source === 'user-gave-up' ? giveUpOf(hints) : undefined;
  const lines: Line[] = [];
  if (stopped && !giveUp) {
    const n = stopped.step;
    if (source === 'planner') lines.push({ key: 'stop', step: n, text: t('diagnosis.plannerStop', { n }), note: reason === 'verification-failed' ? t('diagnosis.plannerStopFailed') : t('diagnosis.plannerStopNote') });
    else if (source === 'orchestration-limit') lines.push({ key: 'stop', step: n, text: t('diagnosis.limitStop', { n, max: rules.maxPlannerCalls, count: plan ? plan.versions.length : rules.maxPlannerCalls }), note: t('diagnosis.limitStopNote') });
    else if (source === 'no-allowed-action') lines.push({ key: 'stop', step: n, text: t('diagnosis.noActionStop', { n }), note: t('diagnosis.noActionStopNote') });
    else if (source === 'user-gave-up') lines.push({ key: 'stop', step: n, text: t('diagnosis.gaveUpStop', { n }), note: t('runDetail.giveUpNote') });
    else if (stopped.stop?.stop === 'success' && reason === 'verification-failed') lines.push({ key: 'stop', step: n, text: t('diagnosis.successStopFailed', { n }), note: t('diagnosis.successStopFailedNote') });
    else if (source === 'exploration-guard') lines.push({ key: 'stop', step: n, text: t('diagnosis.guardStop', { n }), note: t('diagnosis.guardStopNote') });
  }
  if (!stopped && (reason === 'maxSteps' || reason === 'timeout')) lines.push({ key: 'stop', text: t(`diagnosis.${reason}`) });
  const personPassed = notices.some(notice => notice.kind === 'person-check');
  for (const notice of notices) lines.push({
    key: notice.kind, step: notice.step,
    text: t(`diagnosis.${notice.kind}`, { hosts: notice.hosts.join(', '), count: notice.count, seconds: notice.kind === 'person-check' ? Math.round(notice.waitedMs / 1000) : 0 }),
    note: notice.kind === 'bot-check' && personPassed ? t('diagnosis.bot-checkPassedNote') : t(`diagnosis.${notice.kind}Note`, { setting: t('taskBrowser.personCheckName') }),
  });
  const broken = hints.filter(hint => hint.kind === 'expectation-broken');
  // Every expectation any plan version made, so the count says why the numbers skip (only the broken ones are listed).
  const made = plan ? new Set(Object.values(plan.documents).flatMap(doc => doc.assumptions.map(item => item.id))).size : 0;
  if (!giveUp && !lines.length && !broken.length) return null;
  const assumptions = plan?.document.assumptions ?? [];
  const stepLink = (n: number) => <button type="button" onClick={() => onSelect(n)} className="border-b border-edge-strong tabular-nums hover:border-foreground">{t('runDetail.atStep', { n })}</button>;

  return <section aria-label={t('diagnosis.title')} className="mb-6 grid gap-x-8 gap-y-6 border-b border-edge pb-6 lg:grid-cols-2">
    <div className="grid content-start gap-4">
      {giveUp && <div>
        <h2 className="mb-2 flex items-center gap-2 text-md font-semibold"><StatusShape status={status} />
          {stopped ? t('runDetail.gaveUpAt', { n: stopped.step }) : t('runDetail.gaveUp')}</h2>
        {giveUp.reason && <blockquote className="border-l-2 border-edge-strong py-0.5 pl-3">{giveUp.reason}</blockquote>}
        <p className="mt-2 text-sm text-ink-2">{t('runDetail.giveUpNote')}</p>
      </div>}
      {lines.map((line, index) => <div key={line.key}>
        {index === 0 && !giveUp
          ? <h2 className="mb-1 flex items-start gap-2 text-md font-semibold"><StatusShape status={status} className="mt-1.5" /><span>{line.text}</span></h2>
          : <p>{line.text}</p>}
        {line.note && <p className="text-sm text-ink-2">{line.note}</p>}
        {line.step !== undefined && <p className="mt-1 text-sm">{stepLink(line.step)}</p>}
      </div>)}
    </div>
    {broken.length > 0 && <div className="min-w-0">
      <h2 className="mb-2 flex items-center gap-2 text-md font-semibold">{t('runDetail.broken')}<span className="font-normal text-ink-2 tabular-nums">{made > 0 ? t('runDetail.brokenOf', { broken: broken.length, total: made }) : broken.length}</span></h2>
      <table className="-mx-3 w-[calc(100%+1.5rem)] table-fixed text-base">
        <colgroup><col className="w-12" /><col /><col className="w-24" /></colgroup>
        <thead><tr className="border-b border-edge">
          <th scope="col" className="h-8 px-3 text-left text-xs font-medium text-ink-2">{t('runDetail.colExpectation')}</th>
          <th scope="col" className="h-8 px-3 text-left text-xs font-medium text-ink-2">{t('runDetail.colExpected')}</th>
          <th scope="col" className="h-8 px-3 text-right text-xs font-medium text-ink-2">{t('runDetail.colWhere')}</th>
        </tr></thead>
        <tbody>{broken.map((hint, index) => {
          const a = hint.detail.assumption as { id?: string; text?: string } | undefined;
          const text = a?.text ?? assumptions.find(item => item.id === a?.id)?.text, at = hint.steps[0];
          return <tr key={index} className="h-8 border-b border-edge align-top">
            <td className="px-3 py-1.5 tabular-nums">{a?.id ?? '—'}</td>
            <td className="px-3 py-1.5">{text ?? <span className="text-ink-3">—</span>}</td>
            <td className="px-3 py-1.5 text-right">{at !== undefined ? stepLink(at) : <span className="text-ink-3">—</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
  </section>;
}
