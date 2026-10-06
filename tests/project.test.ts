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
  CONFIG_FILE, configSchema, credentialId, credentialRequirements, defaultConfig, defaultInputs, defaultModes, defaultProfile, findByIdOrName, modelKeyEnv, parseConfig, profileAnalysisModel, profileModel, resolveBaseURL, resolveRepetitionGuard, taskProfile,
  type ProjectConfig, type RunProfile,
} from '@rawstep/project/config';
import { ProjectError } from '@rawstep/project/errors';
import { ProjectStore, initProject } from '@rawstep/project/store';
import { discover } from '@rawstep/project/discover';
import { assertRunnable, backendCapabilities, checkRun, resolvePermissions, supportsMode } from '@rawstep/project/plan';
import { projectAnalyzer, runTask } from '@rawstep/project/run';
import type { RunExecutor, RunSpec } from '@rawstep/project/execution';
import { connection, profileWith } from './helpers/project-config.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function root() { const r = await mkdtemp(join(tmpdir(), 'rawstep-project-')); dirs.push(r); return r; }
const task = { url: 'https://example.com', goal: 'Complete fixture', input: { email: 'private-value' }, verify: { all: [{ titleIncludes: 'Done' }] } };
function setup(): ProjectConfig {
  const config = defaultConfig();
  config.connections.push(connection('a'), connection('b'));
  config.profiles[0] = profileWith('default', 'a', 'm-a', 'Default');
  const modes = defaultModes(); modes.keyboard.prompts.push({ id: 'careful', name: 'Careful', version: '2', instructions: 'Careful fixture instructions' });
  config.tasks.push({ id: 'task', name: 'Fixture', file: 'task.json', modes }); return config;
}

