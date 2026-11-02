import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSettings } from '@rawstep/project/config';
import { SaveBar } from '../../components/conditions/SaveBar';
import { RadioList, Sheet, SheetRow } from '../../components/conditions/Sheet';
import { effortOf, ModelPicker } from '../../components/ModelPicker';
import { Textarea } from '../../components/ui/textarea';
import { sameValue } from '../../lib/conditions';
import type { PageProps } from '../types';

const NONE = '__none__';
type Suggest = 'same' | 'own';

/**
 * 설정 · AI 연결, below the connections: the project's models that never change a run's outcome, as sheet rows — the commentary model
 * that reads a finished run (none, or one connection and a model on it), the model that suggests completion checks while a task is
 * written, and the commentary instructions.
 */
export function AssistSettings({ onDirty, ...props }: PageProps & { onDirty: (dirty: boolean) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const config = props.view.config;
  const [project, setProject] = useState<ProjectSettings>(() => structuredClone(config.project));
  const dirty = !sameValue(project, config.project);
  useEffect(() => { onDirty(dirty); }, [dirty]);
  const blocked = (project.analysis.model && !project.analysis.model.modelId.trim()) || (project.suggestions.model && !project.suggestions.model.modelId.trim()) ? t('settingsPage.missingModelId') : undefined;
  const save = () => void props.act(async () => { await props.save({ ...props.view.config, project }, undefined, props.view.revision); });
  const analysis = project.analysis.model, suggestion = project.suggestions.model;
  const setAnalysis = (connectionId: string) => {
    const { model: _old, ...rest } = project.analysis;
    if (connectionId === NONE) { setProject({ ...project, analysis: rest }); return; }
    setProject({ ...project, analysis: { ...rest, model: analysis?.connectionId === connectionId ? analysis : { connectionId, modelId: '' } } });
  };
  const setSuggest = (next: Suggest) => {
    const first = config.connections[0];
    setProject({ ...project, suggestions: next === 'own' && first ? { model: suggestion ?? { connectionId: analysis?.connectionId ?? first.id, modelId: analysis?.modelId ?? '' } } : {} });
  };
  return <div className="grid gap-4">
    <Sheet>
      <SheetRow label={t('settingsPage.analysis.title')} labelId={`${id}-analysis`}>
        <RadioList labelledBy={`${id}-analysis`} value={analysis?.connectionId ?? NONE} onChange={setAnalysis}
          rows={[
            { id: NONE, label: <>{t('settingsPage.analysis.none')} <span className="text-ink-2">· {t('settingsPage.analysis.rulesOnly')}</span></> },
            ...config.connections.map(c => ({ id: c.id, label: <>{c.name} <span className="text-ink-2">· {analysis?.connectionId === c.id && analysis.modelId.trim() ? analysis.modelId : t('settingsPage.analysis.pickModel')}</span></> })),
          ]}>
          {analysis && <div className="pt-1 pl-6">
            <ModelPicker hideLabel hideConnection label={t('settingsPage.analysis.model')} connections={config.connections} connectionId={analysis.connectionId} modelId={analysis.modelId} reasoningEffort={analysis.reasoningEffort}
              onChange={next => setProject({ ...project, analysis: { ...project.analysis, model: { connectionId: next.connectionId, modelId: next.modelId, ...effortOf(next) } } })} />
          </div>}
        </RadioList>
      </SheetRow>
      <SheetRow label={t('settingsPage.suggestions.title')} labelId={`${id}-suggest`}>
        <RadioList<Suggest> labelledBy={`${id}-suggest`} value={suggestion ? 'own' : 'same'} onChange={setSuggest}
          rows={[
            { id: 'same', label: t('settingsPage.suggestions.sameAsAnalysis') },
            { id: 'own', label: t('settingsPage.suggestions.own'), disabled: !config.connections.length },
          ]}>
          {suggestion && <div className="pt-1 pl-6">
            <ModelPicker hideLabel label={t('settingsPage.suggestions.model')} connections={config.connections} connectionId={suggestion.connectionId} modelId={suggestion.modelId} reasoningEffort={suggestion.reasoningEffort}
              onChange={next => setProject({ ...project, suggestions: { model: { connectionId: next.connectionId, modelId: next.modelId, ...effortOf(next) } } })} />
          </div>}
        </RadioList>
      </SheetRow>
      <SheetRow label={t('settingsPage.analysis.instructions')} htmlFor={`${id}-instructions`}>
        <Textarea id={`${id}-instructions`} rows={2} className="min-h-8 max-w-xl" value={project.analysis.instructions} placeholder={t('settingsPage.analysis.instructionsPlaceholder')}
          aria-describedby={`${id}-instructions-hint`} onChange={event => setProject({ ...project, analysis: { ...project.analysis, instructions: event.target.value } })} />
        <p id={`${id}-instructions-hint`} className="mt-1 text-sm text-ink-2">{t('settingsPage.analysis.instructionsShort')}</p>
      </SheetRow>
    </Sheet>
    <SaveBar dirty={dirty} busy={props.busy} blocked={blocked} onSave={save} onDiscard={() => setProject(structuredClone(config.project))} />
  </div>;
}
