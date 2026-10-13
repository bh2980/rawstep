import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSettings } from '@rawstep/project/config';
import { SaveBar } from '../../components/conditions/SaveBar';
import { Field } from '../../components/forms';
import { PageHeader, SectionHead } from '../../components/layout/PageHeader';
import { effortOf, ModelPicker } from '../../components/ModelPicker';
import { sameValue } from '../../lib/conditions';
import type { PageProps } from '../types';

/**
 * 설정 · 해설·제안 모델: the project's models that never change a run's outcome — the default commentary model that reads a finished
 * run, and the model that suggests completion checks while a task is written.
 */
export function AssistSettings({ onDirty, ...props }: PageProps & { onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation();
  const config = props.view.config;
  const [project, setProject] = useState<ProjectSettings>(() => structuredClone(config.project));
  const llms = config.connections.filter(c => c.kind === 'llm');
  const dirty = !sameValue(project, config.project);
  useEffect(() => { onDirty(dirty); }, [dirty]);
  const blocked = (project.analysis.model && !project.analysis.model.modelId.trim()) || (project.suggestions.model && !project.suggestions.model.modelId.trim()) ? t('settingsPage.missingModelId') : undefined;
  const save = () => void props.act(async () => { await props.save({ ...props.view.config, project }, undefined, props.view.revision); });
  return <div className="grid max-w-3xl gap-6">
    <PageHeader title={t('settingsNav.sections.assist')} info={t('settingsNav.info.assist')} />
    <section aria-labelledby="settings-analysis" className="grid gap-4">
      <SectionHead id="settings-analysis" title={t('settingsPage.analysis.title')} info={t('settingsPage.analysis.intro')} />
      <ModelPicker label={t('settingsPage.analysis.model')} connections={llms} connectionId={project.analysis.model?.connectionId} modelId={project.analysis.model?.modelId ?? ''} reasoningEffort={project.analysis.model?.reasoningEffort}
        none={t('settingsPage.analysis.rulesOnly')} onNone={() => { const { model: _removed, ...rest } = project.analysis; setProject({ ...project, analysis: rest }); }}
        onChange={next => setProject({ ...project, analysis: { ...project.analysis, model: { connectionId: next.connectionId, modelId: next.modelId, ...effortOf(next) } } })} />
      <Field label={t('settingsPage.analysis.instructions')} multiline plain value={project.analysis.instructions} onChange={instructions => setProject({ ...project, analysis: { ...project.analysis, instructions } })} info={t('settingsPage.analysis.instructionsHint')} />
    </section>
    <section aria-labelledby="settings-suggestions" className="grid gap-4">
      <SectionHead id="settings-suggestions" title={t('settingsPage.suggestions.title')} info={t('settingsPage.suggestions.intro')} />
      <ModelPicker label={t('settingsPage.suggestions.model')} connections={llms} connectionId={project.suggestions.model?.connectionId} modelId={project.suggestions.model?.modelId ?? ''} reasoningEffort={project.suggestions.model?.reasoningEffort}
        none={t('settingsPage.suggestions.sameAsAnalysis')} onNone={() => setProject({ ...project, suggestions: {} })}
        onChange={next => setProject({ ...project, suggestions: { model: { connectionId: next.connectionId, modelId: next.modelId, ...effortOf(next) } } })} />
    </section>
    <SaveBar dirty={dirty} busy={props.busy} blocked={blocked} onSave={save} onDiscard={() => setProject(structuredClone(config.project))} />
  </div>;
}
