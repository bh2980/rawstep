import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { screenshotChoices } from '@rawstep/policies/screenshot/policy';
import { speechChoices } from '@rawstep/policies/systemone';
import { validateDecision } from '@rawstep/browser/runner';
import { TraceRecorder, readTrace } from '@rawstep/core/trace';
import {
  CONFIG_FILE, configSchema, defaultConfig, defaultModes, defaultProfile, findByIdOrName, parseConfig, resolveRepetitionGuard, taskProfile,
  type ProjectConfig,
} from '@rawstep/project/config';
import { ProjectError } from '@rawstep/project/errors';
import { ProjectStore, initProject } from '@rawstep/project/store';
import { discover } from '@rawstep/project/discover';
import { assertRunnable, backendCapabilities, checkRun, defaultPrompt, resolvePermissions, supportsMode } from '@rawstep/project/plan';
import { runTask } from '@rawstep/project/run';
import type { RunExecutor, RunSpec } from '@rawstep/project/execution';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function root() { const r = await mkdtemp(join(tmpdir(), 'rawstep-project-')); dirs.push(r); return r; }
const task = { url: 'https://example.com', goal: 'Complete fixture', input: { email: 'private-value' }, verify: { all: [{ titleIncludes: 'Done' }] } };
function setup(): ProjectConfig {
  const config = defaultConfig();
  config.connections.push({ id: 'local', name: 'Local', provider: 'systemone', baseURL: 'http://127.0.0.1:1234', timeoutMs: 10000 });
  for (const id of ['a', 'b']) config.models.push({ id, connectionId: 'local', name: id, modelId: id, family: 'SystemOne', protocol: 'systemone-http', inputs: ['text', 'image'], capabilitySource: 'manual', maxChoices: 255, maxImages: 2, roles: ['decision'], promptEditable: true });
  const modes = defaultModes(); modes.keyboard.prompts.push({ id: 'careful', name: 'Careful', version: '2', instructions: 'Careful fixture instructions' });
  config.tasks.push({ id: 'task', name: 'Fixture', file: 'task.json', modes }); return config;
}

