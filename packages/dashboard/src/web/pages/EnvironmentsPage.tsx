import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, Save, Trash2 } from 'lucide-react';
import { defaultEnvironment, type Environment } from '@rawstep/project/config';
import { EnvironmentFields } from '../components/EnvironmentFields';
import { Field } from '../components/forms';
import { ConceptNote } from '../components/layout/ConceptNote';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { environmentViewport } from '../lib/agentSummary';
import { cn } from '../lib/utils';
import type { PageProps } from './types';

/**
 * Environments: the page conditions a run happens in (a built-in preset or screen size, text scale and colour settings). They are an
 * experiment condition apart from the agent, so the same agent can be compared across them.
 */
export function EnvironmentsPage(props: PageProps) {
  const { t } = useTranslation();
  const config = props.view.config, presets = props.view.environmentPresets;
  const [environments, setEnvironments] = useState<Environment[]>(() => structuredClone(config.environments));
  const [selectedId, setSelectedId] = useState(() => config.environments[0]!.id);
  const selected = environments.find(environment => environment.id === selectedId) ?? environments[0]!;
  const usedBy = config.tasks.filter(task => task.environmentId === selected.id).length;
  const dirty = JSON.stringify(environments) !== JSON.stringify(config.environments);
  const update = (part: Partial<Environment>) => setEnvironments(list => list.map(environment => environment.id === selected.id ? { ...environment, ...part } : environment));
  const add = (environment: Environment) => { setEnvironments(list => [...list, environment]); setSelectedId(environment.id); };
  const remove = () => {
    const next = environments.filter(environment => environment.id !== selected.id);
    setEnvironments(next); setSelectedId(next[0]!.id);
  };
  // Writes only the environments (and the task references to deleted ones) on top of the latest config.
  const save = () => void props.act(async () => {
    const tasks = props.view.config.tasks.map(task => {
      if (!task.environmentId || environments.some(environment => environment.id === task.environmentId)) return task;
      const { environmentId: _removed, ...rest } = task;
      return rest;
    });
    await props.save({ ...props.view.config, tasks, environments }, undefined, props.view.revision);
  });
  const size = (environment: Environment) => t('environments.viewport', environmentViewport(environment.profile, presets));
  return <div className="grid gap-5">
    <PageHeader title={t('environments.heading')} description={t('environments.intro')} />
    <ConceptNote concept="environment" />
    <div className="grid items-start gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="grid gap-3">
        <ul aria-label={t('environments.listLabel')} className="grid border-y border-edge-strong">
          {environments.map(environment => <li key={environment.id} className="border-b border-edge last:border-b-0">
            <button type="button" aria-current={environment.id === selected.id ? 'true' : undefined} onClick={() => setSelectedId(environment.id)}
              data-selected={environment.id === selected.id} className={cn('row-rail rail-divider grid min-h-11 w-full gap-0.5 py-2.5 pr-3 pl-4 text-left text-sm', environment.id === selected.id ? 'bg-trace-soft font-medium' : 'hover:bg-raised')}>
              <span>{environment.name}</span>
              <span className="font-mono text-xs leading-4 font-normal text-muted-foreground">{size(environment)}</span>
            </button>
          </li>)}
        </ul>
        <Button variant="outline" onClick={() => add(defaultEnvironment(crypto.randomUUID(), t('environments.newName', { n: environments.length + 1 })))}><Plus aria-hidden="true" />{t('environments.add')}</Button>
      </div>
      <div className="grid min-w-0 gap-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_auto] sm:items-end sm:justify-between">
          <Field label={t('environments.name')} value={selected.name} onChange={name => update({ name })} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => add({ ...structuredClone(selected), id: crypto.randomUUID(), name: t('environments.copyName', { name: selected.name }) })}><Copy aria-hidden="true" />{t('environments.duplicate')}</Button>
            <Button variant="outline" disabled={environments.length <= 1} onClick={remove}><Trash2 aria-hidden="true" />{t('environments.delete')}</Button>
          </div>
        </div>
        {usedBy > 0 && <p className="-mt-3 text-xs leading-5 text-muted-foreground">{t('environments.usedBy', { count: usedBy })}</p>}
        <section aria-labelledby="environment-fields" className="grid gap-4">
          <h3 id="environment-fields" className="border-b border-edge-strong pb-1.5 text-sm font-semibold">{t('environments.fieldsTitle')}</h3>
          <EnvironmentFields key={selected.id} value={selected.profile} onChange={profile => update({ profile })} presets={presets} id={selected.id} />
        </section>
        <div className="flex flex-wrap items-center gap-3 border-t border-edge-strong pt-4">
          <Button size="xl" disabled={props.busy || !dirty} onClick={save}><Save aria-hidden="true" />{t('environments.save')}</Button>
          <p role="status" className="text-xs text-muted-foreground">{dirty ? t('environments.unsaved') : t('environments.saved')}</p>
        </div>
      </div>
    </div>
  </div>;
}
