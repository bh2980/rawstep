import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import {
  DEFAULT_EXECUTOR_INSTRUCTIONS, defaultInputs, executorModel, followsPlan, isFilePlanner,
  type ActionSet, type AtBackend, type Combo, type Connection, type Executor, type Mode, type Profile, type RunRules,
} from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config.js';
import { i18n, t } from '../i18n/index.js';

/** The modes in the order screens list them: screen reader first (the planned structure works there). */
export const MODES = ['screenreader', 'keyboard'] as const;
export const AT_BACKENDS = ['simulation', 'voiceover', 'nvda'] as const satisfies readonly AtBackend[];
type Choice = { connectionId: string; modelId: string };

/** "connection · model ID" of a model choice, or undefined when there is none or its connection is gone. */
export function choiceName(choice: Choice | undefined, connections: readonly Connection[]): string | undefined {
  const connection = choice && connections.find(c => c.id === choice.connectionId);
  return connection && choice.modelId ? `${connection.name} · ${choice.modelId}` : undefined;
}
/** The model ID alone (what a list has room for), or the connection name while no ID is typed. */
function shortName(choice: Choice | undefined, connections: readonly Connection[]): string | undefined {
  const connection = choice && connections.find(c => c.id === choice.connectionId);
  return connection ? choice.modelId.trim() || connection.name : undefined;
}


/**
 * A model combo in one line, as lists show it: "계획 + 실행: gemini-flash → jev" or "단독: jev". With a mode, the models a run in that
 * mode uses (keyboard runs never plan yet).
 */
export function comboSummary(combo: Pick<Combo, 'planner' | 'executors'>, connections: readonly Connection[], mode: Mode): string {
  const planner = mode !== 'screenreader' ? undefined : isFilePlanner(combo.planner) ? t('conditions.summary.planFile', { path: combo.planner.planFile }) : shortName(combo.planner, connections) ?? t('conditions.summary.noModel');
  const executor = followsPlan(combo, mode) ? t('conditions.combo.pipeline.followPlan') : shortName(executorModel(combo, mode), connections);
  if (!executor) return t('conditions.summary.noExecutorIn', { mode: t(`conditions.modes.${mode}`) });
  return planner ? t('conditions.summary.planned', { planner, executor }) : t('conditions.summary.solo', { executor });
}

/**
 * Whether a profile looks ready to run in its own mode: it has an executor for the mode and, for a screen reader run (which always
 * plans), a plan file or a planner model on an existing connection.
 */
export function profileReady(profile: Pick<Profile, 'mode' | 'planner' | 'executors'>, connections: readonly Connection[]): boolean {
  if (!comboModesOf(profile, connections).includes(profile.mode)) return false;
  if (profile.mode !== 'screenreader' || isFilePlanner(profile.planner)) return true;
  const planner = profile.planner;
  return !!planner && !!planner.modelId.trim() && connections.some(c => c.id === planner.connectionId && c.kind === 'llm');
}

/**
 * The modes a combo can run, as the server decides them (`comboModes` in @rawstep/project/plan, which the web bundle cannot import):
 * an executor on an existing connection that takes what the mode sends (text, or two images for keyboard mode).
 */
export function comboModesOf(combo: Pick<Combo, 'executors'>, connections: readonly Connection[]): Mode[] {
  return MODES.filter(mode => {
    if (followsPlan(combo, mode)) return true;
    const executor = executorModel(combo, mode);
    if (!executor || !executor.modelId.trim() || !connections.some(c => c.id === executor.connectionId)) return false;
    return mode === 'keyboard' ? executor.inputs.includes('image') && executor.maxImages >= 2 : executor.inputs.includes('text');
  });
}

/** A fresh executor on a connection: no model ID yet, what the provider passes, and the built-in instructions of the mode. */
export function blankExecutor(connection: Connection, mode: Mode): Executor {
  return { connectionId: connection.id, modelId: '', inputs: defaultInputs(connection), maxChoices: 255, maxImages: 2, instructions: DEFAULT_EXECUTOR_INSTRUCTIONS[mode], historyLimit: RAWSTEP_DEFAULTS.policy.historyLimit, focusGate: false, latitude: 'none' };
}

