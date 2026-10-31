import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { DEFAULT_EXECUTOR_INSTRUCTIONS, executorModel, followsPlan, isFilePlanner, type Combo, type Connection, type Executor, type PlanFollowerChoice } from '@rawstep/project/config';
import { blankExecutor } from '../../lib/conditions';
import { cn } from '../../lib/utils';
import { Advanced, Choice, Field, Panel } from '../forms';
import { SPEECH_PLANNER_INSTRUCTIONS } from '@rawstep/policies/llm/rules';
import { InfoTip } from '../layout/InfoTip';
import { effortOf, ModelPicker } from '../ModelPicker';
import { ProjectPathField } from '../ProjectPathField';
import { Button } from '../ui/button';


type Props = {
  combo: Combo; onChange: (combo: Combo) => void; connections: readonly Connection[]; compact?: boolean;
  /** Tasks that run with this profile, so a plan file path is checked for each of them. */
  tasks?: readonly { name: string; file: string }[];
};

/**
 * Who thinks in a run profile. Runs always plan: a planner (an LLM, or a plan file) writes the plan, and Rawstep carries it out itself
 * or an executor model picks within each task.
 */
export function ComboEditor({ combo, onChange, connections, compact, tasks }: Props) {
  const { t } = useTranslation();
  const llms = connections.filter(c => c.kind === 'llm');
  const setExecutor = (executor: Executor | PlanFollowerChoice | undefined) => {
    const { executor: _old, ...rest } = combo;
    onChange(executor ? { ...rest, executor } : rest);
  };
  const follows = followsPlan(combo);
  return <div className={cn('grid min-w-0 [&>section:not(:first-child)]:border-t', compact ? 'gap-4 [&>section:not(:first-child)]:pt-4' : 'gap-8 [&>section:not(:first-child)]:pt-6')}>
    {!connections.length && <p className="border-l-2 border-inspect bg-inspect-soft py-2 pr-3 pl-3 text-sm leading-6">{t('conditions.combo.noConnections')}</p>}
    <PlannerGroup combo={combo} onChange={onChange} llms={llms} compact={compact} tasks={tasks ?? []} />
    <Group title={t('conditions.combo.executor.runnerTitle')} compact={compact}>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <InlineRadio legend={t('conditions.combo.executor.runner')} value={follows ? 'plan' : 'model'} onChange={runner => setExecutor(runner === 'plan' ? { followPlan: true } : undefined)}
            rows={(['plan', 'model'] as const).map(id => ({ id, label: t(`conditions.combo.executor.runners.${id}`) }))} />
          <p className="text-xs leading-5 text-muted-foreground">{t(`conditions.combo.executor.runnerHints.${follows ? 'plan' : 'model'}`)}</p>
        </div>
        {!follows && <ExecutorFields executor={executorModel(combo)} onChange={setExecutor} connections={connections} compact={compact} />}
      </div>
    </Group>
  </div>;
}

/** One group of a combo: an h3 with an optional ⓘ and marker, then its fields. Groups are separated by a rule from the parent. */
function Group({ title, info, marker, children, compact }: { title: string; info?: ReactNode; marker?: string; children: ReactNode; compact?: boolean | undefined }) {
  const id = useId();
  return <section aria-labelledby={id} className={cn('grid min-w-0 content-start', compact ? 'gap-3' : 'gap-4')}>
    <h3 id={id} className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold">{title}{info && <InfoTip term={title}>{info}</InfoTip>}{marker && <span className="text-xs font-normal text-muted-foreground">· {marker}</span>}</h3>
    {children}
  </section>;
}

/** Native radios on one line, labels only; the group's heading names them and the legend is for screen readers. */
function InlineRadio<T extends string>({ legend, value, onChange, rows }: { legend: string; value: T; onChange: (value: T) => void; rows: { id: T; label: string }[] }) {
  const group = useId();
  return <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
    <legend className="sr-only">{legend}</legend>
    {rows.map(row => <label key={row.id} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
      <input type="radio" name={group} value={row.id} checked={row.id === value} onChange={() => onChange(row.id)} className="size-4 shrink-0 accent-trace" />{row.label}
    </label>)}
  </fieldset>;
}

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

