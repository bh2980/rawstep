import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseConfig, projectAnalysisModel, type Executor } from '@rawstep/project/config';
import { ProjectStore } from '@rawstep/project/store';

const run = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const exists = (path: string) => access(path).then(() => true, () => false);
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const migrate = (dir: string) => run(process.execPath, ['scripts/migrate-config.mjs', dir]);

const executor = (modelId: string, inputs: string[]) => ({ connectionId: 'jev', modelId, inputs, maxChoices: 255, maxImages: 2, instructions: `Instructions for ${modelId}.` });
const policy = (extra: Record<string, unknown> = {}) => ({ historyLimit: 12, maxStateVisits: 5, maxUnchangedTransitions: 4, repetitionGuard: 'auto', modelGiveUp: false, focusGate: false, maxReplans: 2, stepActionLimit: 12, ...extra });
const keyboardOnly = { keys: ['Tab', 'Enter'], intents: [], typeText: false, replaceText: false };
const readerOnly = { keys: [], intents: ['next', 'activate'], typeText: false, replaceText: false };
const basic = { keyboard: { keys: ['Tab', 'Shift+Tab', 'Enter', 'Space'], intents: [], typeText: false, replaceText: false }, screenreader: { keys: [], intents: ['next', 'previous', 'activate'], typeText: false, replaceText: false } };
const taskFile = (goal: string) => ({ url: 'https://example.com', goal, verify: { all: [{ textVisible: 'Done' }] } });

/** A version 2 project: two agents (different actions, the second one plans), a page environment, an analysis model and a task with its own actions. */
const v2Config = () => ({
  version: 2,
  connections: [
    { id: 'jev', name: 'Jev', kind: 'decision', provider: 'custom', baseURL: 'http://127.0.0.1:1234', timeoutMs: 10000 },
    { id: 'writer', name: 'Writer', kind: 'llm', provider: 'custom', baseURL: 'http://127.0.0.1:1235/v1', timeoutMs: 10000 },
  ],
  agents: [
    { id: 'scout', name: 'Scout', executors: { keyboard: executor('jev-fast', ['text', 'image']), screenreader: executor('jev-fast', ['text']) },
      permissions: structuredClone(basic), policy: policy({ modelGiveUp: true, maxReplans: 3 }), environmentId: 'narrow' },
    { id: 'planner', name: 'Planner pair', planner: { connectionId: 'writer', modelId: 'plan-model', instructions: 'Plan briefly.' }, executors: { screenreader: executor('jev-slow', ['text']) },
      permissions: { keyboard: keyboardOnly, screenreader: readerOnly }, policy: policy({ focusGate: true, historyLimit: 20 }) },
  ],
  environments: [{ id: 'default', name: 'Default', profile: 'default' }, { id: 'narrow', name: 'Narrow', profile: 'narrow' }],
  analysis: { model: { connectionId: 'writer', modelId: 'analysis-model' }, instructions: 'Look at forms.' },
  tasks: [
    { id: 'checkout', name: 'Checkout', file: 'tasks/checkout.json', agentId: 'planner', environmentId: 'default',
      permissions: { keyboard: { keys: ['Tab'], intents: [], typeText: false, replaceText: false }, screenreader: null }, policy: { maxReplans: 6 } },
    { id: 'login', name: 'Login', file: 'tasks/login.json', permissions: { keyboard: null, screenreader: null } },
  ],
  machine: { backend: 'voiceover', atEndpoint: 'ws://127.0.0.1:9333', browserExecutablePath: '', headless: false, personCheck: false },
});
/** A dashboard record of one finished run, in the version 2 shape. */
const v2Experiment = () => ({
  id: 'exp-1', request: { taskIds: ['checkout'], agentIds: ['planner'], environmentIds: ['default'], mode: 'screenreader', repeat: 1 },
  runs: [{
    taskId: 'checkout', agentId: 'planner', environmentId: 'default', repeat: 1, permissions: readerOnly, plannerModel: { id: 'writer', name: 'Writer · plan-model', modelId: 'plan-model' }, plannerInstructions: 'Plan briefly.',
    snapshot: { taskName: 'Checkout', mode: 'screenreader', task: taskFile('Pay'), model: { id: 'jev', name: 'Jev · jev-slow', modelId: 'jev-slow' }, prompt: { id: 'planner.screenreader', name: 'Planner pair', version: 'abc123', instructions: 'Instructions for jev-slow.' },
      environment: 'default', globals: { policy: policy({ focusGate: true, historyLimit: 20 }), backend: 'voiceover', analysisInstructions: 'Look at forms.' } },
  }],
});

