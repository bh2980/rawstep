import { useTranslation } from 'react-i18next';
import type { HintFinding } from '../../shared/api';
import type { RouteChange } from '../hooks/useRoute';
import { hintKindLabel, roleLabel } from '../i18n/labels';
import { describeFinding, firstOccurrence, stepRange } from '../lib/findings';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Link } from './Link';

type Props = {
  finding: HintFinding; taskId: string;
  /** "Run #n" of every run of the task, by run id. */
  numbers: ReadonlyMap<string, number>;
  navigate: (change: RouteChange) => void;
};

/**
 * One recurring finding: the page element, what happened in plain words, how many runs show it and a link to the first
 * occurrence. Findings about the model's own choices are dashed because they may say more about the model than about the page.
 */
export function FindingCard({ finding, taskId, numbers, navigate }: Props) {
  const { t } = useTranslation();
  const model = finding.source === 'model';
  const first = firstOccurrence(finding), range = first ? stepRange(first.steps) : undefined, number = first ? numbers.get(first.runId) : undefined;
  const suspected = finding.occurrences.every(occurrence => occurrence.certainty === 'suspected');
  const role = finding.target ? roleLabel(finding.target.role) : t('taskList.wholePage'), name = finding.target?.name ?? hintKindLabel(finding.kind);
  const link = number === undefined ? t('taskPage.openRunPlain') : range ? t('taskPage.openRun', { number, range }) : t('taskPage.openRunNoStep', { number });
  return <li className={cn('flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-3.5 py-2.5', model && 'border-dashed')}>
    <div className="grid min-w-0 flex-[1_1_13rem] gap-0.5">
      <span className="text-xs text-muted-foreground">{role}</span>
      <span className={cn('break-words', model ? 'font-medium' : 'font-semibold')}>{name}</span>
    </div>
    <div className="min-w-0 flex-[2_1_20rem] text-sm leading-6">
      <p>{describeFinding(finding) ?? hintKindLabel(finding.kind)}</p>
      {suspected && <Badge variant="outline" className="mt-1">{t('taskPage.suspected')}</Badge>}
    </div>
    <div className="grid shrink-0 justify-items-end gap-0.5 text-right">
      <span className="text-sm font-semibold tabular-nums">{t('taskPage.frequency', { total: finding.totalRuns, runs: finding.runs })}</span>
      {first && <Link to={{ task: taskId, run: first.runId, ...(first.steps[0] !== undefined ? { step: first.steps[0] } : {}) }} navigate={navigate} className="rounded-sm text-[13px] text-primary underline-offset-2 hover:underline">{link}</Link>}
    </div>
  </li>;
}
