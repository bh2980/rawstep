#!/usr/bin/env node
// One-off: converts a version 1 project (run profiles) to version 2 (agents, environments, project analysis).
// Usage: node scripts/migrate-config-v2.mjs <project-dir>
// Writes rawstep.config.json and each .rawstep/experiments/*/experiment.json in place, keeping a .v1.bak copy of each.
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');
const configPath = join(dir, 'rawstep.config.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (config.version !== 1) { console.log(`${configPath} is version ${config.version}; nothing to do.`); process.exit(0); }

const firstPrompt = (task, mode) => task?.modes?.[mode]?.prompts?.[0]?.instructions;
const executor = (model, instructions) => model && instructions ? { ...model, instructions } : undefined;
// Executor instructions come from the first task's prompts: v1 kept them per task, v2 per agent.
const reference = config.tasks[0];
const agents = config.profiles.map(profile => {
  const executors = {};
  for (const mode of ['screenreader', 'keyboard']) {
    const instructions = firstPrompt(reference, mode);
    // A text-only model cannot serve keyboard mode, which sends screenshots.
    if (profile.model && instructions && (mode === 'screenreader' ? profile.model.inputs.includes('text') : profile.model.inputs.includes('image'))) executors[mode] = executor(profile.model, instructions);
  }
  return { id: profile.id, name: profile.name, ...(profile.plannerModel ? { planner: { ...profile.plannerModel, instructions: '' } } : {}), executors, permissions: profile.permissions, policy: profile.policy };
});
const environments = [];
const environmentOf = new Map();
for (const profile of config.profiles) {
  const key = JSON.stringify(profile.environment ?? 'default');
  if (!environmentOf.has(key)) {
    const id = typeof profile.environment === 'string' ? profile.environment : `env-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
    environments.push({ id, name: typeof profile.environment === 'string' ? (profile.environment === 'default' ? 'Default' : profile.environment) : profile.name, profile: profile.environment ?? 'default' });
    environmentOf.set(key, id);
  }
}
const analysisProfile = config.profiles.find(p => p.analysisModel);
const next = {
  version: 2,
  connections: config.connections,
  tasks: config.tasks.map(({ profileId, modes, ...task }) => {
    const profile = config.profiles.find(p => p.id === profileId);
    return { ...task, ...(profileId ? { agentId: profileId } : {}), ...(profile ? { environmentId: environmentOf.get(JSON.stringify(profile.environment ?? 'default')) } : {}),
      permissions: { keyboard: modes?.keyboard?.permissions ?? null, screenreader: modes?.screenreader?.permissions ?? null } };
  }),
  agents, environments,
  analysis: { ...(analysisProfile ? { model: analysisProfile.analysisModel } : {}), instructions: analysisProfile?.analysisInstructions ?? '' },
  machine: config.machine,
};
await copyFile(configPath, `${configPath}.v1.bak`);
await writeFile(configPath, JSON.stringify(next, null, 2) + '\n');
console.log(`Converted ${configPath}: ${agents.length} agents, ${environments.length} environments.`);

// Run records: snapshot.profile → environment, runProfile → agent, profileId/promptId → agentId/environmentId.
const experimentsDir = join(dir, '.rawstep', 'experiments');
let converted = 0;
for (const id of await readdir(experimentsDir).catch(() => [])) {
  const path = join(experimentsDir, id, 'experiment.json');
  let experiment;
  try { experiment = JSON.parse(await readFile(path, 'utf8')); } catch { continue; }
  if (!experiment.runs?.some(run => run.snapshot?.runProfile)) continue;
  for (const run of experiment.runs) {
    const { profile, runProfile, ...snapshot } = run.snapshot;
    const environmentId = environmentOf.get(JSON.stringify(config.profiles.find(p => p.id === run.profileId)?.environment ?? 'default')) ?? 'default';
    run.snapshot = { ...snapshot, environment: profile, agent: runProfile, environmentRef: { id: environmentId, name: environments.find(e => e.id === environmentId)?.name ?? environmentId } };
    run.agentId = run.profileId; run.environmentId = environmentId;
    if (run.permissionSource === 'profile') run.permissionSource = 'agent';
    delete run.profileId; delete run.promptId;
    run.key = [run.taskId, run.agentId, run.environmentId, run.repeat].join(':');
  }
  const { promptIds, profileIds, ...request } = experiment.request;
  experiment.request = { ...request, ...(profileIds ? { agentIds: profileIds } : {}) };
  await copyFile(path, `${path}.v1.bak`);
  await writeFile(path, JSON.stringify(experiment, null, 2) + '\n');
  converted++;
}
console.log(`Converted ${converted} experiment records.`);
