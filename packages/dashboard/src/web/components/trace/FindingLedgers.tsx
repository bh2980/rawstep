import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HintFinding } from '../../../shared/api';
import type { RouteChange } from '../../hooks/useRoute';
import { hintKindLabel } from '../../i18n/labels';
import { describeFinding, evidenceRefs, splitEvidence } from '../../lib/findings';
import { cn } from '../../lib/utils';
import { ElementIdentity } from './ElementIdentity';
import { EvidenceLink } from './EvidenceLink';
import { SourceMarker } from './SourceMarker';

type Props = {
  findings: HintFinding[]; taskId: string;
  /** "Run #n" of every run of the task, by run id. */
  numbers: ReadonlyMap<string, number>;
  navigate: (change: RouteChange) => void;
};

/** Up to three places to open, then `+n` that shows the rest. */
function Evidence({ finding, taskId, numbers, navigate }: { finding: HintFinding } & Omit<Props, 'findings'>) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const { shown, hidden } = splitEvidence(evidenceRefs(finding, numbers));
  const list = all ? [...shown, ...hidden] : shown;
  return <ul className="grid content-start gap-0.5 md:justify-items-end">
    {list.map(ref => <li key={`${ref.runId}:${ref.step ?? ''}`}><EvidenceLink taskId={taskId} runId={ref.runId} number={ref.number} step={ref.step} navigate={navigate} /></li>)}
    {hidden.length > 0 && <li>
      <button type="button" aria-expanded={all} aria-label={all ? t('trace.evidenceFewer') : t('trace.evidenceMoreLabel', { count: hidden.length })} onClick={() => setAll(!all)}
        className="rounded-sm text-[13px] tabular-nums text-muted-foreground underline-offset-2 hover:underline">{all ? t('trace.evidenceFewer') : t('trace.evidenceMore', { count: hidden.length })}</button>
    </li>}
  </ul>;
}

/** Element · what happened · where to look: shared by both ledgers so their columns line up. */
const LEDGER_COLUMNS = 'md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_auto]';
const isSuspected = (finding: HintFinding) => finding.occurrences.every(occurrence => occurrence.certainty === 'suspected');

/**
 * Element evidence ledger: one record per page element, separated by rules and carried by a solid left rail.
 * Each row has the element identity, one neutral sentence, how many runs show it and links down to the runs.
 */
export function PageEvidenceLedger({ findings, taskId, numbers, navigate }: Props) {
  const { t } = useTranslation();
  return <ul className="divide-y rounded-md border border-l-4 border-edge-strong border-l-foreground bg-card">
    {findings.map((finding, index) => <li key={index} className={cn('grid gap-x-8 gap-y-2 py-3.5 pr-4 pl-5', LEDGER_COLUMNS)}>
      <ElementIdentity role={finding.target?.role} name={finding.target?.name} fallback={hintKindLabel(finding.kind)} className="text-base" />
      <div className="grid content-start gap-1">
        <p className="text-sm leading-6">{describeFinding(finding) ?? hintKindLabel(finding.kind)}</p>
        <p className="flex flex-wrap items-center gap-x-3 text-[13px]">
          <span className="font-semibold tabular-nums">{t('taskPage.frequency', { total: finding.totalRuns, runs: finding.runs })}</span>
          {isSuspected(finding) && <span className="rounded-sm border border-edge-strong px-1.5 text-xs">{t('taskPage.suspected')}</span>}
        </p>
      </div>
      <Evidence finding={finding} taskId={taskId} numbers={numbers} navigate={navigate} />
    </li>)}
  </ul>;
}

/**
 * What the model did while deciding. Same columns as the page ledger so the two read side by side, but lighter: no card and no
 * solid rail, an open marker before the element, and "추정" written out. It never reads as a defect of the page.
 */
export function ModelBehaviorList({ findings, taskId, numbers, navigate }: Props) {
  const { t } = useTranslation();
  return <ul className="divide-y divide-edge border-y border-edge">
    {findings.map((finding, index) => <li key={index} className={cn('grid gap-x-8 gap-y-2 py-3.5 pr-4 pl-5', LEDGER_COLUMNS)}>
      <div className="flex items-start gap-2.5">
        <SourceMarker source="model" className="mt-1" />
        <ElementIdentity role={finding.target?.role} name={finding.target?.name} fallback={hintKindLabel(finding.kind)} weight="regular" />
      </div>
      <div className="grid content-start gap-1">
        <p className="text-sm leading-6">{describeFinding(finding) ?? hintKindLabel(finding.kind)}</p>
        <p className="flex flex-wrap items-center gap-x-3 text-[13px]">
          <span className="tabular-nums">{t('taskPage.frequency', { total: finding.totalRuns, runs: finding.runs })}</span>
          {isSuspected(finding) && <span className="text-xs font-medium text-model">{t('taskPage.suspected')}</span>}
        </p>
      </div>
      <Evidence finding={finding} taskId={taskId} numbers={numbers} navigate={navigate} />
    </li>)}
  </ul>;
}
