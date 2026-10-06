import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, Save, Trash2 } from 'lucide-react';
import { defaultAgent, type Agent, type Connection } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import type { RouteChange } from '../hooks/useRoute';
import { AgentModelFields, blankExecutor } from '../components/AgentModelFields';
import { Field } from '../components/forms';
import { ConceptNote } from '../components/layout/ConceptNote';
import { PageHeader } from '../components/layout/PageHeader';
import { PermissionPresets } from '../components/PermissionPresets';
import { PolicyFields } from '../components/PolicyFields';
import { Button } from '../components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { agentConditions, agentModelsLine } from '../lib/agentSummary';
import { cn } from '../lib/utils';
import type { PageProps } from './types';

type Preset = 'blank' | 'jev' | 'jevPlanner' | 'llm';

/** A new agent from a preset. Model IDs stay empty: the person types or picks them, and saving waits for them. */
function presetAgent(preset: Preset, id: string, name: string, connections: readonly Connection[]): Agent {
  const agent = defaultAgent(id, name), decision = connections.find(c => c.kind === 'decision'), llm = connections.find(c => c.kind === 'llm');
  if (preset === 'jev' || preset === 'jevPlanner') {
    if (decision) agent.executors.screenreader = blankExecutor(decision, 'screenreader');
    if (preset === 'jevPlanner' && llm) agent.planner = { connectionId: llm.id, modelId: '', instructions: '' };
  }
  if (preset === 'llm' && llm) agent.executors = { screenreader: blankExecutor(llm, 'screenreader'), keyboard: blankExecutor(llm, 'keyboard') };
  return agent;
}

/** Why an agent cannot be saved yet: a model without its ID, or an executor without instructions. */
function blocker(agent: Agent): 'missingModelId' | 'missingInstructions' | undefined {
  const executors = [agent.executors.screenreader, agent.executors.keyboard].filter(e => e !== undefined);
  if ((agent.planner && !agent.planner.modelId.trim()) || executors.some(e => !e.modelId.trim())) return 'missingModelId';
  if (executors.some(e => !e.instructions.trim())) return 'missingInstructions';
  return undefined;
}

/**
 * Agents: who performs a task — an optional planner LLM, the executor of each mode, the actions it may take and when a run counts as
 * stuck. The sheet states the agent as condition lines and below them is the editor. Comparing models is comparing agents.
 */
export function AgentsPage({ navigate, ...props }: PageProps & { navigate: (change: RouteChange) => void }) {
  const { t } = useTranslation();
  const config = props.view.config, capabilities = props.view.capabilities;
  const [agents, setAgents] = useState<Agent[]>(() => structuredClone(config.agents));
  const [selectedId, setSelectedId] = useState(() => config.agents[0]!.id);
  const [adding, setAdding] = useState(false);
  const selected = agents.find(agent => agent.id === selectedId) ?? agents[0]!;
  const usedBy = config.tasks.filter(task => task.agentId === selected.id).length;
  const dirty = JSON.stringify(agents) !== JSON.stringify(config.agents);
  const blocked = agents.map(agent => ({ agent, reason: blocker(agent) })).find(entry => entry.reason);
  const update = (part: Partial<Agent>) => setAgents(list => list.map(agent => agent.id === selected.id ? { ...agent, ...part } : agent));
  const add = (agent: Agent) => { setAgents(list => [...list, agent]); setSelectedId(agent.id); setAdding(false); };
  const remove = () => {
    const next = agents.filter(agent => agent.id !== selected.id);
    setAgents(next); setSelectedId(next[0]!.id);
  };
  // Writes only the agents (and the task references to deleted ones) on top of the latest config.
  const save = () => void props.act(async () => {
    const tasks = props.view.config.tasks.map(task => {
      if (!task.agentId || agents.some(agent => agent.id === task.agentId)) return task;
      const { agentId: _removed, ...rest } = task;
      return rest;
    });
    await props.save({ ...props.view.config, tasks, agents }, undefined, props.view.revision);
  });
  const conditions = agentConditions(selected, capabilities.screenreader, config.connections);
  return <div className="grid gap-5">
    <PageHeader title={t('agents.heading')} description={t('agents.intro')} />
    <ConceptNote concept="agent" />
    <div className="grid items-start gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="grid gap-3">
        <ul aria-label={t('agents.listLabel')} className="grid border-y border-edge-strong">
          {agents.map(agent => <li key={agent.id} className="border-b border-edge last:border-b-0">
            <button type="button" aria-current={agent.id === selected.id ? 'true' : undefined} onClick={() => setSelectedId(agent.id)}
              data-selected={agent.id === selected.id} className={cn('row-rail rail-divider grid min-h-11 w-full gap-0.5 py-2.5 pr-3 pl-4 text-left text-sm', agent.id === selected.id ? 'bg-trace-soft font-medium' : 'hover:bg-raised')}>
              <span>{agent.name}</span>
              <span className="text-xs leading-4 font-normal text-muted-foreground">{agentModelsLine(agent, config.connections)}</span>
            </button>
          </li>)}
        </ul>
        <AddAgent open={adding} onOpenChange={setAdding} connections={config.connections}
          onPick={preset => add(presetAgent(preset, crypto.randomUUID(), t('agents.newName', { n: agents.length + 1 }), config.connections))} />
      </div>
      <div className="grid min-w-0 gap-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_auto] sm:items-end sm:justify-between">
          <Field label={t('agents.name')} value={selected.name} onChange={name => update({ name })} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => add({ ...structuredClone(selected), id: crypto.randomUUID(), name: t('agents.copyName', { name: selected.name }) })}><Copy aria-hidden="true" />{t('agents.duplicate')}</Button>
            <Button variant="outline" disabled={agents.length <= 1} onClick={remove}><Trash2 aria-hidden="true" />{t('agents.delete')}</Button>
          </div>
        </div>
        {usedBy > 0 && <p className="-mt-3 text-xs leading-5 text-muted-foreground">{t('agents.usedBy', { count: usedBy })}</p>}
        <section aria-labelledby="agent-conditions" className="grid gap-1.5">
          <h3 id="agent-conditions" className="border-b border-edge-strong pb-1.5 text-sm font-semibold">{t('agents.conditionTitle', { name: selected.name })}</h3>
          <dl className="grid">
            {conditions.map(condition => <div key={condition.id} className="grid gap-x-4 border-b border-edge py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <dt className="text-sm text-muted-foreground">{t(`agents.condition.labels.${condition.id}`)}</dt>
              <dd className="text-sm leading-6">{condition.value}</dd>
            </div>)}
          </dl>
        </section>
        <AgentTabs key={selected.id} agent={selected} update={update} capabilities={capabilities} connections={config.connections} navigate={navigate} />
        <div className="flex flex-wrap items-center gap-3 border-t border-edge-strong pt-4">
          <Button size="xl" disabled={props.busy || !dirty || !!blocked} onClick={save}><Save aria-hidden="true" />{t('agents.save')}</Button>
          <p role="status" className="text-xs text-muted-foreground">{blocked ? t(`agents.${blocked.reason!}`, { name: blocked.agent.name }) : dirty ? t('agents.unsaved') : t('agents.saved')}</p>
        </div>
      </div>
    </div>
  </div>;
}