async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'rawstep-migrate-')); dirs.push(dir);
  await mkdir(join(dir, 'tasks')); await mkdir(join(dir, '.rawstep/experiments/exp-1'), { recursive: true });
  await writeFile(join(dir, 'tasks/checkout.json'), JSON.stringify(taskFile('Pay'))); await writeFile(join(dir, 'tasks/login.json'), JSON.stringify(taskFile('Log in')));
  await writeFile(join(dir, 'rawstep.config.json'), JSON.stringify(v2Config()));
  await writeFile(join(dir, '.rawstep/experiments/exp-1/experiment.json'), JSON.stringify(v2Experiment()));
  return dir;
}

describe('migrate-config.mjs', () => {
  it('converts a version 2 project into one that parses and reads as version 3', async () => {
    const dir = await project(), before = await readFile(join(dir, 'rawstep.config.json'), 'utf8');
    const { stdout } = await migrate(dir);
    expect(stdout).toMatch(/Converted .*rawstep\.config\.json: 2 model combos, 3 action sets, 2 page environments, 2 presets/);
    expect(await readFile(join(dir, 'rawstep.config.json.v2.bak'), 'utf8')).toBe(before);
    const raw = await json(join(dir, 'rawstep.config.json')), config = parseConfig(raw);
    expect(config.version).toBe(3);
    const { config: read } = await new ProjectStore(dir).read();
    expect(read).toEqual(config);

    // Agents become model combos, keeping their models, planner, history and focus gate.
    expect(config.combos.map(c => [c.id, c.structure])).toEqual([['scout', 'solo'], ['planner', 'planned']]);
    expect(config.combos[0]!.executors.keyboard).toMatchObject({ modelId: 'jev-fast', historyLimit: 12, focusGate: false, instructions: 'Instructions for jev-fast.' });
    expect(config.combos[1]).toMatchObject({ planner: { connectionId: 'writer', modelId: 'plan-model', instructions: 'Plan briefly.' }, executors: { screenreader: { modelId: 'jev-slow', historyLimit: 20 } } });
    expect(config.combos[1]!.executors.keyboard).toBeUndefined();

    // Each distinct set of permissions becomes a shared action set; the task's own override becomes a copy owned by it.
    expect(config.actionSets).toHaveLength(3);
    expect(config.actionSets[0]).toMatchObject({ id: 'basic', name: 'Basic', ...basic });
    const shared = config.actionSets[1]!;
    expect(shared).toMatchObject({ id: expect.stringMatching(/^actions-[0-9a-f]{8}$/), keyboard: keyboardOnly, screenreader: readerOnly }); expect(shared.owner).toBeUndefined();
    expect(config.actionSets[2]).toMatchObject({ id: 'checkout-actions', owner: 'checkout', copiedFrom: shared.id, keyboard: { keys: ['Tab'] }, screenreader: readerOnly });

    // Presets keep each agent's choices; rules that differ from the project's rules (the first agent's) stay with the preset.
    expect(config.runRules).toMatchObject({ modelGiveUp: true, maxReplans: 3, maxStateVisits: 5 });
    expect(config.presets).toEqual([
      expect.objectContaining({ id: 'scout', comboId: 'scout', actionSetId: 'basic', pageEnvironmentId: 'narrow', atEnvironmentId: 'voiceover' }),
      expect.objectContaining({ id: 'planner', comboId: 'planner', actionSetId: shared.id, atEnvironmentId: 'voiceover', runRules: { modelGiveUp: false, maxReplans: 2 } }),
    ]);
    expect(config.presets[1]!.pageEnvironmentId).toBeUndefined();

    // Tasks point at their preset and copy; their policy overrides become run rules.
    expect(config.tasks[0]).toMatchObject({ id: 'checkout', presetId: 'planner', actionSetId: 'checkout-actions', pageEnvironmentId: 'default', runRules: { maxReplans: 6 } });
    expect(config.tasks[1]).toEqual({ id: 'login', name: 'Login', file: 'tasks/login.json' });
    expect(config.pageEnvironments.map(e => [e.id, e.profile])).toEqual([['default', 'default'], ['narrow', 'narrow']]);

    // The native backend becomes an environment next to the simulation, and its address moves to the machine settings.
    expect(config.atEnvironments).toEqual([{ id: 'simulation', name: 'Simulated VoiceOver', backend: 'simulation' }, { id: 'voiceover', name: 'VoiceOver', backend: 'voiceover' }]);
    expect(config.machine).toMatchObject({ atEndpoints: { voiceover: 'ws://127.0.0.1:9333', nvda: '' }, headless: false });
    expect(raw.machine).not.toHaveProperty('backend'); expect(raw.machine).not.toHaveProperty('atEndpoint');

    // The analysis model and instructions move to the project settings.
    expect(config.project.analysis).toEqual({ model: { connectionId: 'writer', modelId: 'analysis-model' }, instructions: 'Look at forms.' });
    expect(projectAnalysisModel(config)).toMatchObject({ name: 'Writer · analysis-model' });
    for (const gone of ['agents', 'environments', 'analysis']) expect(raw).not.toHaveProperty(gone);
  });

  it('converts the dashboard run records with their conditions and keeps a backup', async () => {
    const dir = await project(), path = join(dir, '.rawstep/experiments/exp-1/experiment.json'), before = await readFile(path, 'utf8');
    const { stdout } = await migrate(dir);
    expect(stdout).toContain('Converted 1 experiment records.');
    expect(await readFile(`${path}.v2.bak`, 'utf8')).toBe(before);
    const experiment = await json(path), [record] = experiment.runs, config = await json(join(dir, 'rawstep.config.json'));
    const sharedId = config.actionSets[1].id;
    expect(experiment.request).toMatchObject({ modes: ['screenreader'], comboIds: ['planner'], pageEnvironmentIds: ['default'], taskIds: ['checkout'] });
    for (const gone of ['agentIds', 'environmentIds', 'mode']) expect(experiment.request).not.toHaveProperty(gone);
    expect(record).toMatchObject({ mode: 'screenreader', comboId: 'planner', actionSetId: sharedId, pageEnvironmentId: 'default', atEnvironmentId: 'voiceover', structure: 'planned', warnings: [],
      key: `checkout:screenreader:planner:${sharedId}:default:voiceover:1` });
    for (const gone of ['agentId', 'environmentId', 'plannerModel', 'plannerInstructions']) expect(record).not.toHaveProperty(gone);
    expect(record.snapshot.taskName).toBe('Checkout');
    expect(record.snapshot.spec).toMatchObject({
      mode: 'screenreader', backend: 'voiceover', task: { goal: 'Pay' }, model: { modelId: 'jev-slow' }, prompt: { id: 'planner.screenreader' }, environment: 'default',
      executor: { historyLimit: 20, focusGate: true }, permissions: readerOnly, plannerModel: { modelId: 'plan-model' }, plannerInstructions: 'Plan briefly.',
      settings: { machine: { atEndpoints: { voiceover: 'ws://127.0.0.1:9333' } }, runRules: { maxReplans: 2, maxStateVisits: 5 }, analysisInstructions: 'Look at forms.' },
    });
    expect(record.snapshot.spec.conditions).toMatchObject({
      combo: { id: 'planner', name: 'Planner pair', structure: 'planned', executor: 'Jev · jev-slow', planner: 'Writer · plan-model', prompt: { id: 'planner.screenreader', version: 'abc123' } },
      actionSet: { id: sharedId, permissions: readerOnly }, pageEnvironment: { id: 'default', profile: 'default' }, atEnvironment: { id: 'voiceover', backend: 'voiceover' },
      runRules: { maxReplans: 2 },
    });
  });

  it('does nothing to a project that is already version 3, and rewrites no record twice', async () => {
    const dir = await project(); await migrate(dir);
    const config = await readFile(join(dir, 'rawstep.config.json'), 'utf8'), record = await readFile(join(dir, '.rawstep/experiments/exp-1/experiment.json'), 'utf8');
    const { stdout } = await migrate(dir);
    expect(stdout).toContain('already version 3');
    expect(await readFile(join(dir, 'rawstep.config.json'), 'utf8')).toBe(config);
    expect(await readFile(join(dir, '.rawstep/experiments/exp-1/experiment.json'), 'utf8')).toBe(record);
    expect(await exists(join(dir, 'rawstep.config.json.v3.bak'))).toBe(false);
  });

  it('keeps each version 1 task\'s own prompt in a task-only combo and the remote browser address', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-migrate-')); dirs.push(dir);
    await mkdir(join(dir, 'tasks'));
    for (const name of ['a', 'b']) await writeFile(join(dir, `tasks/${name}.json`), JSON.stringify(taskFile(name)));
    const modes = (text: string) => ({ keyboard: { permissions: null, prompts: [{ id: 'p', name: 'P', version: '1', instructions: `${text} keys` }] },
      screenreader: { permissions: null, prompts: [{ id: 'p', name: 'P', version: '1', instructions: `${text} speech` }, { id: 'q', name: 'Q', version: '1', instructions: 'unused' }] } });
    await writeFile(join(dir, 'rawstep.config.json'), JSON.stringify({
      version: 1, connections: v2Config().connections,
      tasks: [{ id: 'a', name: 'A', file: 'tasks/a.json', modes: modes('Shared') }, { id: 'b', name: 'B', file: 'tasks/b.json', modes: modes('Own') }],
      profiles: [{ id: 'main', name: 'Main', permissions: basic, policy: policy(), environment: 'default',
        model: { connectionId: 'jev', modelId: 'jev-fast', inputs: ['text', 'image'], maxChoices: 255, maxImages: 2 } }],
      machine: { backend: 'simulation', atEndpoint: '', browserExecutablePath: '', browserEndpoint: 'http://localhost:9222', headless: true, personCheck: false },
    }));
    await migrate(dir);
    const config = parseConfig(await json(join(dir, 'rawstep.config.json')));
    expect(config.machine.browserEndpoint).toBe('http://localhost:9222');
    expect((config.combos.find(c => c.id === 'main')!.executors.screenreader as Executor).instructions).toBe('Shared speech');
    const taskA = config.tasks.find(t => t.id === 'a')!, taskB = config.tasks.find(t => t.id === 'b')!;
    expect(taskA.comboId).toBeUndefined();
    const own = config.combos.find(c => c.id === taskB.comboId)!;
    expect(own).toMatchObject({ owner: 'b', copiedFrom: 'main' });
    expect([(own.executors.screenreader as Executor).instructions, own.executors.keyboard!.instructions]).toEqual(['Own speech', 'Own keys']);
  });
  it('refuses a config of an unknown version without touching it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-migrate-')); dirs.push(dir);
    await writeFile(join(dir, 'rawstep.config.json'), JSON.stringify({ version: 9 }));
    await expect(migrate(dir)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('unknown version 9') });
    expect(await exists(join(dir, 'rawstep.config.json.v9.bak'))).toBe(false);
  });
});