describe('project store', () => {
  it('detects external writes and keeps keys out of config responses', async () => {
    const dir = await root(); const store = new ProjectStore(dir); const first = await store.initialize();
    await writeFile(store.path, JSON.stringify({ ...first.config, machine: { ...first.config.machine, headless: false } }));
    await expect(store.save(first.config, first.revision)).rejects.toMatchObject({ code: 'config-conflict', status: 409 });
    await store.setCredential('RAWSTEP_TEST_KEY', 'secret-fixture-value');
    expect(await store.credential('RAWSTEP_TEST_KEY')).toBe('secret-fixture-value');
    expect(JSON.stringify(await store.read())).not.toContain('secret-fixture-value');
    const reread = new ProjectStore(dir); expect((await reread.read()).config.machine.headless).toBe(false);
  });
  it('rejects paths outside the project and symlink escapes', async () => {
    const dir = await root(), other = await root(); const store = new ProjectStore(dir); await store.initialize();
    await expect(store.file('../outside.json')).rejects.toMatchObject({ code: expect.stringMatching(/outside-project/), status: 400 });
    await symlink(other, join(dir, 'link'));
    await expect(store.file('link/task.json')).rejects.toMatchObject({ code: expect.stringMatching(/outside-project/), status: 400 });
  });
  it('keeps the project config in rawstep.config.json and reports a missing one with the way to create it', async () => {
    const dir = await root(), store = new ProjectStore(dir);
    expect(CONFIG_FILE).toBe('rawstep.config.json'); expect(store.path).toBe(join(dir, 'rawstep.config.json'));
    const missing = await store.read().catch(e => e as ProjectError);
    expect(missing).toBeInstanceOf(ProjectError); expect(missing).toMatchObject({ code: 'no-config', status: 404 }); expect((missing as Error).message).toMatch(/rawstep init.*rawstep ui/);
    await store.initialize();
    expect(JSON.parse(await readFile(join(dir, 'rawstep.config.json'), 'utf8'))).toEqual(defaultConfig());
  });
  it('writes a default config once and never overwrites an existing one', async () => {
    const dir = await root();
    expect(await initProject(dir)).toBe(join(dir, 'rawstep.config.json'));
    await expect(initProject(dir)).rejects.toMatchObject({ code: 'config-exists' });
    await writeFile(join(dir, 'rawstep.config.json'), '{"mine":true}');
    await expect(initProject(dir)).rejects.toBeInstanceOf(ProjectError);
    expect(await readFile(join(dir, 'rawstep.config.json'), 'utf8')).toBe('{"mine":true}');
  });
  it('reads an invalid or old-version config as an error naming the file, and a missing task file as 404', async () => {
    const dir = await root(), store = new ProjectStore(dir);
    await writeFile(store.path, JSON.stringify({ ...defaultConfig(), version: 2 }));
    await expect(store.read()).rejects.toMatchObject({ code: 'invalid-config' });
    await writeFile(store.path, JSON.stringify({ ...setup() }));
    await expect(store.read()).rejects.toMatchObject({ code: 'task-file-missing', status: 404 });
  });
  it('throws plain project errors with a status hint, never HTTP errors', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.tasks[0]!.profileId = 'ghost';
    const error = await store.save(config, initial.revision, { file: 'task.json', task }).catch(e => e as ProjectError);
    expect(error).toBeInstanceOf(ProjectError); expect(error).toMatchObject({ code: 'task-profile-missing', status: 400 });
    config.tasks[0]!.profileId = 'default'; config.profiles.push(defaultProfile());
    await expect(store.save(config, initial.revision, { file: 'task.json', task })).rejects.toMatchObject({ code: 'duplicate-id' });
    await expect(store.save(setup(), initial.revision, { file: 'rawstep.config.json', task })).rejects.toMatchObject({ code: 'task-file-reserved' });
    expect(() => store.validateReferences({ ...setup(), profiles: [{ ...defaultProfile(), environment: 'no-such-environment' }] })).toThrow();
  });
});

describe('model discovery', () => {
  it('only confirms advertised model inputs and omits credential echoes', async () => {
    const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'vision-by-name-only' }, { id: 'vision-confirmed', inputs: ['text', 'image'] }, { id: 'PRIVATE_DISCOVERY_KEY' }] })); });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    try {
      const models = await discover({ id: 'local', name: 'local', provider: 'openai', baseURL: 'http://127.0.0.1:' + (server.address() as { port: number }).port, timeoutMs: 1000 }, 'PRIVATE_DISCOVERY_KEY');
      expect(models).toHaveLength(2); expect(models[0]!.inputs).toEqual(['text']); expect(models[0]!.capabilitySource).toBe('manual'); expect(models[1]!.inputs).toEqual(['text', 'image']);
      expect(JSON.stringify(models)).not.toContain('PRIVATE_DISCOVERY_KEY');
    } finally { server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); }
  });
  it('sorts discovered models into protocols and ignores a missing decisions route', async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.url!); res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'chat-model', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }, { id: 'gateway/eval', type: 'evaluation' }] }));
      else if (req.url === '/v1/models?output_modalities=decisions') res.end(JSON.stringify({ data: [{ id: 'one/decider', architecture: { input_modalities: ['text'], output_modalities: ['decisions'] } }] }));
      else { res.statusCode = 404; res.end('{}'); }
    });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    try {
      const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1';
      const models = await discover({ id: 'c', name: 'c', provider: 'openai', baseURL: base, timeoutMs: 1000 });
      expect(models.map(m => [m.modelId, m.family, m.protocol])).toEqual([['chat-model', 'LLM', 'chat'], ['gateway/eval', 'SystemOne', 'vercel-evaluation'], ['one/decider', 'SystemOne', 'openrouter-decisions']]);
      expect((await discover({ id: 's', name: 's', provider: 'systemone', baseURL: base, timeoutMs: 1000 })).every(m => m.protocol === 'systemone-http' && m.family === 'SystemOne')).toBe(true);
      // Servers without the decisions route (LM Studio, Ollama, OpenAI) still list their chat models.
      seen.length = 0;
      const plain = createServer((req, res) => { res.setHeader('content-type', 'application/json'); if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'local' }] })); else { res.statusCode = 404; res.end('nope'); } });
      await new Promise<void>(accept => plain.listen(0, '127.0.0.1', accept));
      try { expect((await discover({ id: 'p', name: 'p', provider: 'openai', baseURL: 'http://127.0.0.1:' + (plain.address() as { port: number }).port + '/v1', timeoutMs: 1000 })).map(m => [m.modelId, m.protocol])).toEqual([['local', 'chat']]); }
      finally { plain.closeAllConnections(); await new Promise<void>(accept => plain.close(() => accept())); }
    } finally { server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); }
  });
  it('answers an unreachable server with a bad-gateway project error', async () => {
    await expect(discover({ id: 'x', name: 'x', provider: 'openai', baseURL: 'http://127.0.0.1:1/v1', timeoutMs: 500 })).rejects.toMatchObject({ code: 'model-unreachable', status: 502 });
  });
});

