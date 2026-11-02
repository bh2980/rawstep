import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultProfile, isFilePlanner, runRulesSchema, type Combo, type Profile, type RunRules } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { t as translate } from '../i18n';
import { sameValue } from '../lib/conditions';
import { personaOf, PRESETS, withPreset } from '../lib/persona';
import { ActionSetEditor } from './conditions/ActionSetEditor';
import { AtEnvironmentDetails, BackendSelect } from './conditions/AtEnvironmentEditor';
import { ComboEditor } from './conditions/ComboEditor';
import { PageEnvironmentSelect } from './conditions/PageEnvironmentEditor';
import { RunRulesEditor } from './conditions/RunRulesEditor';
import { Fold, RadioList, Sheet, SheetRow } from './conditions/Sheet';
import { EnvironmentFields } from './EnvironmentFields';

/** The fields of a full set of rules that differ from Rawstep's defaults, so a field never changed reads as inherited. */
export function changedRules(rules: RunRules): Partial<RunRules> {
  const defaults = runRulesSchema.parse({});
  return Object.fromEntries(Object.entries(rules).filter(([key, value]) => defaults[key as keyof RunRules] !== value)) as Partial<RunRules>;
}

/** Who thinks in a run, in one sentence: the planner plans, Rawstep carries the plan out. */
export function aiSummary(profile: Pick<Combo, 'planner'>): string {
  const planner = isFilePlanner(profile.planner) ? translate('conditions.summary.planFile', { path: profile.planner.planFile }) : profile.planner?.modelId.trim();
  if (!planner) return translate('profile.questions.aiNone');
  return translate('profile.questions.aiPlanned', { planner });
}

/** How many of a profile's settings differ from a new profile's: each changed run rule, the page, the screen reader, the actions. */
export function changedSettingCount(profile: Profile): number {
  const base = defaultProfile(profile.id, profile.name);
  return Object.keys(changedRules(profile.runRules)).length + [
    !sameValue(profile.page, base.page), profile.screenReader !== base.screenReader, personaOf(profile) !== personaOf(base) || profile.actions.typeText !== base.actions.typeText || profile.actions.replaceText !== base.actions.replaceText,
  ].filter(Boolean).length;
}

type Props = {
  profile: Profile; onChange: (profile: Profile) => void; view: ConfigView;
  /** Input names of the task the profile is edited for, so typing into them can be allowed. */
  inputNames?: readonly string[];
};

/**
 * A run profile as four sheet rows, the questions a person asks about a screen reader user: 어떻게 찾나요 (radio rows), 어떤 AI가
 * 생각하나요 (the planner on one line), 어디서 듣나요 (screen reader and page), 언제 멈추나요 (only the rules changed from the
 * defaults). What is rarely changed folds under its row, so every setting of the profile stays reachable.
 */
export function ProfileEditor({ profile, onChange, view, inputNames }: Props) {
  const { t } = useTranslation();
  const id = useId();
  // "직접 고름" stays picked after a person chooses it, even while the actions still equal a starting point; a new profile starts over.
  const [customFor, setCustomFor] = useState<string>();
  const persona = customFor === profile.id ? 'custom' : personaOf(profile);
  const combo: Combo = { id: profile.id, name: profile.name, ...(profile.planner ? { planner: profile.planner } : {}) };
  const setCombo = ({ planner }: Combo) => { const { planner: _planner, ...rest } = profile; onChange({ ...rest, ...(planner ? { planner } : {}) }); };
  const label = (question: string) => `${id}-${question}`;
  return <Sheet>
    <SheetRow label={t('profile.questions.who')} labelId={label('who')}>
      <RadioList labelledBy={label('who')} value={persona}
        onChange={preset => { if (preset === 'custom') { setCustomFor(profile.id); return; } setCustomFor(undefined); onChange(withPreset(profile, preset)); }}
        rows={[...PRESETS, 'custom' as const].map(preset => ({ id: preset, label: t(`persona.${preset}.preset`), hint: t(`persona.${preset}.hint`) }))} />
      <Fold key={persona === 'custom' ? 'custom' : 'preset'} defaultOpen={persona === 'custom'} label={t('profile.questions.whoActions')} className="mt-1">
        <ActionSetEditor value={profile.actions} onChange={actions => onChange({ ...profile, actions })}
          capabilities={view.capabilities} {...(inputNames ? { inputNames } : {})} backend={profile.screenReader} />
      </Fold>
    </SheetRow>
    <SheetRow label={t('profile.questions.ai')} labelId={label('ai')}>
      <ComboEditor combo={combo} onChange={setCombo} connections={view.config.connections} tasks={view.config.tasks} labelledBy={label('ai')} />
    </SheetRow>
    <SheetRow label={t('profile.questions.where')} labelId={label('where')}>
      <div role="group" aria-labelledby={label('where')} className="grid gap-1">
        <div className="flex flex-wrap gap-2">
          <BackendSelect value={profile.screenReader} onChange={screenReader => onChange({ ...profile, screenReader })} />
          <PageEnvironmentSelect id={profile.id} value={profile.page} presets={view.environmentPresets} onChange={page => onChange({ ...profile, page })} />
        </div>
        <Fold label={t('profile.questions.whereMore')}>
          <AtEnvironmentDetails backend={profile.screenReader} capabilities={view.capabilities} />
          <EnvironmentFields hidePreset key={profile.id} value={profile.page} onChange={page => onChange({ ...profile, page })} presets={view.environmentPresets} id={profile.id} />
        </Fold>
      </div>
    </SheetRow>
    <SheetRow label={t('profile.questions.stop')} labelId={label('stop')}>
      <div role="group" aria-labelledby={label('stop')}>
        <RunRulesEditor value={changedRules(profile.runRules)} inherited={runRulesSchema.parse({})}
          onChange={rules => onChange({ ...profile, runRules: { ...runRulesSchema.parse({}), ...rules } })} />
      </div>
    </SheetRow>
  </Sheet>;
}