describe('project store', () => {
  it('detects external writes and keeps keys out of config responses', async () => {
    const dir = await root(); const store = new ProjectStore(dir); const first = await store.initialize();
    await writeFile(store.path, JSON.stringify({ ...first.config, machine: { ...first.config.machine, headless: false } }));
    await expect(store.save(first.config, first.revision)).rejects.toMatchObject({ code: 'config-conflict', status: 409 });
    await store.setCredential('typesafe', 'secret-fixture-value');
    expect(await store.credential('typesafe')).toBe('secret-fixture-value');
    expect(JSON.stringify(await store.read())).not.toContain('secret-fixture-value');
    const reread = new ProjectStore(dir); expect((await reread.read()).config.machine.headless).toBe(false);
  });
  it('keeps one key per preset provider and one per custom connection, under their environment variables', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.connections.push(connection('or-llm', { kind: 'llm', provider: 'openrouter' }), connection('or-dec', { kind: 'decision', provider: 'openrouter' }),
      connection('keyed', { kind: 'llm', baseURL: 'http://127.0.0.1:1/v1', apiKeyEnv: 'RAWSTEP_TEST_CUSTOM_KEY' }));
    await store.save(config, initial.revision, { file: 'task.json', task });
    expect(await store.credentialStatus(config)).toMatchObject({ 'provider:openrouter': false, 'provider:typesafe': false, 'connection:keyed': false });
    // OpenRouter serves both kinds with one key; the file stores it under the preset variable.
    await store.setCredential('openrouter', 'sk-or-fixture');
    expect(await store.credential(config.connections.find(c => c.id === 'or-llm')!)).toBe('sk-or-fixture');
    expect(await store.credential(config.connections.find(c => c.id === 'or-dec')!)).toBe('sk-or-fixture');
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toContain('RAWSTEP_OPENROUTER_API_KEY="sk-or-fixture"');
    await store.setCredential(config.connections.find(c => c.id === 'keyed')!, 'sk-custom-fixture');
    expect(await store.credentialStatus(config)).toMatchObject({ 'provider:openrouter': true, 'provider:typesafe': false, 'connection:keyed': true });
    // A custom connection without a key variable has nowhere to store a key; the custom provider has no shared key.
    await expect(store.setCredential(config.connections.find(c => c.id === 'a')!, 'sk')).rejects.toMatchObject({ code: 'credential-target' });
    await expect(store.setCredential('custom', 'sk')).rejects.toMatchObject({ code: 'credential-target' });
    await expect(store.setCredential('openai', 'two\nlines')).rejects.toMatchObject({ code: 'invalid-credential' });
    expect(credentialRequirements(config).map(k => [k.id, k.env, k.required, k.connection.id])).toEqual([['connection:a', undefined, false, 'a'], ['connection:b', undefined, false, 'b'], ['provider:openrouter', 'RAWSTEP_OPENROUTER_API_KEY', true, 'or-llm'], ['connection:keyed', 'RAWSTEP_TEST_CUSTOM_KEY', false, 'keyed']]);
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
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  /** A fetch that answers from a map of URL to response and records what it was asked for. */
  const catalog = (answers: Record<string, unknown>) => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetcher: typeof fetch = async (input, init) => { const url = String(input); calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } }); return url in answers ? json(answers[url]) : json({}, 404); };
    return { calls, fetcher };
  };
  it('reports whether a model\'s inputs are advertised, assumes the preset when they are not, and omits credential echoes', async () => {
    const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'vision-by-name-only' }, { id: 'vision-confirmed', inputs: ['text', 'image'] }, { id: 'text-confirmed', inputs: ['text'] }, { id: 'PRIVATE_DISCOVERY_KEY' }] })); });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    try {
      const models = await discover({ kind: 'llm', provider: 'custom', baseURL: 'http://127.0.0.1:' + (server.address() as { port: number }).port }, 'PRIVATE_DISCOVERY_KEY');
      expect(models.map(m => [m.modelId, m.inputs, m.inputsKnown])).toEqual([['vision-by-name-only', defaultInputs({ kind: 'llm', provider: 'custom' }), false], ['vision-confirmed', ['text', 'image'], true], ['text-confirmed', ['text'], true]]);
      expect(JSON.stringify(models)).not.toContain('PRIVATE_DISCOVERY_KEY');
    } finally { server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); }
  });
  it('lists LLM presets from their /models, confirming image support only from OpenRouter and the ones that report it', async () => {
    const { calls, fetcher } = catalog({
      'https://openrouter.ai/api/v1/models': { data: [{ id: 'chat/vision', name: 'Vision', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }, { id: 'art/maker', architecture: { input_modalities: ['text'], output_modalities: ['image'] } }, { id: 'one/decider', architecture: { input_modalities: ['text'], output_modalities: ['decisions'] } }] },
      'https://api.openai.com/v1/models': { data: [{ id: 'gpt-fixture', modalities: { input: ['text', 'image'] } }, { id: 'plain' }] },
      'https://generativelanguage.googleapis.com/v1beta/openai/models': { data: [{ id: 'models/gemini-fixture' }] },
      'https://api.anthropic.com/v1/models?limit=1000': { data: [{ id: 'claude-fixture', display_name: 'Claude Fixture' }] },
    });
    const openrouter = await discover({ kind: 'llm', provider: 'openrouter' }, 'sk-or', { fetch: fetcher });
    expect(openrouter.map(m => [m.modelId, m.name, m.inputs, m.inputsKnown])).toEqual([['chat/vision', 'Vision', ['text', 'image'], true]]);
    const openai = await discover({ kind: 'llm', provider: 'openai' }, 'sk-openai', { fetch: fetcher });
    // Without advertised modalities the provider preset decides (OpenAI passes images), and the answer is marked as a guess.
    expect(openai.map(m => [m.modelId, m.inputs, m.inputsKnown])).toEqual([['gpt-fixture', ['text', 'image'], true], ['plain', ['text', 'image'], false]]);
    expect((await discover({ kind: 'llm', provider: 'google' }, 'k', { fetch: fetcher })).map(m => m.modelId)).toEqual(['gemini-fixture']);
    const anthropic = await discover({ kind: 'llm', provider: 'anthropic' }, 'sk-ant', { fetch: fetcher });
    expect(anthropic.map(m => [m.modelId, m.name, m.inputsKnown])).toEqual([['claude-fixture', 'Claude Fixture', false]]);
    expect(calls.find(c => c.url.startsWith('https://api.anthropic.com'))!.headers).toMatchObject({ authorization: 'Bearer sk-ant', 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' });
    expect(calls.find(c => c.url.startsWith('https://api.openai.com'))!.headers).not.toHaveProperty('x-api-key');
  });
  it('lists decision models from OpenRouter and TypeSafe, and leaves custom servers to be typed by hand', async () => {
    const { calls, fetcher } = catalog({
      'https://openrouter.ai/api/v1/models?output_modalities=decisions': { data: [{ id: 'one/decider', canonical_slug: 'one/decider-2026', architecture: { input_modalities: ['text', 'image'], output_modalities: ['decisions'] } }, { id: 'one/text', architecture: { input_modalities: ['text'], output_modalities: ['decisions'] } }] },
      'https://api.typesafe.ai/v1/models': { data: [{ id: 'jev-latest' }] },
    });
    const openrouter = await discover({ kind: 'decision', provider: 'openrouter' }, 'sk-or', { fetch: fetcher });
    expect(openrouter.map(m => [m.modelId, m.inputs, m.inputsKnown])).toEqual([['one/decider-2026', ['text', 'image'], true], ['one/text', ['text'], true]]);
    expect((await discover({ kind: 'decision', provider: 'typesafe' }, 'sk-ts', { fetch: fetcher })).map(m => [m.modelId, m.inputs, m.inputsKnown])).toEqual([['jev-latest', ['text', 'image'], false]]);
    expect(calls.map(c => c.url)).toEqual(['https://openrouter.ai/api/v1/models?output_modalities=decisions', 'https://api.typesafe.ai/v1/models']);
    expect(await discover({ kind: 'decision', provider: 'custom', baseURL: 'http://127.0.0.1:1/v1' }, undefined, { fetch: fetcher })).toEqual([]);
    expect(calls).toHaveLength(2);
    await expect(discover({ kind: 'decision', provider: 'gateway' })).rejects.toMatchObject({ code: 'missing-credential' });
  });
  it('rejects a provider of the other kind and a custom provider without a usable address', async () => {
    await expect(discover({ kind: 'llm', provider: 'typesafe' })).rejects.toMatchObject({ code: 'invalid-provider' });
    await expect(discover({ kind: 'decision', provider: 'openai' })).rejects.toMatchObject({ code: 'invalid-provider' });
    await expect(discover({ kind: 'llm', provider: 'custom' })).rejects.toMatchObject({ code: 'invalid-base-url' });
    await expect(discover({ kind: 'llm', provider: 'custom', baseURL: 'http://example.com/v1' })).rejects.toMatchObject({ code: 'invalid-base-url' });
  });
  it('answers an unreachable server and a server without a model list with project errors', async () => {
    await expect(discover({ kind: 'llm', provider: 'custom', baseURL: 'http://127.0.0.1:1/v1' }, undefined, { timeoutMs: 500 })).rejects.toMatchObject({ code: 'model-unreachable', status: 502 });
    await expect(discover({ kind: 'llm', provider: 'openai' }, 'k', { fetch: async () => json({ object: 'list' }) })).rejects.toMatchObject({ code: 'model-list-missing', status: 502 });
    await expect(discover({ kind: 'llm', provider: 'openai' }, 'k', { fetch: async () => json({}, 401) })).rejects.toMatchObject({ code: 'model-http' });
  });
});