/** "에이전트 추가" opens the starting points: an empty agent, or the usual pairings of decision model and LLM. */
function AddAgent({ open, onOpenChange, connections, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; connections: readonly Connection[]; onPick: (preset: Preset) => void }) {
  const { t } = useTranslation();
  const decision = connections.some(c => c.kind === 'decision'), llm = connections.some(c => c.kind === 'llm');
  const note = (preset: Preset) => preset === 'jev' ? (!decision ? t('agents.presets.noDecision') : '')
    : preset === 'jevPlanner' ? [!decision && t('agents.presets.noDecision'), !llm && t('agents.presets.noLlm')].filter(Boolean).join(' ')
    : preset === 'llm' && !llm ? t('agents.presets.noLlm') : '';
  return <Collapsible open={open} onOpenChange={onOpenChange} className="grid gap-2">
    <CollapsibleTrigger asChild><Button variant="outline"><Plus aria-hidden="true" />{t('agents.add')}</Button></CollapsibleTrigger>
    <CollapsibleContent>
      <ul aria-label={t('agents.addLabel')} className="grid border-y border-edge-strong">
        {(['blank', 'jev', 'jevPlanner', 'llm'] as const).map(preset => <li key={preset} className="border-b border-edge last:border-b-0">
          <button type="button" onClick={() => onPick(preset)} className="grid w-full gap-0.5 py-2 pr-3 pl-4 text-left text-sm hover:bg-raised">
            <span className="font-medium">{t(`agents.presets.${preset}.name`)}</span>
            <span className="text-xs leading-4 text-muted-foreground">{t(`agents.presets.${preset}.hint`)}</span>
            {note(preset) && <span className="text-xs leading-4 text-inspect">{note(preset)}</span>}
          </button>
        </li>)}
      </ul>
    </CollapsibleContent>
  </Collapsible>;
}

type TabsProps = { agent: Agent; update: (part: Partial<Agent>) => void; capabilities: ConfigView['capabilities']; connections: readonly Connection[]; navigate: (change: RouteChange) => void };

function AgentTabs({ agent, update, capabilities, connections, navigate }: TabsProps) {
  const { t } = useTranslation();
  return <Tabs defaultValue="setup" className="gap-4">
    <TabsList variant="line" aria-label={t('agents.tabsLabel')}>
      {(['setup', 'permissions', 'stuck'] as const).map(tab => <TabsTrigger key={tab} value={tab}>{t(`agents.tabs.${tab}`)}</TabsTrigger>)}
    </TabsList>
    <TabsContent value="setup"><AgentModelFields agent={agent} update={update} connections={connections} navigate={navigate} /></TabsContent>
    <TabsContent value="permissions"><PermissionPresets value={agent.permissions} onChange={permissions => update({ permissions })} capabilities={capabilities} /></TabsContent>
    <TabsContent value="stuck" className="grid gap-4">
      <p className="text-[13px] leading-5 text-muted-foreground">{t('agents.stuckHint')}</p>
      <PolicyFields value={agent.policy} onChange={policy => update({ policy })} />
    </TabsContent>
  </Tabs>;
}