/** Actions a backend lacks, per mode and backend: keyboard mode has one backend; screen reader mode has three. */
export function unsupportedActions(actionSet: Pick<ActionSet, 'keyboard' | 'screenreader'>, capabilities: ConfigView['capabilities']): { keyboard: string[]; screenreader: Record<AtBackend, string[]> } {
  const missing = (p: ActionSet['keyboard'], c: { keys: readonly string[]; intents: readonly string[] }) => [...p.keys.filter(k => !c.keys.includes(k)), ...p.intents.filter(i => !c.intents.includes(i))];
  return {
    keyboard: missing(actionSet.keyboard, capabilities.keyboard),
    screenreader: Object.fromEntries(AT_BACKENDS.map(backend => [backend, missing(actionSet.screenreader, capabilities.screenreader[backend])])) as Record<AtBackend, string[]>,
  };
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positive = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** The page size an environment runs at: its own viewport, a built-in preset it names, or the default. */
export function environmentViewport(profile: unknown, presets: Record<string, unknown>): { width: number; height: number } {
  const environment = typeof profile === 'string' ? record(presets[profile]) : record(profile);
  const viewport = record(environment.viewport);
  return { width: positive(viewport.width, RAWSTEP_DEFAULTS.viewport.width), height: positive(viewport.height, RAWSTEP_DEFAULTS.viewport.height) };
}

/** The run rules in one line: the repetition guard, its limits, giving up, and the planning limits. */
export function runRulesSummary(rules: RunRules): string {
  return t('conditions.summary.runRules', {
    guard: t(`conditions.runRules.guard.${rules.repetitionGuard}`), visits: rules.maxStateVisits, unchanged: rules.maxUnchangedTransitions,
    giveUp: t(rules.modelGiveUp ? 'conditions.summary.giveUpOn' : 'conditions.summary.giveUpOff'), calls: rules.maxPlannerCalls, actions: rules.stepActionLimit,
  });
}

/** The label of a screen reader intent such as `heading.next`; an unknown one is shown as recorded. */
export function actionLabel(intent: string): string {
  const key = `conditions.intents.${intent}`;
  return i18n.exists(key) && typeof i18n.t(key as 'conditions.intents.next') === 'string' ? i18n.t(key as 'conditions.intents.next') : intent;
}

/**
 * The profiles a person can start from. Every one plans (screen reader runs always do): Rawstep follows the plan, or a decision model
 * or an LLM picks within each task. Model IDs stay empty: the person types or picks them, and saving waits for them.
 */
export const COMBO_PRESETS = ['plannedFollow', 'plannedDecision', 'plannedLlm'] as const;
export type ComboPreset = (typeof COMBO_PRESETS)[number];

/** A new combo from a starting point, on the first connection of each kind the project has. */
export function comboFromPreset(preset: ComboPreset, id: string, name: string, connections: readonly Connection[]): Combo {
  const decision = connections.find(c => c.kind === 'decision'), llm = connections.find(c => c.kind === 'llm');
  const executor = preset === 'plannedDecision' ? decision : preset === 'plannedLlm' ? llm : undefined;
  return { id, name, structure: 'planned', ...(llm ? { planner: { connectionId: llm.id, modelId: '', instructions: '' } } : {}),
    executors: { screenreader: executor ? blankExecutor(executor, 'screenreader') : { followPlan: true } } };
}

/** Why a combo cannot be saved yet, if it cannot: no name, a picked model without its ID, empty instructions. A missing planner only stops runs. */
export function comboBlocker(combo: Pick<Combo, 'name' | 'planner' | 'executors'>): 'name' | 'modelId' | 'instructions' | undefined {
  const executors = MODES.flatMap(mode => executorModel(combo, mode) ? [executorModel(combo, mode)!] : []);
  if (!combo.name.trim()) return 'name';
  if ((combo.planner && !isFilePlanner(combo.planner) && !combo.planner.modelId.trim()) || executors.some(e => !e.modelId.trim())) return 'modelId';
  if (executors.some(e => !e.instructions.trim())) return 'instructions';
  return undefined;
}

/** Whether two plain values are equal, whatever order their keys were written in (edits rebuild objects in other orders). */
export function sameValue(a: unknown, b: unknown): boolean {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, stable(v)])) : value;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