describe('connection schema', () => {
  const base = { id: 'm', name: 'm' };
  const parse = (extra: Record<string, unknown>) => parseConfig({ ...defaultConfig(), connections: [{ ...base, ...extra }] });
  it('resolves the address and key variable of presets and custom connections', () => {
    const preset = connection('p', { kind: 'decision', provider: 'typesafe' });
    expect(resolveBaseURL(preset)).toBe('https://api.typesafe.ai/v1'); expect(modelKeyEnv(preset)).toBe('RAWSTEP_TYPESAFE_API_KEY');
    expect(resolveBaseURL(connection('o', { kind: 'llm', provider: 'openrouter' }))).toBe('https://openrouter.ai/api/v1');
    const custom = connection('c', { kind: 'llm', baseURL: 'http://127.0.0.1:1234/v1', apiKeyEnv: 'MY_KEY' });
    expect(resolveBaseURL(custom)).toBe('http://127.0.0.1:1234/v1'); expect(modelKeyEnv(custom)).toBe('MY_KEY'); expect(modelKeyEnv({ ...custom, apiKeyEnv: undefined })).toBeUndefined();
    expect(credentialId(preset)).toBe('provider:typesafe'); expect(credentialId(custom)).toBe('connection:c');
    expect(parse({ kind: 'llm', provider: 'google' }).connections[0]).toMatchObject({ timeoutMs: expect.any(Number) });
  });
  it('keeps each provider with its kind and the address and key variable with custom connections', () => {
    expect(() => parse({ kind: 'llm', provider: 'openai' })).not.toThrow();
    expect(() => parse({ kind: 'llm', provider: 'typesafe' })).toThrow();
    expect(() => parse({ kind: 'decision', provider: 'anthropic' })).toThrow();
    expect(() => parse({ kind: 'decision', provider: 'custom' })).toThrow();
    expect(() => parse({ kind: 'decision', provider: 'custom', baseURL: 'http://127.0.0.1:8000/v1' })).not.toThrow();
    expect(() => parse({ kind: 'llm', provider: 'openai', baseURL: 'https://example.com/v1' })).toThrow();
    expect(() => parse({ kind: 'llm', provider: 'openai', apiKeyEnv: 'MY_KEY' })).toThrow();
    expect(() => parse({ kind: 'llm', provider: 'custom', baseURL: 'http://127.0.0.1:1/v1', apiKeyEnv: 'lower' })).toThrow();
    expect(() => parse({ kind: 'decision', provider: 'gateway' })).not.toThrow();
  });
  it('holds no model: a connection with a model ID, inputs or roles is rejected', () => {
    for (const extra of [{ modelId: 'x' }, { inputs: ['text'] }, { roles: ['decision'] }, { maxChoices: 255 }, { capabilitySource: 'manual' }, { family: 'LLM', protocol: 'chat' }])
      expect(() => parse({ kind: 'llm', provider: 'openai', ...extra })).toThrow();
  });
  it('rejects duplicate connection ids and a config that still has a models list', () => {
    const twice = [{ ...base, kind: 'llm', provider: 'openai' }, { ...base, kind: 'decision', provider: 'typesafe' }];
    expect(() => parseConfig({ ...defaultConfig(), connections: twice })).toThrow(/used twice/);
    expect(() => parseConfig({ ...defaultConfig(), connections: [], models: [] })).toThrow();
  });
  it('keeps a profile model on an existing connection and its analysis model on an LLM connection', () => {
    const config = setup(); config.connections.push(connection('llm', { kind: 'llm' }));
    const withProfile = (change: (p: RunProfile) => void) => { const copy = structuredClone(config); change(copy.profiles[0]!); return copy; };
    expect(() => parseConfig(withProfile(p => { p.analysisModel = { connectionId: 'llm', modelId: 'writer' }; }))).not.toThrow();
    expect(() => parseConfig(withProfile(p => { p.analysisModel = { connectionId: 'a', modelId: 'writer' }; }))).toThrow(/LLM connection/);
    expect(() => parseConfig(withProfile(p => { p.analysisModel = { connectionId: 'ghost', modelId: 'writer' }; }))).toThrow();
    expect(() => parseConfig(withProfile(p => { p.model!.connectionId = 'ghost'; }))).toThrow(/does not exist/);
    expect(() => parseConfig(withProfile(p => { delete p.model; }))).not.toThrow();
  });
  it('joins a profile with its connection into the model a run calls', () => {
    const config = setup(); config.connections.push(connection('llm', { kind: 'llm', name: 'My LLM' }));
    const profile = { ...profileWith('p', 'a', 'jev-latest'), analysisModel: { connectionId: 'llm', modelId: 'writer' } };
    expect(profileModel(config, profile)).toMatchObject({ id: 'a', name: 'a · jev-latest', modelId: 'jev-latest', kind: 'decision', provider: 'custom', baseURL: 'http://127.0.0.1:1234', inputs: ['text', 'image'], maxChoices: 255, maxImages: 2 });
    expect(profileAnalysisModel(config, profile)).toMatchObject({ id: 'llm', name: 'My LLM · writer', modelId: 'writer', kind: 'llm', inputs: ['text'] });
    // A text-only model takes no images, whatever maxImages says.
    expect(profileModel(config, { model: { ...profile.model!, inputs: ['text'], maxImages: 2 } })!.maxImages).toBe(0);
    expect(profileModel(config, defaultProfile())).toBeUndefined();
    expect(profileModel(config, { model: { ...profile.model!, connectionId: 'ghost' } })).toBeUndefined();
    expect(profileAnalysisModel(config, { analysisModel: { connectionId: 'a', modelId: 'x' } })).toBeUndefined();
  });
  it('assumes images only for providers that pass them', () => {
    expect(defaultInputs({ kind: 'llm', provider: 'openai' })).toEqual(['text', 'image']);
    expect(defaultInputs({ kind: 'decision', provider: 'gateway' })).toEqual(['text']);
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
    expect(policy).toMatchObject({ repetitionGuard: 'auto', modelGiveUp: false });
    expect(defaultConfig().profiles[0]!.policy).toMatchObject({ repetitionGuard: 'auto', modelGiveUp: false });
    expect(() => configSchema.parse({ ...old, profiles: [{ ...old.profiles[0], policy: { ...old.profiles[0].policy, repetitionGuard: 'sometimes' } }] })).toThrow();
  });
  it('resolves auto by model kind and honours explicit on/off', () => {
    const llm = { kind: 'llm' as const }, decision = { kind: 'decision' as const };
    expect(resolveRepetitionGuard('auto', decision)).toBe(false);
    expect(resolveRepetitionGuard('auto', llm)).toBe(true);
    expect(resolveRepetitionGuard('on', decision)).toBe(true);
    expect(resolveRepetitionGuard('off', llm)).toBe(false);
  });
  it('accepts only version 1 configs', () => {
    const config = defaultConfig();
    expect(config.version).toBe(1);
    expect(parseConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(() => parseConfig({ ...config, version: 2 })).toThrow();
    expect(() => parseConfig({ version: 1, connections: [], models: [], tasks: [], profiles: [defaultProfile()], machine: {} })).toThrow();
  });
  it('finds connections and profiles by id first, then by name', () => {
    const list = [{ id: 'one', name: 'two' }, { id: 'two', name: 'one' }];
    expect(findByIdOrName(list, 'one')).toBe(list[0]); expect(findByIdOrName(list, 'two')).toBe(list[1]); expect(findByIdOrName(list, 'three')).toBeUndefined();
    const config = { ...defaultConfig(), tasks: setup().tasks };
    expect(taskProfile(config, { profileId: 'gone' }).id).toBe('default');
  });
});

describe('run checks', () => {
  const choiceOf = (config: ProjectConfig) => config.profiles[0]!.model!;
  const check = (config: ProjectConfig, change: (c: ProjectConfig) => void = () => {}, extra: Partial<Parameters<typeof checkRun>[0]> = {}) => {
    change(config);
    return checkRun({ config, task: task as never, taskEntry: config.tasks[0], profile: config.profiles[0]!, mode: 'keyboard', ...extra });
  };
  it('accepts a supported combination and returns its settings and the profile\'s model', () => {
    const result = check(setup());
    expect(result.problem).toBeUndefined(); expect(result.settings.policy.historyLimit).toBeGreaterThan(0);
    expect(result.model).toMatchObject({ id: 'a', modelId: 'm-a', name: 'a · m-a' }); expect(result.analysisModel).toBeUndefined();
    expect(assertRunnable(result).permissions.keys).toContain('Tab');
  });
  it.each([
    ['profile-without-model', (c: ProjectConfig) => { delete c.profiles[0]!.model; }],
    ['model-needs-images', (c: ProjectConfig) => { choiceOf(c).inputs = ['text']; }],
    ['too-many-choices', (c: ProjectConfig) => { choiceOf(c).maxChoices = 4; }],
    ['unsupported-action', (c: ProjectConfig) => { c.profiles[0]!.permissions.keyboard.keys = ['F13']; }],
    ['focus-gate-llm', (c: ProjectConfig) => { c.connections[0]!.kind = 'llm'; c.profiles[0]!.policy.focusGate = true; }],
    ['environment-unsupported', (c: ProjectConfig) => { c.profiles[0]!.environment = 'zoom-200'; }],
  ])('reports %s as the problem, not by throwing', (code, change) => {
    const result = check(setup(), change);
    expect(result.problem).toBeInstanceOf(ProjectError); expect(result.problem!.code).toBe(code);
    expect(() => assertRunnable(result)).toThrow(result.problem!);
    expect(result.permissions).toBeDefined();
  });
  it('explains a profile without a model by what to do, and a model that cannot take the mode by what it lacks', () => {
    const none = check(setup(), c => { delete c.profiles[0]!.model; });
    expect(none.model).toBeUndefined(); expect(none.problem!.message).toMatch(/no model.*connection/i);
    expect(check(setup(), c => { choiceOf(c).inputs = ['text']; }).problem!.message).toMatch(/image/);
    expect(check(setup(), c => { choiceOf(c).inputs = ['text']; }, { mode: 'screenreader' }).problem).toBeUndefined();
    expect(check(setup(), c => { choiceOf(c).inputs = ['image']; }, { mode: 'screenreader' }).problem?.code).toBe('model-needs-text');
    expect(check(setup(), c => { choiceOf(c).maxImages = 1; }).problem?.code).toBe('model-needs-images');
  });
  it('counts three stop choices only while the model may give up', () => {
    // Four keys plus the stop choices: 7 with give-up, 5 without.
    const limit = (modelGiveUp: boolean, maxChoices: number) => check(setup(), c => { choiceOf(c).maxChoices = maxChoices; c.profiles[0]!.policy.modelGiveUp = modelGiveUp; }).problem?.code;
    expect(limit(true, 6)).toBe('too-many-choices'); expect(limit(true, 7)).toBeUndefined();
    expect(limit(false, 4)).toBe('too-many-choices'); expect(limit(false, 5)).toBeUndefined();
  });
  it('reports an analysis model that is not on an LLM connection, and stop diagnosis in screen reader mode', () => {
    expect(check(setup(), c => { c.profiles[0]!.analysisModel = { connectionId: 'b', modelId: 'writer' }; }).problem?.code).toBe('analysis-model-invalid');
    const withLlm = check(setup(), c => { c.connections.push(connection('llm', { kind: 'llm' })); c.profiles[0]!.analysisModel = { connectionId: 'llm', modelId: 'writer' }; });
    expect(withLlm.problem).toBeUndefined(); expect(withLlm.analysisModel).toMatchObject({ id: 'llm', modelId: 'writer', kind: 'llm' });
    expect(check(setup(), () => {}, { mode: 'screenreader', diagnoseStop: true }).problem?.code).toBe('diagnose-keyboard-only');
  });
  it('knows which models can serve a mode', () => {
    const a = profileModel(setup(), setup().profiles[0]!)!;
    expect(supportsMode(a, 'keyboard')).toBe(true); expect(supportsMode(a, 'screenreader')).toBe(true);
    expect(supportsMode({ ...a, inputs: ['text'], maxImages: 0 }, 'keyboard')).toBe(false);
    expect(supportsMode({ ...a, inputs: ['image'], maxImages: 2 }, 'screenreader')).toBe(false);
    expect(supportsMode({ ...a, maxImages: 1 }, 'keyboard')).toBe(false);
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

  it('runs a registered task with the model of its profile, writing under .rawstep/runs', async () => {
    const { dir } = await project(), { calls, execute } = player(recorded(['Tab', 'Enter'], 'success'));
    const result = await runTask('task', { projectDir: dir }, { execute });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.spec).toMatchObject({ mode: 'keyboard', model: { id: 'a' }, prompt: { id: 'baseline' }, task: { goal: 'Complete fixture' }, environment: expect.objectContaining({ id: 'default' }) });
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
  it('resolves the profile by id or by name, and reports unknown ones with the choices', async () => {
    const { dir } = await project(config => { config.profiles.push(profileWith('zoom', 'b', 'm-b', 'Zoom check')); });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir, profile: 'zoom' }, { execute });
    await runTask('task', { projectDir: dir, profile: 'Zoom check' }, { execute });
    await runTask('task', { projectDir: dir, profile: 'Default' }, { execute });
    expect(calls.map(c => c.spec.model.id)).toEqual(['b', 'b', 'a']);
    expect(calls[0]!.spec.model).toMatchObject({ modelId: 'm-b', name: 'b · m-b' });
    await expect(runTask('task', { projectDir: dir, profile: 'nope' }, { execute })).rejects.toMatchObject({ code: 'profile-not-found', message: expect.stringContaining('Zoom check (zoom)') });
    expect(calls).toHaveLength(3);
  });
  it('uses the task profile, otherwise the first profile, with that profile\'s model and the prompt of the mode', async () => {
    const { dir } = await project(config => { config.profiles.push(profileWith('second', 'b', 'm-b', 'Second')); config.tasks[0]!.profileId = 'second'; });
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir, mode: 'screenreader' }, { execute });
    expect(calls[0]!.spec.settings.screenreader.intents).toContain('next'); expect(calls[0]!.spec.mode).toBe('screenreader');
    expect(calls[0]!.spec.model.id).toBe('b'); expect(calls[0]!.spec.environment).toEqual(expect.objectContaining({ id: 'default' }));
  });
  it('uses the profile\'s model and explains when the profile has none or its model cannot take images', async () => {
    const text = await project(config => { config.profiles[0]!.model!.inputs = ['text']; });
    await expect(runTask('task', { projectDir: text.dir }, { execute: player().execute })).rejects.toMatchObject({ code: 'model-needs-images', message: expect.stringMatching(/Keyboard runs.*image/) });
    expect((await runTask('task', { projectDir: text.dir, mode: 'screenreader' }, { execute: player(recorded(['Enter'], 'success')).execute })).runs).toHaveLength(1);
    const none = await project(config => { delete config.profiles[0]!.model; });
    await expect(runTask('task', { projectDir: none.dir }, { execute: player().execute })).rejects.toMatchObject({ code: 'profile-without-model', message: expect.stringMatching(/no model.*connection/i) });
    // Another profile with a model still runs: nothing else is picked for the profile that has none.
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    const mixed = await project(config => { delete config.profiles[0]!.model; config.profiles.push(profileWith('second', 'b')); });
    await runTask('task', { projectDir: mixed.dir, profile: 'second' }, { execute });
    expect(calls[0]!.spec.model.id).toBe('b');
    await expect(runTask('task', { projectDir: mixed.dir }, { execute })).rejects.toMatchObject({ code: 'profile-without-model' });
  });
  it('runs an unregistered task file with the first profile, resolving the path from the project directory', async () => {
    const { dir } = await project(config => { config.profiles.push(profileWith('second', 'b', 'm-b', 'Second')); config.tasks[0]!.profileId = 'second'; });
    await writeFile(join(dir, 'other.json'), JSON.stringify({ ...task, goal: 'Other goal' }));
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('other.json', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.task.goal).toBe('Other goal'); expect(calls[0]!.spec.prompt.id).toBe('baseline'); expect(calls[0]!.spec.model.id).toBe('a');
    // The registered task's own file is recognized and keeps its configuration.
    await runTask('./task.json', { projectDir: dir, mode: 'keyboard' }, { execute });
    expect(calls[1]!.spec.task.goal).toBe('Complete fixture'); expect(calls[1]!.spec.model.id).toBe('b');
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
  it('requires the provider key, reading it from .env.local, and hands it to the run; a custom server needs none', async () => {
    const { dir, store } = await project(config => { config.connections[0] = connection('a', { kind: 'llm', provider: 'openai' }); config.profiles.push(profileWith('second', 'b')); });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await expect(runTask('task', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'missing-credential', message: expect.stringContaining('RAWSTEP_OPENAI_API_KEY') });
    await store.setCredential('openai', 'sk-fixture-key');
    await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.apiKey).toBe('sk-fixture-key');
    await runTask('task', { projectDir: dir, profile: 'second' }, { execute });
    expect(calls[1]!.apiKey).toBeUndefined();
  });
  it('needs the key of the profile\'s analysis model before anything starts', async () => {
    const { dir, store } = await project(config => { config.connections.push(connection('writer', { kind: 'llm', provider: 'openai' })); config.profiles[0]!.analysisModel = { connectionId: 'writer', modelId: 'gpt-fixture' }; });
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    await expect(runTask('task', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'missing-credential', message: expect.stringContaining('RAWSTEP_OPENAI_API_KEY') });
    expect(calls).toHaveLength(0);
    await store.setCredential('openai', 'sk-fixture-key');
    expect((await runTask('task', { projectDir: dir }, { execute })).runs).toHaveLength(1);
  });
  it('builds the analyzer of a profile\'s analysis model, and says what is missing otherwise', async () => {
    const none = await project();
    await expect(projectAnalyzer(none.dir)).rejects.toMatchObject({ code: 'no-analysis-model', message: expect.stringMatching(/No run profile has an analysis model/) });
    const { dir } = await project(config => { config.connections.push(connection('writer', { kind: 'llm', name: 'Writer' })); config.profiles.push({ ...defaultProfile('analysing', 'Analysing'), analysisModel: { connectionId: 'writer', modelId: 'gpt-fixture' } }); });
    expect((await projectAnalyzer(dir)).modelName).toBe('Writer · gpt-fixture');
    expect((await projectAnalyzer(dir, { profile: 'Analysing' })).modelName).toBe('Writer · gpt-fixture');
    await expect(projectAnalyzer(dir, { profile: 'default' })).rejects.toMatchObject({ code: 'no-analysis-model', message: expect.stringContaining('"Default"') });
    await expect(projectAnalyzer(dir, { profile: 'nope' })).rejects.toMatchObject({ code: 'profile-not-found' });
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
