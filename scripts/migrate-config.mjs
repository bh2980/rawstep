#!/usr/bin/env node
// One-off: converts a version 1 (run profiles) or version 2 (agents) project to version 3 (model combos, action sets, page and
// assistive-technology environments, run rules, presets, project models), with its dashboard run records.
// Usage: node scripts/migrate-config.mjs <project-dir>
// Writes rawstep.config.json and each .rawstep/experiments/*/experiment.json in place, keeping a .bak copy of each original.
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');
const configPath = join(dir, 'rawstep.config.json');
const original = JSON.parse(await readFile(configPath, 'utf8'));
if (original.version === 3) { console.log(`${configPath} is already version 3; nothing to do.`); process.exit(0); }
if (original.version !== 1 && original.version !== 2) { console.error(`${configPath} has unknown version ${original.version}.`); process.exit(1); }

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 8);
const RULE_KEYS = ['repetitionGuard', 'maxStateVisits', 'maxUnchangedTransitions', 'modelGiveUp', 'maxReplans', 'stepActionLimit'];
const rulesOf = policy => Object.fromEntries(RULE_KEYS.filter(k => policy?.[k] !== undefined).map(k => [k, policy[k]]));

// v1 → v2 shape (agents, environments, analysis), kept minimal: only what v2 → v3 reads.
function toV2(config) {
  if (config.version === 2) return config;
  const reference = config.tasks[0];
  const prompt = mode => reference?.modes?.[mode]?.prompts?.[0]?.instructions;
  const environmentOf = new Map(), environments = [];
  for (const p of config.profiles) {
    const key = JSON.stringify(p.environment ?? 'default');
    if (environmentOf.has(key)) continue;
    const id = typeof p.environment === 'string' ? p.environment : `env-${hash(key)}`;
    environments.push({ id, name: typeof p.environment === 'string' ? (p.environment === 'default' ? 'Default' : p.environment) : p.name, profile: p.environment ?? 'default' });
    environmentOf.set(key, id);
  }
  const agents = config.profiles.map(p => {
    const executors = {};
    for (const mode of ['screenreader', 'keyboard']) {
      const ok = p.model && prompt(mode) && (mode === 'screenreader' ? p.model.inputs.includes('text') : p.model.inputs.includes('image'));
      if (ok) executors[mode] = { ...p.model, instructions: prompt(mode) };
    }
    return { id: p.id, name: p.name, ...(p.plannerModel ? { planner: { ...p.plannerModel, instructions: '' } } : {}), executors, permissions: p.permissions, policy: p.policy, environmentId: environmentOf.get(JSON.stringify(p.environment ?? 'default')) };
  });
  const analysisProfile = config.profiles.find(p => p.analysisModel);
  return { version: 2, connections: config.connections, agents, environments, machine: config.machine,
    analysis: { ...(analysisProfile ? { model: analysisProfile.analysisModel } : {}), instructions: analysisProfile?.analysisInstructions ?? '' },
    tasks: config.tasks.map(({ profileId, modes, ...task }) => ({ ...task, ...(profileId ? { agentId: profileId, environmentId: agents.find(a => a.id === profileId)?.environmentId } : {}),
      permissions: { keyboard: modes?.keyboard?.permissions ?? null, screenreader: modes?.screenreader?.permissions ?? null },
      // v1 prompts belonged to tasks (a run used the first one of its mode); kept so v3 can give a task with its own a task-only combo.
      instructions: { screenreader: modes?.screenreader?.prompts?.[0]?.instructions, keyboard: modes?.keyboard?.prompts?.[0]?.instructions } })) };
}

