import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { executorModel, followsPlan, isFilePlanner, runRulesSchema, type Combo, type Mode, type Profile, type RunRules } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { t as translate } from '../i18n';
import { environmentViewport, MODES } from '../lib/conditions';
import { personaName, personaOf, PRESETS, withPreset } from '../lib/persona';
import { cn } from '../lib/utils';
import { ActionSetEditor } from './conditions/ActionSetEditor';
import { AtEnvironmentEditor } from './conditions/AtEnvironmentEditor';
import { ComboEditor } from './conditions/ComboEditor';
import { PageEnvironmentEditor } from './conditions/PageEnvironmentEditor';
import { RunRulesEditor, ruleValueLabel } from './conditions/RunRulesEditor';

/** The fields of a full set of rules that differ from Rawstep's defaults, so a field never changed reads as inherited. */
export function changedRules(rules: RunRules): Partial<RunRules> {
  const defaults = runRulesSchema.parse({});
  return Object.fromEntries(Object.entries(rules).filter(([key, value]) => defaults[key as keyof RunRules] !== value)) as Partial<RunRules>;
}

/** The four questions a profile answers, in the order a person thinks of them. */
export type Question = 'who' | 'ai' | 'where' | 'stop';
const QUESTIONS: Question[] = ['who', 'ai', 'where', 'stop'];

/** Who thinks in a run of this mode, in one sentence: the planner and how the plan is carried out, or the model that picks alone. */
export function aiSummary(profile: Pick<Combo, 'structure' | 'planner' | 'executors'>, mode: Mode): string {
  const executor = executorModel(profile, mode)?.modelId.trim();
  if (profile.structure === 'planned' && mode === 'screenreader') {
    const planner = isFilePlanner(profile.planner) ? translate('conditions.summary.planFile', { path: profile.planner.planFile }) : profile.planner?.modelId.trim();
    if (!planner) return translate('profile.questions.aiNone');
    return translate('profile.questions.aiPlanned', { planner, executor: followsPlan(profile, mode) ? translate('profile.questions.aiFollow') : translate('profile.questions.aiExecutor', { executor: executor || translate('conditions.summary.noModel') }) });
  }
  return executor ? translate('profile.questions.aiSolo', { executor }) : translate('profile.questions.aiNone');
}

/** The stop rules worth a glance: whether headings are surveyed first, the grace after an unheard success, and every rule changed from Rawstep's defaults. */
export function stopSummary(profile: Pick<Profile, 'runRules' | 'structure' | 'actions'>, mode: Mode): { text: string; changed: boolean }[] {
  const rules = profile.runRules, defaults = runRulesSchema.parse({});
  const surveys = mode === 'screenreader' && profile.structure === 'planned' && rules.survey === 'headings' && profile.actions.screenreader.intents.includes('headings.list');
  const parts: { text: string; changed: boolean }[] = [];
  if (surveys) parts.push({ text: translate('profile.questions.stopSurvey'), changed: false });
  if (mode === 'screenreader' && rules.confirmationGrace > 0) parts.push({ text: translate('profile.questions.stopGrace', { n: rules.confirmationGrace }), changed: rules.confirmationGrace !== defaults.confirmationGrace });
  for (const [key, value] of Object.entries(changedRules(rules)) as [keyof RunRules, RunRules[keyof RunRules]][]) {
    if (key === 'confirmationGrace' || key === 'survey') continue;
    parts.push({ text: translate('profile.questions.stopChanged', { label: translate(`conditions.runRules.fields.${key}.label`), value: ruleValueLabel(key, value), base: ruleValueLabel(key, defaults[key]) }), changed: true });
  }
  return parts.length ? parts : [{ text: translate('profile.questions.stopDefaults'), changed: false }];
}

type Props = {
  profile: Profile; onChange: (profile: Profile) => void; view: ConfigView;
  /** Input names of the task the profile is edited for, so typing into them can be allowed. */
  inputNames?: readonly string[];
  /** The question open at first: the first one when unset. */
  open?: Question;
};

/**
 * A run profile as four questions — who is using the page, which AI thinks, where it is heard, when a run stops. The four sit side by
 * side as tabs that each say the current answer; the chosen one opens below in a box of its own. Nothing is hidden: every setting of
 * the profile is under one of the four.
 */