/** The planner: an LLM that writes and corrects the plan document, or a plan file written beforehand. The LLM follows Rawstep's rules, which are shown but cannot change. */
function PlannerGroup({ combo, onChange, llms, compact, tasks }: { combo: Combo; onChange: (combo: Combo) => void; llms: readonly Connection[]; compact?: boolean | undefined; tasks: readonly { name: string; file: string }[] }) {
  const { t } = useTranslation();
  const planner = combo.planner;
  const source = isFilePlanner(planner) ? 'file' : 'llm';
  const tip = (info: ReactNode) => compact ? undefined : info;
  const setSource = (next: 'llm' | 'file') => {
    if (next === source) return;
    const llm = llms[0];
    const { planner: _old, ...rest } = combo;
    onChange({ ...rest, ...(next === 'file' ? { planner: { planFile: PLAN_FILE_DEFAULT } } : llm ? { planner: { connectionId: llm.id, modelId: '', instructions: '' } } : {}) });
  };
  return <Group title={t('conditions.combo.planner.title')} compact={compact} info={tip(t('conditions.combo.planner.intro'))}>
    <InlineRadio legend={t('conditions.combo.planner.sourceLegend')} value={source} onChange={setSource} rows={(['llm', 'file'] as const).map(id => ({ id, label: t(`conditions.combo.planner.source.${id}`) }))} />
    {isFilePlanner(planner) ? <>
      <ProjectPathField label={t('conditions.combo.planner.planFile')} value={planner.planFile} extensions={['.json']} tasks={tasks} example={PLAN_FILE_DEFAULT}
        info={<>{t('conditions.combo.planner.planFileHint')} {tip(t('conditions.combo.planner.planFileInfo'))}</>} onChange={planFile => onChange({ ...combo, planner: { planFile } })} />
      <Panel title={t('conditions.combo.planner.planFileExample')}>
        <pre lang="en" className="max-h-64 overflow-y-auto border border-edge bg-raised p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{PLAN_FILE_EXAMPLE}</pre>
      </Panel>
    </> : <>
      {llms.length
        ? <ModelPicker hideLabel label={t('conditions.combo.planner.model')} connections={llms} connectionId={planner?.connectionId} modelId={planner?.modelId ?? ''} reasoningEffort={planner?.reasoningEffort}
          onChange={next => onChange({ ...combo, planner: { connectionId: next.connectionId, modelId: next.modelId, ...effortOf(next), instructions: planner?.instructions ?? '' } })} />
        : <p className="text-sm leading-6 text-inspect">{t('conditions.combo.planner.noLlm')}</p>}
      {planner && <Field label={t('conditions.combo.planner.instructions')} multiline plain value={planner.instructions} placeholder={t('conditions.combo.planner.instructionsPlaceholder')} info={tip(<><p>{t('conditions.combo.planner.instructionsInfo')}</p><p>{t('conditions.combo.planner.pageKnowledge')}</p></>)}
        onChange={instructions => onChange({ ...combo, planner: { ...planner, instructions } })} />}
      <Panel title={t('conditions.combo.planner.builtIn')}>
        <pre lang="en" className="max-h-64 overflow-y-auto border border-edge bg-raised p-3 font-mono text-xs leading-5 whitespace-pre-wrap">{SPEECH_PLANNER_INSTRUCTIONS}</pre>
      </Panel>
    </>}
  </Group>;
}

type ExecutorProps = { executor: Executor | undefined; onChange: (executor: Executor | undefined) => void; connections: readonly Connection[]; compact?: boolean | undefined };

/** The executor: the model, how much it decides inside a task, the instructions it gets on every action and how much history it sees. */
function ExecutorFields({ executor, onChange, connections, compact }: ExecutorProps) {
  const { t } = useTranslation();
  const set = (part: Partial<Executor>) => executor && onChange({ ...executor, ...part });
  const tip = (info: ReactNode) => compact ? undefined : info;
  return <div className="grid content-start gap-4">
    <ModelPicker hideLabel label={t('conditions.combo.executor.model')} connections={connections} connectionId={executor?.connectionId} modelId={executor?.modelId ?? ''} reasoningEffort={executor?.reasoningEffort}
      onChange={next => {
        const picked = connections.find(c => c.id === next.connectionId)!;
        const base = !executor || executor.connectionId !== next.connectionId ? { ...blankExecutor(picked), ...(executor ? { instructions: executor.instructions, historyLimit: executor.historyLimit } : {}) } : executor;
        const { reasoningEffort: _old, ...kept } = base;
        onChange({ ...kept, connectionId: next.connectionId, modelId: next.modelId, ...effortOf(next), ...(next.picked?.maxChoices ? { maxChoices: next.picked.maxChoices } : {}) });
      }} />
    {!executor && <p className="text-[13px] leading-5 text-muted-foreground">{t('conditions.combo.executor.pickModel')}</p>}
    {executor && <>
      <Choice label={t('conditions.combo.executor.latitude')} value={executor.latitude} onChange={latitude => set({ latitude: latitude as Executor['latitude'] })} info={tip(t('conditions.combo.executor.latitudeHint'))}
        options={(['none', 'direction', 'method'] as const).map(value => ({ id: value, name: t(`conditions.combo.executor.latitudes.${value}`) }))} />
      <div className="grid gap-1.5">
        <Field label={t('conditions.combo.executor.instructions')} multiline value={executor.instructions} onChange={instructions => set({ instructions })} info={tip(t('conditions.combo.executor.instructionsHint'))} />
        {executor.instructions !== DEFAULT_EXECUTOR_INSTRUCTIONS && <Button type="button" variant="ghost" size="sm" className="-ml-2 justify-self-start text-muted-foreground"
          onClick={() => set({ instructions: DEFAULT_EXECUTOR_INSTRUCTIONS })}><RotateCcw aria-hidden="true" />{t('conditions.combo.executor.resetInstructions')}</Button>}
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label={t('conditions.combo.executor.historyLimit')} type="number" value={String(executor.historyLimit)} onChange={s => set({ historyLimit: Number(s) })} info={tip(t('conditions.combo.executor.historyLimitHint'))} />
      </div>
      <Advanced>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('conditions.combo.executor.maxChoices')} type="number" value={String(executor.maxChoices)} onChange={s => set({ maxChoices: Number(s) })} hint={t('conditions.combo.executor.maxChoicesHint')} />
        </div>
      </Advanced>
    </>}
  </div>;
}
