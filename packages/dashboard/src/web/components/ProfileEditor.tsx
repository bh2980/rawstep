import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { runRulesSchema, type Combo, type Profile, type RunRules } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { cn } from '../lib/utils';
import { ActionSetEditor } from './conditions/ActionSetEditor';
import { AtEnvironmentEditor } from './conditions/AtEnvironmentEditor';
import { ComboEditor } from './conditions/ComboEditor';
import { PageEnvironmentEditor } from './conditions/PageEnvironmentEditor';
import { RunRulesEditor } from './conditions/RunRulesEditor';
import { InfoTip } from './layout/InfoTip';

/** The fields of a full set of rules that differ from Rawstep's defaults, so a field never changed reads as inherited. */
export function changedRules(rules: RunRules): Partial<RunRules> {
  const defaults = runRulesSchema.parse({});
  return Object.fromEntries(Object.entries(rules).filter(([key, value]) => defaults[key as keyof RunRules] !== value)) as Partial<RunRules>;
}

type Props = {
  profile: Profile; onChange: (profile: Profile) => void; view: ConfigView;
  /** Input names of the task the profile is edited for, so typing into them can be allowed. */
  inputNames?: readonly string[];
  /** Tighter spacing and fewer explanations, for the side sheet of a task. */
  compact?: boolean;
};

/**
 * A run profile in four parts, in the order a run uses them: who decides (structure and models), what the simulated user may do,
 * where it happens (page and screen reader), and when a run stops. Every part is plain fields on the one profile.
 */
export function ProfileEditor({ profile, onChange, view, inputNames, compact }: Props) {
  const { t } = useTranslation();
  const { id, name } = profile;
  const combo: Combo = { id, name, structure: profile.structure, ...(profile.planner ? { planner: profile.planner } : {}), executors: profile.executors };
  const setCombo = ({ structure, planner, executors }: Combo) => { const { planner: _old, ...rest } = profile; onChange({ ...rest, structure, executors, ...(planner ? { planner } : {}) }); };
  return <div className={cn('grid min-w-0', compact ? 'gap-8' : 'gap-10')}>
    <Part title={t('profile.parts.models')} info={compact ? undefined : t('profile.info.models')}>
      <ComboEditor combo={combo} onChange={setCombo} connections={view.config.connections} compact={compact} />
    </Part>
    <Part title={t('profile.parts.actions')} info={compact ? undefined : t('profile.info.actions')}>
      <ActionSetEditor actionSet={{ id, name, ...profile.actions }} onChange={actions => onChange({ ...profile, actions: { keyboard: actions.keyboard, screenreader: actions.screenreader } })}
        capabilities={view.capabilities} {...(inputNames ? { inputNames } : {})} compact={compact} />
    </Part>
    <Part title={t('profile.parts.page')} info={compact ? undefined : t('profile.info.page')}>
      <PageEnvironmentEditor environment={{ id, name, profile: profile.page }} onChange={environment => onChange({ ...profile, page: environment.profile })} presets={view.environmentPresets} compact={compact} />
    </Part>
    <Part title={t('profile.parts.screenReader')} info={compact ? undefined : t('profile.info.screenReader')}>
      <AtEnvironmentEditor environment={{ id, name, backend: profile.screenReader }} onChange={environment => onChange({ ...profile, screenReader: environment.backend })} capabilities={view.capabilities} compact={compact} />
    </Part>
    <Part title={t('profile.parts.rules')} info={compact ? undefined : t('profile.info.rules')}>
      <RunRulesEditor compact={compact} value={changedRules(profile.runRules)} inherited={runRulesSchema.parse({})}
        onChange={rules => onChange({ ...profile, runRules: { ...runRulesSchema.parse({}), ...rules } })} />
    </Part>
  </div>;
}

/** One part of a profile: an h2 on a rule with an optional ⓘ, then its editor. */
function Part({ title, info, children }: { title: string; info?: ReactNode; children: ReactNode }) {
  const id = useId();
  return <section aria-labelledby={id} className="grid min-w-0 gap-4">
    <h2 id={id} className="flex items-center gap-1.5 border-b border-edge-strong pb-1.5 text-base font-semibold">{title}{info && <InfoTip term={title}>{info}</InfoTip>}</h2>
    {children}
  </section>;
}
