import { useTranslation } from 'react-i18next';
import { isFilePlanner, type Combo, type Connection } from '@rawstep/project/config';
import { SPEECH_PLANNER_INSTRUCTIONS } from '@rawstep/policies/llm/rules';
import { kindLabelKey } from '../../lib/connections';
import { Field } from '../forms';
import { effortOf, ModelPicker } from '../ModelPicker';
import { ProjectPathField } from '../ProjectPathField';
import { Fold } from './Sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

type Props = {
  combo: Combo; onChange: (combo: Combo) => void; connections: readonly Connection[];
  /** Tasks that run with this profile, so a plan file path is checked for each of them. */
  tasks?: readonly { name: string; file: string }[];
  /** The id of the text that names this part (a sheet row's label). */
  labelledBy?: string;
};

const PLAN_FILE = '__plan-file__';
const PLAN_FILE_DEFAULT = 'plans/{task}/plan.json';
const PLAN_FILE_EXAMPLE = JSON.stringify({
  strategy: 'Find the product, add it to the cart, then open the cart.',
  criteria: [{ id: 'C1', text: 'The user hears that the item is in the cart.' }],
  assumptions: [{ id: 'A1', text: 'The product page has an "Add to cart" button.' }],
  phases: [{ title: 'Add the product', criteria: ['C1'], tasks: [
    { goal: "Move to the 'Add to cart' button", done: 'The user hears "Add to cart, button"', cue: 'Add to cart, button', serves: ['C1'], relies: ['A1'] },
    { goal: "Activate the 'Add to cart' button", done: 'The user hears that the item was added', cue: 'added to cart', serves: ['C1'] },
  ] }],
}, null, 2);

/**
 * Who thinks in a run profile, on one line: the connection that plans (or a plan file written beforehand), then the model on it.
 * Rawstep carries the plan out as written. The planner's own instructions and Rawstep's fixed planner rules fold below.
 */
export function ComboEditor({ combo, onChange, connections, tasks, labelledBy }: Props) {
  const { t } = useTranslation();
  const planner = combo.planner;
  const file = isFilePlanner(planner);
  const source = file ? PLAN_FILE : planner?.connectionId ?? '';
  const setSource = (next: string) => {
    if (next === source) return;
    const { planner: _old, ...rest } = combo;
    onChange({ ...rest, planner: next === PLAN_FILE ? { planFile: PLAN_FILE_DEFAULT } : { connectionId: next, modelId: '', instructions: '' } });
  };
  return <div role="group" aria-labelledby={labelledBy} className="grid min-w-0 gap-2">
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      <Select value={source} onValueChange={setSource}>
        <SelectTrigger aria-label={t('conditions.combo.planner.sourceLegend')} className="w-56 max-w-full"><SelectValue placeholder={t('forms.placeholder')} /></SelectTrigger>
        <SelectContent>
          {connections.map(c => <SelectItem key={c.id} value={c.id}>{c.name} <span className="text-ink-2">· {t(`connections.kinds.${kindLabelKey(c)}.name`)}</span></SelectItem>)}
          <SelectItem value={PLAN_FILE}>{t('conditions.combo.planner.source.file')}</SelectItem>
        </SelectContent>
      </Select>
      {planner && !isFilePlanner(planner) && <ModelPicker hideLabel hideConnection label={t('conditions.combo.planner.model')} connections={connections} connectionId={planner.connectionId} modelId={planner.modelId} reasoningEffort={planner.reasoningEffort}
        onChange={next => onChange({ ...combo, planner: { connectionId: next.connectionId, modelId: next.modelId, ...effortOf(next), instructions: planner.instructions } })} />}
    </div>
    {!connections.length && !file && <p className="text-ink-2">{t('conditions.combo.noConnections')}</p>}
    {isFilePlanner(planner) && <div className="grid max-w-xl gap-2">
      <ProjectPathField label={t('conditions.combo.planner.planFile')} value={planner.planFile} extensions={['.json']} tasks={tasks ?? []} example={PLAN_FILE_DEFAULT}
        info={t('conditions.combo.planner.planFileHint')} onChange={planFile => onChange({ ...combo, planner: { planFile } })} />
      <Fold label={t('conditions.combo.planner.planFileExample')}>
        <pre lang="en" className="max-h-64 overflow-y-auto rounded-sm border border-edge bg-raised p-3 font-mono text-sm whitespace-pre-wrap">{PLAN_FILE_EXAMPLE}</pre>
      </Fold>
    </div>}
    {planner && !isFilePlanner(planner) && <Fold label={t('conditions.combo.planner.more')}>
      <div className="grid max-w-2xl gap-3">
        <Field label={t('conditions.combo.planner.instructions')} multiline plain value={planner.instructions} placeholder={t('conditions.combo.planner.instructionsPlaceholder')}
          hint={t('conditions.combo.planner.pageKnowledge')} onChange={instructions => onChange({ ...combo, planner: { ...planner, instructions } })} />
        <div className="grid gap-1">
          <p className="font-medium text-ink-2">{t('conditions.combo.planner.builtIn')}</p>
          <pre lang="en" className="max-h-64 overflow-y-auto rounded-sm border border-edge bg-raised p-3 font-mono text-sm whitespace-pre-wrap">{SPEECH_PLANNER_INSTRUCTIONS}</pre>
        </div>
      </div>
    </Fold>}
  </div>;
}