describe('permissions', () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])('independently restricts type=%s and replace=%s in candidates and execution', (typeText, replaceText) => {
    const config = setup(), permissions = resolvePermissions(config, config.profiles[0]!, task, 'keyboard', { keys: [], intents: [], inputKeys: ['email'], typeText, replaceText });
    for (const candidates of [screenshotChoices(permissions as Required<typeof permissions>), speechChoices(permissions as Required<typeof permissions>)]) {
      expect(candidates.some(c => c.id === 'type:email')).toBe(typeText);
      expect(candidates.some(c => c.id === 'replace:email')).toBe(replaceText);
    }
    const check = (kind: 'typeText' | 'replaceText') => () => validateDecision({ action: { kind, input: 'email' } }, permissions as Required<typeof permissions>);
    if (typeText) expect(check('typeText')).not.toThrow(); else expect(check('typeText')).toThrow();
    if (replaceText) expect(check('replaceText')).not.toThrow(); else expect(check('replaceText')).toThrow();
    expect(permissions.keys).toEqual([]);
    expect(resolvePermissions(config, config.profiles[0]!, task, 'keyboard', null).keys).toEqual(config.profiles[0]!.permissions.keyboard.keys);
  });
});

describe('project config', () => {
  it('loads a saved config without the new policy fields and defaults them', async () => {
    const dir = await root(), store = new ProjectStore(dir), first = await store.initialize();
    const old = JSON.parse(JSON.stringify(first.config)); delete old.profiles[0].policy.repetitionGuard; delete old.profiles[0].policy.modelGiveUp;
    await writeFile(store.path, JSON.stringify(old));
    const policy = (await new ProjectStore(dir).read()).config.profiles[0]!.policy;
    expect(policy).toMatchObject({ repetitionGuard: 'auto', modelGiveUp: true });
    expect(defaultConfig().profiles[0]!.policy).toMatchObject({ repetitionGuard: 'auto', modelGiveUp: true });
    expect(() => configSchema.parse({ ...old, profiles: [{ ...old.profiles[0], policy: { ...old.profiles[0].policy, repetitionGuard: 'sometimes' } }] })).toThrow();
  });
  it('resolves auto by model protocol and honours explicit on/off', () => {
    const chat = { protocol: 'chat' as const }, decisions = { protocol: 'systemone-http' as const }, choose = { protocol: 'choose' as const };
    expect(resolveRepetitionGuard('auto', decisions)).toBe(false);
    expect(resolveRepetitionGuard('auto', { protocol: 'openrouter-decisions' })).toBe(false);
    expect(resolveRepetitionGuard('auto', chat)).toBe(true);
    expect(resolveRepetitionGuard('auto', choose)).toBe(true);
    expect(resolveRepetitionGuard('on', decisions)).toBe(true);
    expect(resolveRepetitionGuard('off', chat)).toBe(false);
  });
  it('accepts only version 1 configs', () => {
    const config = defaultConfig();
    expect(config.version).toBe(1);
    expect(parseConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(() => parseConfig({ ...config, version: 2 })).toThrow();
    expect(() => parseConfig({ version: 1, connections: [], models: [], tasks: [], globals: {}, environments: [] })).toThrow();
  });
  it('finds models and profiles by id first, then by name', () => {
    const list = [{ id: 'one', name: 'two' }, { id: 'two', name: 'one' }];
    expect(findByIdOrName(list, 'one')).toBe(list[0]); expect(findByIdOrName(list, 'two')).toBe(list[1]); expect(findByIdOrName(list, 'three')).toBeUndefined();
    const config = { ...defaultConfig(), tasks: setup().tasks };
    expect(taskProfile(config, { profileId: 'gone' }).id).toBe('default');
  });
});

describe('run checks', () => {
  const modelOf = (config: ProjectConfig, id = 'a') => config.models.find(m => m.id === id)!;
  const check = (config: ProjectConfig, change: (c: ProjectConfig) => void = () => {}, extra: Partial<Parameters<typeof checkRun>[0]> = {}) => {
    change(config);
    return checkRun({ config, task: task as never, taskEntry: config.tasks[0], model: modelOf(config), profile: config.profiles[0]!, prompt: defaultPrompt(config.tasks[0], 'keyboard'), mode: 'keyboard', ...extra });
  };
  it('accepts a supported combination and returns its settings', () => {
    const result = check(setup());
    expect(result.problem).toBeUndefined(); expect(result.settings.policy.historyLimit).toBeGreaterThan(0); expect(result.connection.id).toBe('local');
    expect(assertRunnable(result).permissions.keys).toContain('Tab');
  });
  it.each([
    ['model-needs-images', (c: ProjectConfig) => { modelOf(c).inputs = ['text']; modelOf(c).maxImages = 0; }],
    ['analysis-only-model', (c: ProjectConfig) => { modelOf(c).roles = ['analysis']; }],
    ['too-many-choices', (c: ProjectConfig) => { modelOf(c).maxChoices = 4; }],
    ['protocol-mismatch', (c: ProjectConfig) => { modelOf(c).protocol = 'chat'; }],
    ['vercel-text-only', (c: ProjectConfig) => { modelOf(c).protocol = 'vercel-evaluation'; c.connections[0]!.provider = 'openai'; }],
    ['unsupported-action', (c: ProjectConfig) => { c.profiles[0]!.permissions.keyboard.keys = ['F13']; }],
    ['focus-gate-llm', (c: ProjectConfig) => { Object.assign(modelOf(c), { family: 'LLM', protocol: 'chat' }); c.connections[0]!.provider = 'openai'; c.profiles[0]!.policy.focusGate = true; }],
    ['environment-unsupported', (c: ProjectConfig) => { c.profiles[0]!.environment = 'zoom-200'; }],
  ])('reports %s as the problem, not by throwing', (code, change) => {
    const result = check(setup(), change);
    expect(result.problem).toBeInstanceOf(ProjectError); expect(result.problem!.code).toBe(code);
    expect(() => assertRunnable(result)).toThrow(result.problem!);
    expect(result.permissions).toBeDefined();
  });
  it('reports an unusable analysis model and stop diagnosis in screen reader mode', () => {
    const config = setup();
    expect(check(config, () => {}, { analysisModel: modelOf(config, 'b') }).problem?.code).toBe('analysis-model-invalid');
    expect(check(setup(), () => {}, { mode: 'screenreader', diagnoseStop: true }).problem?.code).toBe('diagnose-keyboard-only');
  });
  it('knows which models can serve a mode', () => {
    const config = setup(), a = modelOf(config);
    expect(supportsMode(a, 'keyboard')).toBe(true); expect(supportsMode(a, 'screenreader')).toBe(true);
    expect(supportsMode({ ...a, inputs: ['text'], maxImages: 0 }, 'keyboard')).toBe(false);
    expect(supportsMode({ ...a, roles: ['analysis'] }, 'screenreader')).toBe(false);
    expect(supportsMode({ ...a, protocol: 'choose' }, 'screenreader')).toBe(false);
    expect(supportsMode({ ...a, protocol: 'vercel-evaluation' }, 'keyboard')).toBe(false);
  });
  it('lists the backend capabilities of each mode', () => {
    const config = defaultConfig();
    expect(backendCapabilities(config, 'keyboard').keys).toContain('Tab');
    expect(backendCapabilities(config, 'screenreader').intents).toContain('next');
    expect(backendCapabilities({ machine: { backend: 'voiceover' } }, 'screenreader').intents.length).toBeGreaterThan(0);
  });
});

describe('runTask', () => {
  const png = (label: string) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(label)]).toString('base64');
  /** A recorded run: a key per step, each followed by a screenshot, ending with the given outcome. */
  const recorded = (keys: string[], status: 'success' | 'failure', reason?: string) => async (spec: RunSpec, outDir: string) => {
    const trace = new TraceRecorder({ ...spec.task, id: spec.task.id ?? 'fixture', mode: spec.mode }, outDir); await trace.initialize();
    trace.append('keyboard.observation', { screenshot: { pngBase64: png('start') } }, { source: 'runner' });
    keys.forEach((key, i) => {
      trace.append('policy.decision', { step: i + 1, decision: { action: { kind: 'key', key } } }, { source: 'policy' });
      trace.append('action.result', { step: i + 1, ok: true, action: { kind: 'key', key } });
      trace.append('keyboard.observation', { screenshot: { pngBase64: png('step' + i) } }, { source: 'runner' });
    });
    return trace.finalize({ status, steps: keys.length, ...(reason ? { reason } : {}) });
  };
  /** An executor that plays the given recordings in order and remembers what it was asked to run. */
  function player(...plays: ReturnType<typeof recorded>[]) {
    const calls: { spec: RunSpec; outDir: string; apiKey?: string }[] = [];
    const execute: RunExecutor = async (spec, { outDir, apiKey }) => { calls.push({ spec, outDir, apiKey }); return plays[calls.length - 1]!(spec, outDir); };
    return { calls, execute };
  }
  async function project(change: (config: ProjectConfig) => void = () => {}) {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup(); change(config);
    await store.save(config, initial.revision, { file: 'task.json', task }); return { dir, store };
  }
  const back = ['Tab', 'Shift+Tab', 'Tab', 'Shift+Tab'];

  it('runs a registered task with the first usable model and the task profile, writing under .rawstep/runs', async () => {
    const { dir } = await project(), { calls, execute } = player(recorded(['Tab', 'Enter'], 'success'));
    const result = await runTask('task', { projectDir: dir }, { execute });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.spec).toMatchObject({ mode: 'keyboard', model: { id: 'a' }, connection: { id: 'local' }, prompt: { id: 'baseline' }, task: { goal: 'Complete fixture' }, environment: expect.objectContaining({ id: 'default' }) });
    expect(calls[0]!.spec.permissions.keys).toContain('Tab');
    expect(dirname(dirname(calls[0]!.outDir))).toBe(join(dir, '.rawstep', 'runs')); expect(basename(dirname(calls[0]!.outDir))).toMatch(/^[0-9T-]+Z-[0-9a-f]{8}$/); expect(basename(calls[0]!.outDir)).toBe('run-1');
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ outDir: calls[0]!.outDir, outcome: { status: 'success', steps: 2 }, hints: { goalReached: true, steps: 2 } });
    expect(result.runs[0]!.runId).toBe(result.runs[0]!.hints.runId);
    for (const file of ['trace.json', 'hints.json', 'analysis.json', 'report.html']) expect(await readFile(join(calls[0]!.outDir, file), 'utf8')).toBeTruthy();
    expect((await readTrace(calls[0]!.outDir)).runId).toBe(result.runs[0]!.runId);
    expect(result.findings).toEqual([]);
  });
  it('repeats into one run-<n> directory each and compares every run with the fastest goal-reaching one', async () => {
    const { dir } = await project(), out = join(dir, 'custom-out');
    const { calls, execute } = player(recorded(['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Enter'], 'success'), recorded(['Tab', 'Enter'], 'success'), recorded([...back, 'Enter'], 'failure', 'max-steps'));
    const result = await runTask('task', { projectDir: dir, repeat: 3, outDir: out }, { execute });
    expect(calls.map(c => c.outDir)).toEqual([join(out, 'run-1'), join(out, 'run-2'), join(out, 'run-3')]);
    const [slow, fast, wandering] = result.runs;
    expect(fast!.hints.reference).toMatchObject({ runId: fast!.runId, steps: 2 });
    expect(slow!.hints.reference).toMatchObject({ runId: fast!.runId, steps: 2 });
    expect(slow!.hints.hints.map(h => h.kind)).toContain('slow-run');
    expect(JSON.parse(await readFile(join(out, 'run-1', 'hints.json'), 'utf8')).reference.runId).toBe(fast!.runId);
    expect(wandering!.outcome).toMatchObject({ status: 'failure', steps: 5 });
    expect(wandering!.hints.hints.map(h => h.kind)).toContain('backtracking');
    expect(result.findings).toEqual([expect.objectContaining({ kind: 'backtracking', source: 'model', runs: 1, totalRuns: 3 })]);
  });
  it('resolves model and profile by id or by name, and reports unknown ones with the choices', async () => {
    const { dir } = await project(config => { config.models[1]!.name = 'Fast model'; config.profiles.push(defaultProfile('zoom', 'Zoom check')); });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir, model: 'Fast model', profile: 'zoom' }, { execute });
    await runTask('task', { projectDir: dir, model: 'a', profile: 'Zoom check' }, { execute });
    expect(calls.map(c => c.spec.model.id)).toEqual(['b', 'a']);
    await expect(runTask('task', { projectDir: dir, model: 'nope' }, { execute })).rejects.toMatchObject({ code: 'model-not-found', message: expect.stringContaining('Fast model (b)') });
    await expect(runTask('task', { projectDir: dir, profile: 'nope' }, { execute })).rejects.toMatchObject({ code: 'profile-not-found' });
    expect(calls).toHaveLength(2);
  });
  it('uses the task profile, otherwise the first profile, and the model prompt of the mode', async () => {
    const { dir } = await project(config => { config.profiles.push(defaultProfile('second', 'Second')); config.tasks[0]!.profileId = 'second'; });
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir, mode: 'screenreader' }, { execute });
    expect(calls[0]!.spec.settings.screenreader.intents).toContain('next'); expect(calls[0]!.spec.mode).toBe('screenreader');
    expect(calls[0]!.spec.environment).toEqual(expect.objectContaining({ id: 'default' }));
  });
  it('picks the first decision model that supports the mode and explains when none does', async () => {
    const { dir } = await project(config => { config.models[0]!.inputs = ['text']; config.models[0]!.maxImages = 0; });
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.model.id).toBe('b');
    const only = await project(config => { config.models = config.models.slice(0, 1); config.models[0]!.inputs = ['text']; config.models[0]!.maxImages = 0; });
    await expect(runTask('task', { projectDir: only.dir }, { execute })).rejects.toMatchObject({ code: 'no-model', message: expect.stringMatching(/keyboard mode.*image input.*rawstep ui/) });
    expect((await runTask('task', { projectDir: only.dir, mode: 'screenreader' }, { execute: player(recorded(['Enter'], 'success')).execute })).runs).toHaveLength(1);
  });
  it('runs an unregistered task file with the first profile, resolving the path from the project directory', async () => {
    const { dir } = await project(config => { config.profiles.push(defaultProfile('second', 'Second')); config.tasks[0]!.profileId = 'second'; });
    await writeFile(join(dir, 'other.json'), JSON.stringify({ ...task, goal: 'Other goal' }));
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('other.json', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.task.goal).toBe('Other goal'); expect(calls[0]!.spec.prompt.id).toBe('baseline');
    // The registered task's own file is recognized and keeps its configuration.
    await runTask('./task.json', { projectDir: dir, mode: 'keyboard' }, { execute });
    expect(calls[1]!.spec.task.goal).toBe('Complete fixture');
    await expect(runTask('missing.json', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'task-not-found', message: expect.stringContaining('Known tasks: task') });
    await writeFile(join(dir, 'broken.json'), '{nope');
    await expect(runTask('broken.json', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'invalid-task' });
  });
  it('says what to do when there is no config, no matching setup or bad options', async () => {
    const empty = await root(), { execute } = player();
    await expect(runTask('task', { projectDir: empty }, { execute })).rejects.toMatchObject({ code: 'no-config', message: expect.stringMatching(/rawstep\.config\.json.*rawstep init.*rawstep ui/) });
    const { dir } = await project();
    await expect(runTask('task', { projectDir: dir, repeat: 0 }, { execute })).rejects.toMatchObject({ code: 'invalid-repeat' });
    await expect(runTask('task', { projectDir: dir, repeat: 1.5 }, { execute })).rejects.toMatchObject({ code: 'invalid-repeat' });
    await expect(runTask('task', { projectDir: dir, mode: 'mouse' as never }, { execute })).rejects.toMatchObject({ code: 'invalid-mode' });
    const unsupported = await project(config => { config.profiles[0]!.environment = 'zoom-200'; });
    await expect(runTask('task', { projectDir: unsupported.dir }, { execute })).rejects.toMatchObject({ code: 'environment-unsupported' });
  });
  it('requires the connection key, reading it from .env.local, and hands it to the run', async () => {
    const { dir, store } = await project(config => { config.connections[0]!.apiKeyEnv = 'RAWSTEP_TEST_RUN_KEY'; });
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    await expect(runTask('task', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'missing-credential', message: expect.stringContaining('RAWSTEP_TEST_RUN_KEY') });
    await store.setCredential('RAWSTEP_TEST_RUN_KEY', 'sk-fixture-key');
    await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.apiKey).toBe('sk-fixture-key');
  });
  it('rejects on cancellation and keeps the traces written so far', async () => {
    const { dir } = await project(), controller = new AbortController();
    const out = join(dir, 'cancelled');
    const execute: RunExecutor = async (spec, { outDir }) => { const trace = await recorded(['Tab'], 'failure', 'cancelled')(spec, outDir); controller.abort('SIGINT'); return trace; };
    await expect(runTask('task', { projectDir: dir, repeat: 3, outDir: out, signal: controller.signal }, { execute })).rejects.toMatchObject({ code: 'cancelled' });
    expect((await readTrace(join(out, 'run-1'))).runId).toBeTruthy();
    await expect(readFile(join(out, 'run-2', 'trace.json'))).rejects.toThrow();
    await expect(runTask('task', { projectDir: dir, signal: controller.signal }, { execute: player().execute })).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('forwards trace events to onEvent', async () => {
    const { dir } = await project(), seen: string[] = [];
    const execute: RunExecutor = async (spec, { outDir, onEvent }) => { const trace = new TraceRecorder({ ...spec.task, id: 'fixture' }, outDir, { onEvent }); await trace.initialize(); trace.append('fixture.event', {}, { source: 'runner' }); return trace.finalize({ status: 'success', steps: 0 }); };
    await runTask('task', { projectDir: dir, onEvent: event => seen.push(event.type) }, { execute });
    expect(seen).toContain('fixture.event');
  });
  it('does not treat an executor failure as a result', async () => {
    const { dir } = await project();
    await expect(runTask('task', { projectDir: dir }, { execute: async () => { throw new Error('browser crashed'); } })).rejects.toThrow('browser crashed');
  });
});
