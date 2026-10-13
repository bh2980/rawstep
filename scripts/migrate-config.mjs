#!/usr/bin/env node
// One-off: converts an older project to version 4 (connections, run profiles, tasks, project models), with its dashboard run
// records. Version 1 (run profiles) and 2 (agents) go through version 3 (model combos, action sets, environments, presets) first.
// Usage: node scripts/migrate-config.mjs <project-dir>
// Writes rawstep.config.json and each .rawstep/experiments/*/experiment.json in place, keeping a .bak copy of each original.
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');
const configPath = join(dir, 'rawstep.config.json');
const source = await readFile(configPath, 'utf8').catch(() => undefined);
if (source === undefined) { console.error(`No rawstep.config.json in ${dir}. Pass the project folder that holds it.`); process.exit(1); }
const original = JSON.parse(source);
if (original.version === 4) { console.log(`${configPath} is already version 4; nothing to do.`); process.exit(0); }
if (![1, 2, 3].includes(original.version)) { console.error(`${configPath} has unknown version ${original.version}.`); process.exit(1); }
if (original.version !== 3) await toV3();
await toV4();

async function toV3() {

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
}

/**
 * v3 → v4: every distinct set of conditions a task or preset ran with becomes one run profile — model combo (without its own analysis
 * model), action set, page and AT environment, and the project's run rules with the preset's and the task's overrides on top.
 * Presets keep their name; a task with its own picks gets "<task> 프로필". Run records name their profile.
 */
async function toV4() {
  const v3 = JSON.parse(await readFile(configPath, 'utf8'));
  const first = list => list.find(item => !item.owner) ?? list[0];
  const find = (list, id) => list.find(item => item.id === id);
  const profiles = [], profileOf = new Map();
  const strip = ({ id: _id, name: _name, owner: _owner, copiedFrom: _from, analysis: _analysis, ...rest }) => rest;
  function profileFor(picks, name, id) {
    const combo = find(v3.combos, picks.comboId) ?? first(v3.combos), actionSet = find(v3.actionSets, picks.actionSetId) ?? first(v3.actionSets);
    const page = find(v3.pageEnvironments, picks.pageEnvironmentId) ?? first(v3.pageEnvironments), at = find(v3.atEnvironments, picks.atEnvironmentId) ?? first(v3.atEnvironments);
    const runRules = { ...v3.runRules, ...picks.presetRules, ...picks.taskRules };
    const body = { ...strip(combo), actions: { keyboard: actionSet.keyboard, screenreader: actionSet.screenreader }, page: page.profile, screenReader: at.backend, runRules };
    const key = JSON.stringify(body);
    if (!profileOf.has(key)) {
      const taken = new Set(profiles.map(p => p.id));
      let unique = id, n = 2; while (taken.has(unique)) unique = `${id}-${n++}`;
      profiles.push({ id: unique, name, ...body });
      profileOf.set(key, unique);
    }
    return profileOf.get(key);
  }
  const presetPicks = preset => ({ comboId: preset.comboId, actionSetId: preset.actionSetId, pageEnvironmentId: preset.pageEnvironmentId, atEnvironmentId: preset.atEnvironmentId, presetRules: preset.runRules });
  const fallback = profileFor({}, 'Default', 'default');
  for (const preset of v3.presets ?? []) profileFor(presetPicks(preset), preset.name, preset.id);
  const tasks = v3.tasks.map(({ presetId, comboId, actionSetId, pageEnvironmentId, atEnvironmentId, runRules, ...task }) => {
    const preset = find(v3.presets ?? [], presetId);
    const picks = { ...(preset ? presetPicks(preset) : {}), ...(comboId ? { comboId } : {}), ...(actionSetId ? { actionSetId } : {}), ...(pageEnvironmentId ? { pageEnvironmentId } : {}), ...(atEnvironmentId ? { atEnvironmentId } : {}), taskRules: runRules };
    const own = comboId || actionSetId || pageEnvironmentId || atEnvironmentId || runRules;
    const profileId = profileFor(picks, own ? `${task.name} 프로필` : preset?.name ?? 'Default', own ? `${task.id}-profile` : preset?.id ?? 'default');
    return { ...task, ...(profileId !== fallback ? { profileId } : {}) };
  });
  const next = { version: 4, connections: v3.connections, profiles, tasks, project: v3.project, machine: v3.machine };
  await copyFile(configPath, `${configPath}.v3.bak`);
  await writeFile(configPath, JSON.stringify(next, null, 2) + '\n');
  console.log(`Converted ${configPath} to version 4: ${profiles.length} run profiles.`);

  // Run records: the profile each run is named after (its preset's, else its combo's name), kept apart from the recorded conditions.
  const experimentsDir = join(dir, '.rawstep', 'experiments');
  let converted = 0;
  for (const id of await readdir(experimentsDir).catch(() => [])) {
    const path = join(experimentsDir, id, 'experiment.json');
    let experiment;
    try { experiment = JSON.parse(await readFile(path, 'utf8')); } catch { continue; }
    if (experiment.runs?.every(run => run.profileId)) continue;
    for (const run of experiment.runs ?? []) {
      const conditions = run.snapshot?.spec?.conditions ?? {};
      const named = conditions.preset ?? conditions.combo ?? { id: run.comboId ?? 'default', name: run.comboId ?? 'Default' };
      run.profileId = named.id;
      if (run.snapshot?.spec) run.snapshot.spec.conditions = { profile: { id: named.id, name: named.name }, ...conditions };
      for (const key of ['comboId', 'actionSetId', 'pageEnvironmentId', 'atEnvironmentId', 'presetId']) delete run[key];
      run.key = [run.taskId, run.mode, run.profileId, run.repeat].join(':');
    }
    // A request's preset (or, failing that, combo) choice names the profiles made from them; ids no profile has are dropped.
    const { comboIds, actionSetIds: _a, pageEnvironmentIds: _p, atEnvironmentIds: _e, presetIds, ...request } = experiment.request ?? {};
    const profileIds = (presetIds ?? comboIds ?? []).filter(id => profiles.some(p => p.id === id));
    experiment.request = { ...request, ...(profileIds.length ? { profileIds } : {}) };
    await copyFile(path, `${path}.v3.bak`);
    await writeFile(path, JSON.stringify(experiment, null, 2) + '\n');
    converted++;
  }
  console.log(`Converted ${converted} experiment records to version 4.`);
}