const v2 = toV2(original);
const firstPolicy = v2.agents[0]?.policy ?? {};
const runRules = rulesOf(firstPolicy);
// Model combos keep the agent's models; its actions become shared action sets (one per distinct set); its stop rules become a
// preset when they differ from the project's, so every old agent is still one pick away.
const actionSets = [], actionOf = new Map();
for (const agent of v2.agents) {
  const key = JSON.stringify(agent.permissions);
  if (actionOf.has(key)) continue;
  const id = actionSets.length ? `actions-${hash(key)}` : 'basic';
  actionSets.push({ id, name: actionSets.length ? `${agent.name} 행동` : 'Basic', ...agent.permissions });
  actionOf.set(key, id);
}
const combos = v2.agents.map(agent => {
  const executors = {};
  for (const [mode, executor] of Object.entries(agent.executors ?? {})) executors[mode] = { ...executor, historyLimit: agent.policy?.historyLimit ?? 12, focusGate: mode === 'keyboard' ? !!agent.policy?.focusGate : false };
  return { id: agent.id, name: agent.name, structure: agent.planner ? 'planned' : 'solo', ...(agent.planner ? { planner: agent.planner } : {}), executors };
});
const backend = v2.machine?.backend ?? 'simulation';
const atEnvironments = [{ id: 'simulation', name: 'Simulated VoiceOver', backend: 'simulation' }, ...(backend !== 'simulation' ? [{ id: backend, name: backend === 'voiceover' ? 'VoiceOver' : 'NVDA', backend }] : [])];
const pageEnvironments = v2.environments.map(e => ({ id: e.id, name: e.name, profile: e.profile }));
const presets = v2.agents.map(agent => {
  const own = rulesOf(agent.policy), diff = Object.fromEntries(Object.entries(own).filter(([k, v]) => runRules[k] !== v));
  return { id: agent.id, name: agent.name, comboId: agent.id, actionSetId: actionOf.get(JSON.stringify(agent.permissions)),
    ...(agent.environmentId ? { pageEnvironmentId: agent.environmentId } : {}), atEnvironmentId: backend, ...(Object.keys(diff).length ? { runRules: diff } : {}) };
});
// Task permission overrides become task-only action sets; task policy overrides become task run rules.
const tasks = v2.tasks.map(({ agentId, environmentId, permissions, policy, instructions, ...task }) => {
  const agent = v2.agents.find(a => a.id === agentId) ?? v2.agents[0];
  // A task whose own prompt differs from its combo's executor instructions keeps it in a task-only copy of that combo.
  const base = combos.find(c => c.id === agent?.id);
  let comboId;
  const own = Object.entries(instructions ?? {}).filter(([mode, text]) => text && base?.executors[mode] && base.executors[mode].instructions !== text);
  if (base && own.length) {
    comboId = `${task.id}-combo`;
    const executors = structuredClone(base.executors);
    for (const [mode, text] of own) executors[mode].instructions = text;
    combos.push({ ...structuredClone(base), id: comboId, name: `${task.name} 모델 조합`, owner: task.id, copiedFrom: base.id, executors });
  }
  let actionSetId;
  if (permissions && (permissions.keyboard || permissions.screenreader)) {
    actionSetId = `${task.id}-actions`;
    actionSets.push({ id: actionSetId, name: `${task.name} 행동`, owner: task.id, copiedFrom: actionOf.get(JSON.stringify(agent.permissions)),
      keyboard: permissions.keyboard ?? agent.permissions.keyboard, screenreader: permissions.screenreader ?? agent.permissions.screenreader });
  }
  const rules = rulesOf(policy);
  return { ...task, ...(agentId ? { presetId: agentId } : {}), ...(comboId ? { comboId } : {}), ...(actionSetId ? { actionSetId } : {}), ...(environmentId ? { pageEnvironmentId: environmentId } : {}),
    ...(Object.keys(rules).length ? { runRules: rules } : {}) };
});
const machine = { atEndpoints: { voiceover: backend === 'voiceover' ? v2.machine.atEndpoint ?? '' : '', nvda: backend === 'nvda' ? v2.machine.atEndpoint ?? '' : '' },
  browserExecutablePath: v2.machine?.browserExecutablePath ?? '', browserEndpoint: v2.machine?.browserEndpoint ?? '', headless: v2.machine?.headless ?? true, personCheck: v2.machine?.personCheck ?? false };
const next = { version: 3, connections: v2.connections, tasks, combos, actionSets, pageEnvironments, atEnvironments, presets,
  runRules, project: { analysis: { ...(v2.analysis?.model ? { model: v2.analysis.model } : {}), instructions: v2.analysis?.instructions ?? '' }, suggestions: {} }, machine };
