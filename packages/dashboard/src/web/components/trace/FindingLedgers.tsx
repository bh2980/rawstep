import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { HintFinding } from '../../../shared/api';
import type { RouteChange } from '../../hooks/useRoute';
import { hintKindLabel, targetLabel } from '../../i18n/labels';
import { describeFinding, evidenceRefs, splitEvidence } from '../../lib/findings';
import { Dash } from '../PageHeader';
import { Link } from '../Link';

type Props = {
  findings: HintFinding[]; taskId: string;
  /** "Run #n" of every run of the task, by run id. */
  numbers: ReadonlyMap<string, number>;
  navigate: (change: RouteChange) => void;
  /** The table's name for a screen reader. */
  label: string;
};

/** A run, or a run opened at an action, as a short link: `#1 · 행동 9`, or `#1`. It is read as `실행 #1, 행동 9`. */
export function StepLink({ taskId, runId, number, step, navigate, children }: { taskId: string; runId: string; number: number | undefined; step?: number | undefined; navigate: (change: RouteChange) => void; children?: ReactNode }) {
  const { t } = useTranslation();
  const n = number ?? '?';
  const text = step === undefined ? t('taskPage.evidence.run', { number: n }) : t('taskPage.evidence.step', { number: n, step });
  const spoken = step === undefined ? t('trace.evidenceRunOnly', { number: n }) : t('trace.evidenceRun', { number: n, step });
  return <Link to={{ task: taskId, run: runId, ...(step !== undefined ? { step } : {}) }} navigate={navigate} aria-label={children ? undefined : spoken}
    className="rounded-sm whitespace-nowrap tabular-nums underline decoration-edge-strong underline-offset-4 hover:decoration-foreground">{children ?? text}</Link>;
}

/** Up to three places to open (`#1 · 행동 9`), then `+n` that shows the rest. */
function Evidence({ finding, taskId, numbers, navigate }: { finding: HintFinding } & Omit<Props, 'findings' | 'label'>) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const { shown, hidden } = splitEvidence(evidenceRefs(finding, numbers));
  const list = all ? [...shown, ...hidden] : shown;
  return <ul className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
    {list.map(ref => <li key={`${ref.runId}:${ref.step ?? ''}`}><StepLink taskId={taskId} runId={ref.runId} number={ref.number} step={ref.step} navigate={navigate} /></li>)}
    {hidden.length > 0 && <li>
      <button type="button" aria-expanded={all} aria-label={all ? t('trace.evidenceFewer') : t('trace.evidenceMoreLabel', { count: hidden.length })} onClick={() => setAll(!all)}
        className="rounded-sm tabular-nums text-ink-2 underline-offset-4 hover:underline">{all ? t('trace.evidenceFewer') : t('trace.evidenceMore', { count: hidden.length })}</button>
    </li>}
  </ul>;
}

const isSuspected = (finding: HintFinding) => finding.occurrences.every(occurrence => occurrence.certainty === 'suspected');
const head = 'h-8 px-3 text-left align-middle text-xs font-normal text-ink-2';

/**
 * Observed phenomena: one row per kind and page element, gathered over the runs. Phenomenon · where · what was seen · in how many
 * runs · the runs and actions to open. A suspected one says "추정" after its name. Facts only: nothing here says the page is wrong.
 */
export function FindingTable({ findings, taskId, numbers, navigate, label }: Props) {
  const { t } = useTranslation();
  return <div className="-mx-3 overflow-x-auto">
    <table aria-label={label} className="w-full min-w-[52rem] table-fixed border-collapse">
      <colgroup><col className="w-40" /><col className="w-52" /><col /><col className="w-28" /><col className="w-56" /></colgroup>
      <thead><tr className="border-b border-edge">
        <th scope="col" className={head}>{t('taskPage.evidence.kind')}</th>
        <th scope="col" className={head}>{t('taskPage.evidence.where')}</th>
        <th scope="col" className={head}>{t('taskPage.evidence.seen')}</th>
        <th scope="col" className={head}>{t('taskPage.evidence.runs')}</th>
        <th scope="col" className={head}>{t('taskPage.evidence.proof')}</th>
      </tr></thead>
      <tbody>{findings.map((finding, index) => <tr key={index} className="border-b border-edge align-top">
        <th scope="row" className="px-3 py-2.5 text-left font-normal">
          <span className="font-medium">{hintKindLabel(finding.kind)}</span>
          {isSuspected(finding) && <span className="ml-1.5 text-ink-3">{t('taskPage.suspected')}</span>}
        </th>
        <td className="px-3 py-2.5 break-words">{finding.target ? targetLabel(finding.target) : <Dash />}</td>
        <td className="px-3 py-2.5">{describeFinding(finding) ?? <Dash />}</td>
        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{t('taskPage.frequency', { total: finding.totalRuns, runs: finding.runs, count: finding.totalRuns })}</td>
        <td className="px-3 py-2.5"><Evidence finding={finding} taskId={taskId} numbers={numbers} navigate={navigate} /></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
