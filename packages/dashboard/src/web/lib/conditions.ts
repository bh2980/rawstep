import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import {
  DEFAULT_EXECUTOR_INSTRUCTIONS, executorModel, followsPlan, isFilePlanner,
  type ActionSet, type AtBackend, type Combo, type Connection, type Executor, type Profile,
} from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config.js';
import { i18n, t } from '../i18n/index.js';

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


/** A model combo in one line, as lists show it: "계획 + 실행: gemini-flash → jev". */
export function comboSummary(combo: Pick<Combo, 'planner' | 'executor'>, connections: readonly Connection[]): string {
  const planner = isFilePlanner(combo.planner) ? t('conditions.summary.planFile', { path: combo.planner.planFile }) : shortName(combo.planner, connections) ?? t('conditions.summary.noModel');
  const executor = followsPlan(combo) ? t('conditions.combo.pipeline.followPlan') : shortName(executorModel(combo), connections);
  if (!executor) return t('conditions.summary.noExecutor');
  return t('conditions.summary.planned', { planner, executor });
}

/**
 * Whether a profile looks ready to run: it has an executor (as the server decides it in @rawstep/project/plan, which the web bundle
 * cannot import: the plan follower, or a model ID on an existing connection) and a plan file or a planner model on an existing connection.
 */
export function profileReady(profile: Pick<Profile, 'planner' | 'executor'>, connections: readonly Connection[]): boolean {
  if (!hasExecutor(profile, connections)) return false;
  if (isFilePlanner(profile.planner)) return true;
  const planner = profile.planner;
  return !!planner && !!planner.modelId.trim() && connections.some(c => c.id === planner.connectionId && c.kind === 'llm');
}

/** Whether a combo has an executor it can run with: the plan follower, or a model ID on an existing connection. */
export function hasExecutor(combo: Pick<Combo, 'executor'>, connections: readonly Connection[]): boolean {
  if (followsPlan(combo)) return true;
  const executor = executorModel(combo);
  return !!executor && !!executor.modelId.trim() && connections.some(c => c.id === executor.connectionId);
}

/** A fresh executor on a connection: no model ID yet and the built-in instructions. */
export function blankExecutor(connection: Connection): Executor {
  return { connectionId: connection.id, modelId: '', maxChoices: 255, instructions: DEFAULT_EXECUTOR_INSTRUCTIONS, historyLimit: RAWSTEP_DEFAULTS.policy.historyLimit, latitude: 'none' };
}

/** Actions each screen reader backend lacks. */
export function unsupportedActions(actionSet: Pick<ActionSet, 'actions'>, capabilities: ConfigView['capabilities']): Record<AtBackend, string[]> {
  const { keys, intents } = actionSet.actions;
  return Object.fromEntries(AT_BACKENDS.map(backend => [backend, [...keys.filter(k => !capabilities[backend].keys.includes(k)), ...intents.filter(i => !capabilities[backend].intents.includes(i))]])) as Record<AtBackend, string[]>;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positive = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** The page size an environment runs at: its own viewport, a built-in preset it names, or the default. */
export function environmentViewport(profile: unknown, presets: Record<string, unknown>): { width: number; height: number } {
  const environment = typeof profile === 'string' ? record(presets[profile]) : record(profile);
  const viewport = record(environment.viewport);
  return { width: positive(viewport.width, RAWSTEP_DEFAULTS.viewport.width), height: positive(viewport.height, RAWSTEP_DEFAULTS.viewport.height) };
}

/** The label of a screen reader intent such as `heading.next`; an unknown one is shown as recorded. */
export function actionLabel(intent: string): string {
  const key = `conditions.intents.${intent}`;
  return i18n.exists(key) && typeof i18n.t(key as 'conditions.intents.next') === 'string' ? i18n.t(key as 'conditions.intents.next') : intent;
}

/**
 * The profiles a person can start from. Every one plans (runs always do): Rawstep follows the plan, or a decision model
 * or an LLM picks within each task. Model IDs stay empty: the person types or picks them, and saving waits for them.
 */
export const COMBO_PRESETS = ['plannedFollow', 'plannedDecision', 'plannedLlm'] as const;
export type ComboPreset = (typeof COMBO_PRESETS)[number];

/** A new combo from a starting point, on the first connection of each kind the project has. */
export function comboFromPreset(preset: ComboPreset, id: string, name: string, connections: readonly Connection[]): Combo {
  const decision = connections.find(c => c.kind === 'decision'), llm = connections.find(c => c.kind === 'llm');
  const executor = preset === 'plannedDecision' ? decision : preset === 'plannedLlm' ? llm : undefined;
  return { id, name, ...(llm ? { planner: { connectionId: llm.id, modelId: '', instructions: '' } } : {}),
    executor: executor ? blankExecutor(executor) : { followPlan: true } };
}

/** Why a combo cannot be saved yet, if it cannot: no name, a picked model without its ID, empty instructions. A missing planner only stops runs. */
export function comboBlocker(combo: Pick<Combo, 'name' | 'planner' | 'executor'>): 'name' | 'modelId' | 'instructions' | undefined {
  const executor = executorModel(combo);
  if (!combo.name.trim()) return 'name';
  if ((combo.planner && !isFilePlanner(combo.planner) && !combo.planner.modelId.trim()) || (executor && !executor.modelId.trim())) return 'modelId';
  if (executor && !executor.instructions.trim()) return 'instructions';
  return undefined;
}

/** Whether two plain values are equal, whatever order their keys were written in (edits rebuild objects in other orders). */
export function sameValue(a: unknown, b: unknown): boolean {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, stable(v)])) : value;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
