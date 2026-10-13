import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseConfig, projectAnalysisModel, type Executor, type Profile } from '@rawstep/project/config';
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
  it('converts a version 2 project into one that parses and reads as version 5', async () => {
    const dir = await project(), before = await readFile(join(dir, 'rawstep.config.json'), 'utf8');
    const { stdout } = await migrate(dir);
    expect(stdout).toMatch(/Converted .*rawstep\.config\.json: 2 model combos, 3 action sets, 2 page environments, 2 presets/);
    expect(stdout).toMatch(/Converted .*rawstep\.config\.json to version 5: tasks no longer name a profile; 4 profiles carry their mode/);
    expect(await readFile(join(dir, 'rawstep.config.json.v2.bak'), 'utf8')).toBe(before);
    expect(await exists(join(dir, 'rawstep.config.json.v3.bak'))).toBe(true);
    const raw = await json(join(dir, 'rawstep.config.json')), config = parseConfig(raw);
    expect(config.version).toBe(5);
    expect(await exists(join(dir, 'rawstep.config.json.v4.bak'))).toBe(true);
    const { config: read } = await new ProjectStore(dir).read();
    expect(read).toEqual(config);

    // The first conditions become the default profile; each agent's choices and the task's own picks become profiles of their own.
    expect(config.profiles.map(p => [p.id, p.structure])).toEqual([['default', 'solo'], ['scout', 'solo'], ['planner', 'planned'], ['checkout-profile', 'planned']]);
    const [fallback, scout, planner, own] = config.profiles as [Profile, Profile, Profile, Profile];
    expect(scout.executors.keyboard).toMatchObject({ modelId: 'jev-fast', historyLimit: 12, focusGate: false, instructions: 'Instructions for jev-fast.' });
    expect(planner).toMatchObject({ planner: { connectionId: 'writer', modelId: 'plan-model', instructions: 'Plan briefly.' }, executors: { screenreader: { modelId: 'jev-slow', historyLimit: 20 } } });
    expect(planner.executors.keyboard).toBeUndefined();
    expect(fallback.executors).toEqual(scout.executors);

    // Actions, page and screen reader come along; the project's rules are in every profile with each agent's own on top.
    expect(scout.actions).toEqual(basic); expect(planner.actions).toEqual({ keyboard: keyboardOnly, screenreader: readerOnly });
    expect(own.actions).toEqual({ keyboard: { ...keyboardOnly, keys: ['Tab'] }, screenreader: readerOnly });
    expect([scout.page, planner.page, own.page]).toEqual(['narrow', 'default', 'default']);
    expect([fallback.screenReader, scout.screenReader, planner.screenReader, own.screenReader]).toEqual(['simulation', 'voiceover', 'voiceover', 'voiceover']);
    expect(scout.runRules).toMatchObject({ modelGiveUp: true, maxReplans: 3, maxStateVisits: 5 });
    expect(planner.runRules).toMatchObject({ modelGiveUp: false, maxReplans: 2, maxStateVisits: 5 });
    expect(own.runRules).toMatchObject({ modelGiveUp: false, maxReplans: 6 });

    // Each profile carries the mode it runs in; the planner has no keyboard executor, the others have both.
    expect(config.profiles.map(p => [p.id, p.mode])).toEqual([['default', 'screenreader'], ['scout', 'screenreader'], ['planner', 'screenreader'], ['checkout-profile', 'screenreader']]);

    // Tasks name no profile any more, even the one that had its own.
    expect(config.tasks[0]).toEqual({ id: 'checkout', name: 'Checkout', file: 'tasks/checkout.json' });
    expect(config.tasks[1]).toEqual({ id: 'login', name: 'Login', file: 'tasks/login.json' });
    for (const gone of ['combos', 'actionSets', 'pageEnvironments', 'atEnvironments', 'presets', 'runRules']) expect(raw).not.toHaveProperty(gone);

    // The native backend's address moves to the machine settings.
    expect(config.machine).toMatchObject({ atEndpoints: { voiceover: 'ws://127.0.0.1:9333', nvda: '' }, headless: false });
    expect(raw.machine).not.toHaveProperty('backend'); expect(raw.machine).not.toHaveProperty('atEndpoint');

    // The analysis model and instructions are the project's.
    expect(config.project.analysis).toEqual({ model: { connectionId: 'writer', modelId: 'analysis-model' }, instructions: 'Look at forms.' });
    expect(projectAnalysisModel(config)).toMatchObject({ name: 'Writer · analysis-model' });
    for (const gone of ['agents', 'environments', 'analysis']) expect(raw).not.toHaveProperty(gone);
  });

  it('converts the dashboard run records with their conditions and keeps a backup', async () => {
    const dir = await project(), path = join(dir, '.rawstep/experiments/exp-1/experiment.json'), before = await readFile(path, 'utf8');
    const { stdout } = await migrate(dir);
    expect(stdout).toContain('Converted 1 experiment records.'); expect(stdout).toContain('Converted 1 experiment records to version 5.');
    expect(await readFile(`${path}.v2.bak`, 'utf8')).toBe(before);
    const experiment = await json(path), [record] = experiment.runs;
    expect(await exists(`${path}.v3.bak`)).toBe(true); expect(await exists(`${path}.v4.bak`)).toBe(true);
    expect(experiment.request).toMatchObject({ taskIds: ['checkout'], profileIds: ['planner'] });
    for (const gone of ['modes', 'agentIds', 'environmentIds', 'mode', 'comboIds', 'pageEnvironmentIds', 'presetIds']) expect(experiment.request).not.toHaveProperty(gone);
    expect(record).toMatchObject({ mode: 'screenreader', profileId: 'planner', structure: 'planned', warnings: [], key: 'checkout:screenreader:planner:1' });
    for (const gone of ['agentId', 'environmentId', 'plannerModel', 'plannerInstructions', 'comboId', 'actionSetId', 'pageEnvironmentId', 'atEnvironmentId', 'presetId']) expect(record).not.toHaveProperty(gone);
    expect(record.snapshot.taskName).toBe('Checkout');
    expect(record.snapshot.spec).toMatchObject({
      mode: 'screenreader', backend: 'voiceover', task: { goal: 'Pay' }, model: { modelId: 'jev-slow' }, prompt: { id: 'planner.screenreader' }, environment: 'default',
      executor: { historyLimit: 20, focusGate: true }, permissions: readerOnly, plannerModel: { modelId: 'plan-model' }, plannerInstructions: 'Plan briefly.',
      settings: { machine: { atEndpoints: { voiceover: 'ws://127.0.0.1:9333' } }, runRules: { maxReplans: 2, maxStateVisits: 5 }, analysisInstructions: 'Look at forms.' },
    });
    expect(record.snapshot.spec.conditions).toMatchObject({
      profile: { id: 'planner', name: 'Planner pair' },
      combo: { id: 'planner', name: 'Planner pair', structure: 'planned', executor: 'Jev · jev-slow', planner: 'Writer · plan-model', prompt: { id: 'planner.screenreader', version: 'abc123' } },
      actionSet: { permissions: readerOnly }, pageEnvironment: { id: 'default', profile: 'default' }, atEnvironment: { id: 'voiceover', backend: 'voiceover' },
      runRules: { maxReplans: 2 },
    });
  });

  it('does nothing to a project that is already version 5, and rewrites no record twice', async () => {
    const dir = await project(); await migrate(dir);
    const config = await readFile(join(dir, 'rawstep.config.json'), 'utf8'), record = await readFile(join(dir, '.rawstep/experiments/exp-1/experiment.json'), 'utf8');
    const { stdout } = await migrate(dir);
    expect(stdout).toContain('already version 5');
    expect(await readFile(join(dir, 'rawstep.config.json'), 'utf8')).toBe(config);
    expect(await readFile(join(dir, '.rawstep/experiments/exp-1/experiment.json'), 'utf8')).toBe(record);
    expect(await exists(join(dir, 'rawstep.config.json.v5.bak'))).toBe(false);
  });

  it('keeps each version 1 task\'s own prompt in a profile of its own and the remote browser address', async () => {
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
    const taskA = config.tasks.find(t => t.id === 'a')!, taskB = config.tasks.find(t => t.id === 'b')!;
    const first = config.profiles[0]!, own = config.profiles.find(p => p.id === 'b-profile')!;
    expect(taskA).not.toHaveProperty('profileId'); expect(taskB).not.toHaveProperty('profileId');
    expect((first.executors.screenreader as Executor).instructions).toBe('Shared speech');
    expect(own).toMatchObject({ id: 'b-profile', name: 'B 프로필' });
    expect([(own.executors.screenreader as Executor).instructions, own.executors.keyboard!.instructions]).toEqual(['Own speech', 'Own keys']);
  });

  /** A version 3 project: a preset, tasks that take it and one with picks of its own, and rules at all three levels. */
  const v3Config = () => {
    const model = { connectionId: 'jev', modelId: 'jev-fast', inputs: ['text', 'image'], maxChoices: 255, maxImages: 2, historyLimit: 12, focusGate: false, latitude: 'none', instructions: 'Keys.' };
    return {
      version: 3,
      connections: v2Config().connections,
      combos: [
        { id: 'default', name: 'Default', structure: 'solo', executors: { keyboard: model, screenreader: model } },
        { id: 'zoom', name: 'Zoom check', structure: 'solo', executors: { keyboard: { ...model, modelId: 'jev-slow' } }, analysis: { connectionId: 'writer', modelId: 'own' } },
      ],
      actionSets: [{ id: 'basic', name: 'Basic', ...basic }, { id: 'wide', name: 'Wide', keyboard: keyboardOnly, screenreader: readerOnly }, { id: 'mine', name: 'Mine', owner: 'login', copiedFrom: 'basic', ...basic }],
      pageEnvironments: [{ id: 'default', name: 'Default', profile: 'default' }, { id: 'narrow', name: 'Narrow', profile: 'narrow' }],
      atEnvironments: [{ id: 'simulation', name: 'Simulated VoiceOver', backend: 'simulation' }, { id: 'nvda', name: 'NVDA', backend: 'nvda' }],
      runRules: { maxReplans: 4, failureLimit: 3 },
      presets: [{ id: 'strict', name: 'Strict', comboId: 'zoom', pageEnvironmentId: 'narrow', runRules: { maxReplans: 1 } }],
      tasks: [
        { id: 'checkout', name: 'Checkout', file: 'tasks/checkout.json', presetId: 'strict' },
        { id: 'cart', name: 'Cart', file: 'tasks/cart.json', presetId: 'strict' },
        { id: 'login', name: 'Login', file: 'tasks/login.json', presetId: 'strict', actionSetId: 'wide', atEnvironmentId: 'nvda', runRules: { failureLimit: 9 } },
        { id: 'plain', name: 'Plain', file: 'tasks/plain.json' },
      ],
      project: { analysis: { model: { connectionId: 'writer', modelId: 'analysis-model' }, instructions: 'Look at forms.' }, suggestions: {} },
      machine: { atEndpoints: { voiceover: '', nvda: '' }, browserExecutablePath: '', headless: true, browserEndpoint: '', personCheck: false },
    };
  };
  it('converts a version 3 project: one run profile per distinct set of conditions, rules merged project, preset, task', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-migrate-')); dirs.push(dir);
    await mkdir(join(dir, 'tasks')); await mkdir(join(dir, '.rawstep/experiments/exp-1'), { recursive: true });
    for (const name of ['checkout', 'cart', 'login', 'plain']) await writeFile(join(dir, `tasks/${name}.json`), JSON.stringify(taskFile(name)));
    await writeFile(join(dir, 'rawstep.config.json'), JSON.stringify(v3Config()));
    const before = await readFile(join(dir, 'rawstep.config.json'), 'utf8');
    const record = { id: 'exp-1', request: { taskIds: ['checkout'], presetIds: ['strict'], comboIds: ['zoom'], modes: ['keyboard'], repeat: 1 },
      runs: [{ taskId: 'checkout', presetId: 'strict', comboId: 'zoom', actionSetId: 'basic', pageEnvironmentId: 'narrow', atEnvironmentId: 'simulation', mode: 'keyboard', repeat: 1, key: 'old',
        snapshot: { spec: { conditions: { preset: { id: 'strict', name: 'Strict' }, combo: { id: 'zoom', name: 'Zoom check' } } } } }] };
    await writeFile(join(dir, '.rawstep/experiments/exp-1/experiment.json'), JSON.stringify(record));

    const { stdout } = await migrate(dir);
    expect(stdout).toMatch(/Converted .*rawstep\.config\.json to version 5: tasks no longer name a profile; 3 profiles carry their mode/);
    expect(await readFile(join(dir, 'rawstep.config.json.v3.bak'), 'utf8')).toBe(before);
    const raw = await json(join(dir, 'rawstep.config.json')), config = parseConfig(raw);
    expect((await new ProjectStore(dir).read()).config).toEqual(config);
    expect(config.version).toBe(5);
    for (const gone of ['combos', 'actionSets', 'pageEnvironments', 'atEnvironments', 'presets', 'runRules']) expect(raw).not.toHaveProperty(gone);

    // The first items make the default profile; the preset keeps its id and name; the task with its own picks gets a profile named after it.
    expect(config.profiles.map(p => [p.id, p.name])).toEqual([['default', 'Default'], ['strict', 'Strict'], ['login-profile', 'Login 프로필']]);
    const [fallback, strict, own] = config.profiles as [Profile, Profile, Profile];
    expect(fallback).toMatchObject({ page: 'default', screenReader: 'simulation', actions: basic, runRules: { maxReplans: 4, failureLimit: 3 } });
    expect(strict).toMatchObject({ page: 'narrow', screenReader: 'simulation', actions: basic, executors: { keyboard: { modelId: 'jev-slow' } }, runRules: { maxReplans: 1, failureLimit: 3 } });
    expect(strict).not.toHaveProperty('analysis'); expect(strict).not.toHaveProperty('owner');
    expect(own).toMatchObject({ page: 'narrow', screenReader: 'nvda', actions: { keyboard: keyboardOnly, screenreader: readerOnly }, executors: { keyboard: { modelId: 'jev-slow' } }, runRules: { maxReplans: 1, failureLimit: 9 } });

    // A profile with only a keyboard executor runs in keyboard mode, one with both in screen reader mode.
    expect(config.profiles.map(p => [p.id, p.mode])).toEqual([['default', 'screenreader'], ['strict', 'keyboard'], ['login-profile', 'keyboard']]);

    // Tasks name no profile any more: the profiles they used remain, to be picked when a run starts.
    for (const task of raw.tasks) expect(task).not.toHaveProperty('profileId');
    expect(config.tasks.map(t => t.id)).toEqual(['checkout', 'cart', 'login', 'plain']);
    for (const gone of ['presetId', 'comboId', 'actionSetId', 'pageEnvironmentId', 'atEnvironmentId', 'runRules']) for (const task of raw.tasks) expect(task).not.toHaveProperty(gone);
    expect(config.project.analysis.model).toEqual({ connectionId: 'writer', modelId: 'analysis-model' });

    // Run records name their profile after the preset they ran with.
    const path = join(dir, '.rawstep/experiments/exp-1/experiment.json'), experiment = await json(path);
    expect(await exists(`${path}.v3.bak`)).toBe(true); expect(await exists(`${path}.v4.bak`)).toBe(true);
    expect(experiment.request).toEqual({ taskIds: ['checkout'], profileIds: ['strict'], repeat: 1 });
    expect(experiment.runs[0]).toMatchObject({ profileId: 'strict', key: 'checkout:keyboard:strict:1' });
    for (const gone of ['presetId', 'comboId', 'actionSetId', 'pageEnvironmentId', 'atEnvironmentId']) expect(experiment.runs[0]).not.toHaveProperty(gone);
    expect(experiment.runs[0].snapshot.spec.conditions).toMatchObject({ profile: { id: 'strict', name: 'Strict' }, preset: { id: 'strict' }, combo: { id: 'zoom' } });
  });
  it('converts a version 4 project by dropping task profiles and giving each profile its mode', async () => {
    const dir = await project(); await migrate(dir);
    const v5 = await json(join(dir, 'rawstep.config.json')), path = join(dir, '.rawstep/experiments/exp-1/experiment.json'), record = await json(path);
    const keyboardOnlyProfile = { ...v5.profiles[0], id: 'keys', name: 'Keys', executors: { keyboard: v5.profiles[0].executors.keyboard } };
    const v4 = { ...v5, version: 4, profiles: [...v5.profiles.map(({ mode: _mode, ...profile }: { mode: string }) => profile), (({ mode: _mode, ...profile }) => profile)(keyboardOnlyProfile)],
      tasks: v5.tasks.map((t: object) => ({ ...t, profileId: 'planner' })) };
    await writeFile(join(dir, 'rawstep.config.json'), JSON.stringify(v4));
    await writeFile(path, JSON.stringify({ ...record, request: { ...record.request, modes: ['screenreader'] } }));
    for (const stale of ['rawstep.config.json.v4.bak', '.rawstep/experiments/exp-1/experiment.json.v4.bak']) await rm(join(dir, stale));

    const { stdout } = await migrate(dir);
    expect(stdout).toContain('to version 5: tasks no longer name a profile;'); expect(stdout).toContain('Converted 1 experiment records to version 5.');
    expect(await json(join(dir, 'rawstep.config.json.v4.bak'))).toEqual(v4);
    const config = parseConfig(await json(join(dir, 'rawstep.config.json')));
    expect(config.profiles.map(p => [p.id, p.mode])).toEqual([...v5.profiles.map((p: { id: string; mode: string }) => [p.id, p.mode]), ['keys', 'keyboard']]);
    for (const task of config.tasks) expect(task).not.toHaveProperty('profileId');
    const experiment = await json(path);
    expect(experiment.request).not.toHaveProperty('modes'); expect(experiment.request).toMatchObject({ taskIds: ['checkout'], profileIds: ['planner'] });
  });
  it('refuses a config of an unknown version without touching it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-migrate-')); dirs.push(dir);
    await writeFile(join(dir, 'rawstep.config.json'), JSON.stringify({ version: 9 }));
    await expect(migrate(dir)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('unknown version 9') });
    expect(await exists(join(dir, 'rawstep.config.json.v9.bak'))).toBe(false);
  });
});