export function ProfileEditor({ profile, onChange, view, inputNames, open: initiallyOpen = 'who' }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState<Question>(initiallyOpen);
  // "직접 고름" stays picked after a person chooses it, even while the actions still equal a starting point; a new profile starts over.
  const [customFor, setCustomFor] = useState<string>();
  const runMode = profile.mode, persona = customFor === `${profile.id}:${runMode}` ? 'custom' : personaOf(runMode, profile);
  const combo: Combo = { id: profile.id, name: profile.name, structure: profile.structure, ...(profile.planner ? { planner: profile.planner } : {}), executors: profile.executors };
  const setCombo = ({ structure, planner, executors }: Combo) => { const { planner: _old, ...rest } = profile; onChange({ ...rest, structure, executors, ...(planner ? { planner } : {}) }); };
  const { width, height } = environmentViewport(profile.page, view.environmentPresets);
  const stops = stopSummary(profile, runMode);
  const summaries: Record<Question, ReactNode> = {
    who: personaName(runMode, persona),
    ai: aiSummary(profile, runMode),
    where: runMode === 'keyboard' ? t('profile.questions.whereKeyboard', { width, height }) : t('profile.questions.whereScreenReader', { backend: t(`conditions.backends.${profile.screenReader}`), width, height }),
    stop: stops.map((part, index) => <span key={part.text}>{index > 0 && ' · '}<span className={part.changed ? 'text-trace' : undefined}>{part.text}</span></span>),
  };
  const bodies: Record<Question, ReactNode> = {
    who: <div className="grid gap-4">
      <Segments label={t('persona.modeLabel')} value={runMode} onChange={mode => onChange({ ...profile, mode })} items={MODES.map(mode => ({ id: mode, name: t(`persona.modes.${mode}`) }))} tabs />
      <div className="grid gap-1.5">
        <Segments label={t('persona.presetLabel')} value={persona}
          onChange={preset => { if (preset === 'custom') { setCustomFor(`${profile.id}:${runMode}`); return; } setCustomFor(undefined); onChange(withPreset(profile, runMode, preset)); }}
          items={[...PRESETS[runMode].map(preset => ({ id: preset, name: t(`persona.${preset}.preset`) })), { id: 'custom' as const, name: t('persona.custom.preset') }]} />
        <p className="text-[13px] leading-5 text-muted-foreground">{t(`persona.${persona}.hint`)}</p>
      </div>
      <ActionSetEditor actionSet={{ id: profile.id, name: profile.name, ...profile.actions }} onChange={actions => onChange({ ...profile, actions: { keyboard: actions.keyboard, screenreader: actions.screenreader } })}
        capabilities={view.capabilities} {...(inputNames ? { inputNames } : {})} only={runMode} backend={profile.screenReader} compact />
    </div>,
    ai: <ComboEditor combo={combo} onChange={setCombo} connections={view.config.connections} compact only={runMode} tasks={view.config.tasks} />,
    where: <div className="grid gap-6">
      {runMode === 'screenreader' && <AtEnvironmentEditor environment={{ id: profile.id, name: profile.name, backend: profile.screenReader }} onChange={environment => onChange({ ...profile, screenReader: environment.backend })} capabilities={view.capabilities} compact />}
      <PageEnvironmentEditor environment={{ id: profile.id, name: profile.name, profile: profile.page }} onChange={environment => onChange({ ...profile, page: environment.profile })} presets={view.environmentPresets} compact />
    </div>,
    stop: <RunRulesEditor compact value={changedRules(profile.runRules)} inherited={runRulesSchema.parse({})}
      onChange={rules => onChange({ ...profile, runRules: { ...runRulesSchema.parse({}), ...rules } })} />,
  };
  return <div className="grid min-w-0 gap-3">
    <div role="tablist" aria-label={t('profile.questions.label')} className="grid gap-2 sm:grid-cols-2"
      onKeyDown={event => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        const next = QUESTIONS[(QUESTIONS.indexOf(open) + step + QUESTIONS.length) % QUESTIONS.length]!;
        setOpen(next); document.getElementById(`${id}-tab-${next}`)?.focus();
      }}>
      {QUESTIONS.map(question => <button key={question} id={`${id}-tab-${question}`} type="button" role="tab" aria-selected={open === question} aria-controls={`${id}-panel`}
        tabIndex={open === question ? 0 : -1} onClick={() => setOpen(question)}
        className={cn('grid content-start gap-1 rounded-md border px-3 py-2.5 text-left', open === question ? 'border-trace bg-trace-soft' : 'border-edge hover:border-edge-strong hover:bg-raised')}>
        <span className={cn('text-[13px] font-semibold', open === question && 'text-trace')}>{t(`profile.questions.${question}`)}</span>
        <span className="text-xs leading-5 text-muted-foreground">{summaries[question]}</span>
      </button>)}
    </div>
    <section id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${open}`} className="min-w-0 rounded-md border border-edge-strong px-4 py-4">
      {bodies[open]}
    </section>
  </div>;
}

/**
 * A row of choices, the picked one marked; a radio group for screen readers. `tabs` draws the top-level choice as underlined tabs;
 * otherwise the choices are small chips after a visible label.
 */
function Segments<T extends string>({ label, value, onChange, items, tabs }: { label: string; value: T; onChange: (value: T) => void; items: { id: T; name: string }[]; tabs?: boolean }) {
  if (tabs) return <div role="radiogroup" aria-label={label} className="flex gap-1 border-b border-edge">
    {items.map(item => <button key={item.id} type="button" role="radio" aria-checked={value === item.id} onClick={() => onChange(item.id)}
      className={cn('-mb-px border-b-2 px-3 pb-2 text-sm', value === item.id ? 'border-trace font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
      {item.name}
    </button>)}
  </div>;
  return <div className="flex flex-wrap items-center gap-2">
    <span aria-hidden="true" className="text-[13px] text-muted-foreground">{label}</span>
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map(item => <button key={item.id} type="button" role="radio" aria-checked={value === item.id} onClick={() => onChange(item.id)}
        className={cn('rounded-full border px-2.5 py-0.5 text-[13px]', value === item.id ? 'border-trace bg-trace-soft font-medium text-trace' : 'border-edge-strong hover:bg-raised')}>
        {item.name}
      </button>)}
    </div>
  </div>;
}