await copyFile(configPath, `${configPath}.v${original.version}.bak`);
await writeFile(configPath, JSON.stringify(next, null, 2) + '\n');
console.log(`Converted ${configPath}: ${combos.length} model combos, ${actionSets.length} action sets, ${pageEnvironments.length} page environments, ${presets.length} presets.`);

// Run records → { combo/action/environment ids, mode, structure, snapshot: { taskName, spec } }.
const experimentsDir = join(dir, '.rawstep', 'experiments');
let converted = 0;
for (const id of await readdir(experimentsDir).catch(() => [])) {
  const path = join(experimentsDir, id, 'experiment.json');
  let experiment;
  try { experiment = JSON.parse(await readFile(path, 'utf8')); } catch { continue; }
  if (experiment.runs?.every(run => run.snapshot?.spec)) continue;
  for (const run of experiment.runs) {
    const old = run.snapshot, mode = old.mode;
    const agentId = run.agentId ?? run.profileId ?? old.agent?.id ?? old.runProfile?.id;
    const agent = v2.agents.find(a => a.id === agentId);
    const pageEnvironmentId = run.environmentId ?? old.environmentRef?.id ?? pageEnvironments[0].id;
    const globals = old.globals ?? {};
    const spec = { task: old.task, mode, model: old.model, prompt: old.prompt,
      executor: { historyLimit: globals.policy?.historyLimit ?? 12, focusGate: !!globals.policy?.focusGate },
      settings: { machine, runRules: { ...runRules, ...rulesOf(globals.policy) }, analysisInstructions: globals.analysisInstructions ?? run.analysisInstructions ?? '' },
      environment: old.environment ?? old.profile, backend: globals.backend ?? backend, permissions: run.permissions,
      ...(run.plannerModel ? { plannerModel: run.plannerModel, plannerInstructions: run.plannerInstructions ?? '' } : {}), ...(run.diagnoseStop ? { diagnoseStop: true } : {}) };
    const comboId = agentId ?? combos[0].id, actionSetId = agent ? actionOf.get(JSON.stringify(agent.permissions)) : actionSets[0].id, atEnvironmentId = spec.backend;
    const at = atEnvironments.find(e => e.id === atEnvironmentId) ?? { id: atEnvironmentId, name: atEnvironmentId, backend: atEnvironmentId };
    spec.conditions = { combo: { id: comboId, name: agent?.name ?? old.agent?.name ?? old.runProfile?.name ?? comboId, structure: spec.plannerModel ? 'planned' : 'solo', executor: old.model?.name,
        ...(old.prompt ? { prompt: { id: old.prompt.id, version: old.prompt.version } } : {}), ...(spec.plannerModel ? { planner: spec.plannerModel.name } : {}) },
      actionSet: { id: actionSetId, name: actionSets.find(x => x.id === actionSetId)?.name ?? actionSetId, permissions: run.permissions },
      pageEnvironment: { id: pageEnvironmentId, name: old.environmentRef?.name ?? pageEnvironments.find(e => e.id === pageEnvironmentId)?.name ?? pageEnvironmentId, profile: spec.environment },
      atEnvironment: at, runRules: spec.settings.runRules };
    for (const key of ['agentId', 'profileId', 'promptId', 'environmentId', 'permissionSource', 'plannerModel', 'plannerInstructions', 'diagnoseStop']) delete run[key];
    Object.assign(run, { mode, comboId, actionSetId, pageEnvironmentId, atEnvironmentId, structure: spec.plannerModel ? 'planned' : 'solo', warnings: [],
      key: [run.taskId, mode, comboId, actionSetId, pageEnvironmentId, atEnvironmentId, run.repeat].join(':'), snapshot: { taskName: old.taskName, spec } });
  }
  const { agentIds, profileIds, environmentIds, promptIds, mode, ...request } = experiment.request;
  experiment.request = { ...request, modes: [mode ?? experiment.runs[0]?.mode ?? 'keyboard'], ...(agentIds ?? profileIds ? { comboIds: agentIds ?? profileIds } : {}), ...(environmentIds ? { pageEnvironmentIds: environmentIds } : {}) };
  await copyFile(path, `${path}.v${original.version}.bak`);
  await writeFile(path, JSON.stringify(experiment, null, 2) + '\n');
  converted++;
}
console.log(`Converted ${converted} experiment records.`);
