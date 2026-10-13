import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { screenshotChoices } from '@rawstep/policies/screenshot/policy';
import { speechChoices } from '@rawstep/policies/policy';
import { validateDecision } from '@rawstep/browser/runner';
import { TraceRecorder, readTrace } from '@rawstep/core/trace';
import {
  CONFIG_FILE, comboExecutor, comboPlanner, configSchema, credentialId, credentialRequirements, defaultConfig, defaultInputs, defaultProfile,
  findByIdOrName, modelKeyEnv, parseConfig, profileConditions, projectAnalysisModel, resolveBaseURL, resolveRepetitionGuard, resolveRunRules, suggestionModel, firstProfile, taskSchema,
  type Executor, type Profile, type ProjectConfig,
} from '@rawstep/project/config';
import { ProjectError } from '@rawstep/project/errors';
import { ProjectStore, initProject } from '@rawstep/project/store';
import { discover } from '@rawstep/project/discover';
import { assertRunnable, backendCapabilities, checkRun, comboModes, conditionsRecord, executorPrompt, resolvePermissions, runSpecOf, supportsMode } from '@rawstep/project/plan';
import { projectAnalyzer, runTask } from '@rawstep/project/run';
import type { RunExecutor, RunSpec } from '@rawstep/project/execution';
import { connection, instructions, plannedWith, profileWith } from './helpers/project-config.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function root() { const r = await mkdtemp(join(tmpdir(), 'rawstep-project-')); dirs.push(r); return r; }
const task = { url: 'https://example.com', goal: 'Complete fixture', input: { email: 'private-value' }, verify: { all: [{ titleIncludes: 'Done' }] } };
function setup(): ProjectConfig {
  const config = defaultConfig();
  // Screen reader runs always plan, so the profile carries a planner on an LLM connection (keyboard runs ignore it).
  config.connections.push(connection('a'), connection('b'), connection('setup-llm', { kind: 'llm' }));
  config.profiles[0] = plannedWith(profileWith('default', 'a', 'm-a', 'Default'), 'setup-llm');
  config.tasks.push({ id: 'task', name: 'Fixture', file: 'task.json' }); return config;
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
    expect(credentialRequirements(config).map(k => [k.id, k.env, k.required, k.connection.id])).toEqual([['connection:a', undefined, false, 'a'], ['connection:b', undefined, false, 'b'], ['connection:setup-llm', undefined, false, 'setup-llm'], ['provider:openrouter', 'RAWSTEP_OPENROUTER_API_KEY', true, 'or-llm'], ['connection:keyed', 'RAWSTEP_TEST_CUSTOM_KEY', false, 'keyed']]);
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
  it('reads an invalid config as an error naming the file, an old-version one as old-config with what to do instead, and a missing task file as 404', async () => {
    const dir = await root(), store = new ProjectStore(dir);
    await writeFile(store.path, JSON.stringify({ ...defaultConfig(), version: 6 }));
    await expect(store.read()).rejects.toMatchObject({ code: 'invalid-config', message: expect.stringContaining('rawstep.config.json') });
    await writeFile(store.path, '{nope');
    await expect(store.read()).rejects.toMatchObject({ code: 'invalid-config' });
    for (const version of [1, 2, 3, 4]) {
      await writeFile(store.path, JSON.stringify({ version, agents: [] }));
      await expect(store.read()).rejects.toMatchObject({ code: 'old-config', message: expect.stringMatching(new RegExp(`version ${version}.*rawstep init`)) });
    }
    await writeFile(store.path, JSON.stringify({ ...setup() }));
    await expect(store.read()).rejects.toMatchObject({ code: 'task-file-missing', status: 404 });
  });
  it('throws plain project errors with a status hint, never HTTP errors', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.profiles.push(defaultProfile());
    const error = await store.save(config, initial.revision, { file: 'task.json', task }).catch(e => e as ProjectError);
    expect(error).toBeInstanceOf(ProjectError); expect(error).toMatchObject({ code: 'duplicate-id', status: 400 });
    await expect(store.save(setup(), initial.revision, { file: 'rawstep.config.json', task })).rejects.toMatchObject({ code: 'task-file-reserved' });
    expect(() => store.validateReferences({ ...setup(), profiles: [{ ...defaultProfile(), page: 'no-such-environment' }] })).toThrow();
  });
  it.each([
    ['duplicate-id', (c: ProjectConfig) => { c.profiles.push(defaultProfile('default', 'Again')); }],
    ['profile-connection-missing', (c: ProjectConfig) => { c.profiles[0]!.executors.keyboard!.connectionId = 'ghost'; }],
    ['planner-needs-llm', (c: ProjectConfig) => { Object.assign(c.profiles[0]!, plannedWith(c.profiles[0]!, 'a')); }],
    ['analysis-needs-llm', (c: ProjectConfig) => { c.project.analysis.model = { connectionId: 'a', modelId: 'writer' }; }],
    ['duplicate-task-file', (c: ProjectConfig) => { c.tasks.push({ id: 'other', name: 'Other', file: 'task.json' }); }],
  ])('validates references: %s', async (code, change) => {
    const store = new ProjectStore(await root()), config = setup(); change(config);
    expect(() => store.validateReferences(config)).toThrow(expect.objectContaining({ code, status: 400 }));
  });
  it('saves a task without a profile, and the profiles beside it, and reads them back', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.profiles.push({ ...profileWith('strict', 'a', 'm-a', 'Strict'), runRules: resolveRunRules(config.profiles[0]!, { maxReplans: 1 }) });
    await store.save(config, initial.revision, { file: 'task.json', task });
    const saved = (await new ProjectStore(dir).read()).config;
    expect(saved.tasks[0]).toEqual({ id: 'task', name: 'Fixture', file: 'task.json' }); expect(saved.profiles[1]).toMatchObject({ id: 'strict', runRules: { maxReplans: 1 } });
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
  it('keeps executors on existing connections, and the planner, analysis and suggestion models on LLM connections', () => {
    const config = setup(); config.connections.push(connection('llm', { kind: 'llm' }));
    const withProfile = (change: (a: Profile, c: ProjectConfig) => void) => { const copy = structuredClone(config); change(copy.profiles[0]!, copy); return copy; };
    expect(() => parseConfig(withProfile((_, c) => { c.project.analysis.model = { connectionId: 'llm', modelId: 'writer' }; }))).not.toThrow();
    expect(() => parseConfig(withProfile((_, c) => { c.project.analysis.model = { connectionId: 'a', modelId: 'writer' }; }))).toThrow(/LLM connection/);
    expect(() => parseConfig(withProfile((_, c) => { c.project.analysis.model = { connectionId: 'ghost', modelId: 'writer' }; }))).toThrow();
    expect(() => parseConfig(withProfile((_, c) => { c.project.suggestions.model = { connectionId: 'a', modelId: 'writer' }; }))).toThrow(/LLM connection/);
    expect(() => parseConfig(withProfile((_, c) => { c.project.suggestions.model = { connectionId: 'llm', modelId: 'writer' }; }))).not.toThrow();
    expect(() => parseConfig(withProfile((_, c) => { c.profiles[0] = plannedWith(c.profiles[0]!, 'llm'); }))).not.toThrow();
    expect(() => parseConfig(withProfile((_, c) => { c.profiles[0] = plannedWith(c.profiles[0]!, 'a'); }))).toThrow(/plan with an LLM/);
    expect(() => parseConfig(withProfile(a => { (a as Record<string, unknown>).structure = 'planned'; }))).toThrow();
    // A profile without a planner is saved as it is; only a screen reader run of it is refused.
    expect(() => parseConfig(withProfile(a => { delete a.planner; a.executors.screenreader = { followPlan: true }; }))).not.toThrow();
    expect(() => parseConfig(withProfile(a => { a.executors.keyboard!.connectionId = 'ghost'; }))).toThrow(/does not exist/);
    expect(() => parseConfig(withProfile(a => { a.executors = {}; }))).not.toThrow();
    expect(() => parseConfig(withProfile(a => { (a.executors.screenreader as Executor).instructions = ' '; }))).toThrow();
  });
  it('joins a profile with its connections into the models a run calls', () => {
    const config = setup(); config.connections.push(connection('llm', { kind: 'llm', name: 'My LLM' }), connection('llm2', { kind: 'llm', name: 'Other LLM' }));
    const combo = plannedWith(profileWith('p', 'a', 'jev-latest'), 'llm');
    config.project.analysis.model = { connectionId: 'llm', modelId: 'writer' };
    expect(comboExecutor(config, combo, 'keyboard')).toMatchObject({ id: 'a', name: 'a · jev-latest', modelId: 'jev-latest', kind: 'decision', provider: 'custom', baseURL: 'http://127.0.0.1:1234', inputs: ['text', 'image'], maxChoices: 255, maxImages: 2 });
    expect(comboPlanner(config, combo)).toMatchObject({ id: 'llm', name: 'My LLM · planner', kind: 'llm' });
    expect(projectAnalysisModel(config)).toMatchObject({ id: 'llm', name: 'My LLM · writer', modelId: 'writer', kind: 'llm', inputs: ['text'] });
    // Without a project analysis model there is none; a decision connection is never an analysis or suggestion model.
    expect(projectAnalysisModel(setup())).toBeUndefined();
    expect(projectAnalysisModel({ ...config, project: { ...config.project, analysis: { ...config.project.analysis, model: { connectionId: 'a', modelId: 'own' } } } })).toBeUndefined();
    // Suggestions use their own model, otherwise the analysis model.
    expect(suggestionModel(config)).toMatchObject({ id: 'llm', modelId: 'writer' });
    config.project.suggestions.model = { connectionId: 'llm2', modelId: 'suggest' };
    expect(suggestionModel(config)).toMatchObject({ id: 'llm2', modelId: 'suggest' });
    // A text-only model takes no images, whatever maxImages says.
    expect(comboExecutor(config, { executors: { keyboard: { ...combo.executors.keyboard!, inputs: ['text'], maxImages: 2 } } }, 'keyboard')!.maxImages).toBe(0);
    expect(comboExecutor(config, defaultProfile(), 'screenreader')).toMatchObject({ id: 'rawstep-plan-follower' });
    expect(comboExecutor(config, { executors: {} }, 'screenreader')).toBeUndefined();
    expect(comboExecutor(config, { executors: { screenreader: { ...combo.executors.screenreader!, connectionId: 'ghost' } } }, 'screenreader')).toBeUndefined();
    expect(comboPlanner(config, { planner: { connectionId: 'a', modelId: 'x', instructions: '' } })).toBeUndefined();
  });
  it('lists the modes a profile can run', () => {
    const config = setup();
    expect(comboModes(config, config.profiles[0]!)).toEqual(['screenreader', 'keyboard']);
    // The default screen reader executor follows the plan, so it needs no model.
    expect(comboModes(config, defaultProfile())).toEqual(['screenreader']);
    expect(comboModes(config, { ...defaultProfile(), executors: {} })).toEqual([]);
    const textOnly = profileWith('t', 'a'); textOnly.executors.keyboard!.inputs = ['text'];
    expect(comboModes(config, textOnly)).toEqual(['screenreader']);
  });
  it('versions executor instructions by their wording, per profile and mode', () => {
    const combo = profileWith('p', 'a');
    expect(executorPrompt(combo, 'screenreader')).toMatchObject({ id: 'p.screenreader', name: 'p', instructions: instructions.screenreader });
    expect(executorPrompt(combo, 'keyboard')).toMatchObject({ id: 'p.keyboard' });
    const changed = { ...combo, executors: { ...combo.executors, screenreader: { ...combo.executors.screenreader!, instructions: 'Other wording.' } } };
    expect(executorPrompt(changed, 'screenreader')!.version).not.toBe(executorPrompt(combo, 'screenreader')!.version);
    expect(executorPrompt(defaultProfile(), 'keyboard')).toBeUndefined();
  });
  it('assumes images only for providers that pass them', () => {
    expect(defaultInputs({ kind: 'llm', provider: 'openai' })).toEqual(['text', 'image']);
    expect(defaultInputs({ kind: 'decision', provider: 'gateway' })).toEqual(['text']);
  });
});

describe('permissions', () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])('independently restricts type=%s and replace=%s in candidates and execution', (typeText, replaceText) => {
    const actionSet = { ...defaultProfile().actions, keyboard: { keys: [], intents: [], inputKeys: ['email'], typeText, replaceText } };
    const permissions = resolvePermissions('simulation', actionSet, task as never, 'keyboard');
    for (const candidates of [screenshotChoices(permissions as Required<typeof permissions>), speechChoices(permissions as Required<typeof permissions>)]) {
      expect(candidates.some(c => c.id === 'type:email')).toBe(typeText);
      expect(candidates.some(c => c.id === 'replace:email')).toBe(replaceText);
    }
    const check = (kind: 'typeText' | 'replaceText') => () => validateDecision({ action: { kind, input: 'email' } }, permissions as Required<typeof permissions>);
    if (typeText) expect(check('typeText')).not.toThrow(); else expect(check('typeText')).toThrow();
    if (replaceText) expect(check('replaceText')).not.toThrow(); else expect(check('replaceText')).toThrow();
    expect(permissions.keys).toEqual([]);
    expect(resolvePermissions('simulation', defaultProfile().actions, task as never, 'keyboard').keys).toEqual(defaultProfile().actions.keyboard.keys);
  });
  it('refuses actions the assistive technology lacks, listing them, and input names the task does not have', () => {
    const keys = { ...defaultProfile().actions, keyboard: { ...defaultProfile().actions.keyboard, keys: ['Tab', 'F13', 'F14'] } };
    expect(() => resolvePermissions('simulation', keys, task as never, 'keyboard')).toThrow(expect.objectContaining({ code: 'unsupported-action', message: expect.stringContaining('F13, F14') }));
    const intents = { ...defaultProfile().actions, screenreader: { ...defaultProfile().actions.screenreader, intents: ['next', 'levitate'] } };
    expect(() => resolvePermissions('simulation', intents, task as never, 'screenreader')).toThrow(expect.objectContaining({ code: 'unsupported-action', message: expect.stringContaining('levitate') }));
    const unknown = { ...defaultProfile().actions, keyboard: { ...defaultProfile().actions.keyboard, inputKeys: ['nope'], typeText: true } };
    expect(() => resolvePermissions('simulation', unknown, task as never, 'keyboard')).toThrow(expect.objectContaining({ code: 'unknown-input' }));
  });
  it('resolves a copy of the profile\'s actions, never changing the stored one', () => {
    const actionSet = defaultProfile().actions, before = structuredClone(actionSet);
    resolvePermissions('simulation', actionSet, task as never, 'keyboard').keys.push('X');
    expect(actionSet).toEqual(before);
  });
});

describe('project config', () => {
  it('loads a saved config without run rules and defaults them', async () => {
    const dir = await root(), store = new ProjectStore(dir), first = await store.initialize();
    const old = JSON.parse(JSON.stringify(first.config)); delete old.project; delete old.profiles[0].runRules; delete old.profiles[0].page; delete old.profiles[0].screenReader;
    await writeFile(store.path, JSON.stringify(old));
    const config = (await new ProjectStore(dir).read()).config;
    expect(config.profiles[0]).toMatchObject({ page: 'default', screenReader: 'simulation', runRules: { repetitionGuard: 'auto', modelGiveUp: false } });
    expect(config.project).toEqual({ analysis: { instructions: '' }, suggestions: {} });
    expect(defaultConfig().profiles[0]!.runRules).toMatchObject({ repetitionGuard: 'auto', modelGiveUp: false });
    const withRules = (runRules: unknown) => ({ ...old, profiles: [{ ...old.profiles[0], runRules }] });
    expect(() => configSchema.parse(withRules({ repetitionGuard: 'sometimes' }))).toThrow();
    expect(() => configSchema.parse(withRules({ unknownRule: 1 }))).toThrow();
  });
  it('resolves auto by model kind and honours explicit on/off', () => {
    const llm = { kind: 'llm' as const }, decision = { kind: 'decision' as const };
    expect(resolveRepetitionGuard('auto', decision)).toBe(false);
    expect(resolveRepetitionGuard('auto', llm)).toBe(true);
    expect(resolveRepetitionGuard('on', decision)).toBe(true);
    expect(resolveRepetitionGuard('off', llm)).toBe(false);
    // Speech repeats exactly, so auto guards screen reader runs for every model.
    expect(resolveRepetitionGuard('auto', decision, 'screenreader')).toBe(true);
    expect(resolveRepetitionGuard('off', decision, 'screenreader')).toBe(false);
  });
  it('accepts only version 5 configs', () => {
    const config = defaultConfig();
    expect(config.version).toBe(5);
    expect(parseConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(() => parseConfig({ ...config, version: 4 })).toThrow();
    expect(() => parseConfig({ version: 5, connections: [], tasks: [], agents: [], machine: {} })).toThrow();
    expect(() => parseConfig({ ...config, combos: [] })).toThrow();
    expect(() => parseConfig({ ...config, profiles: [] })).toThrow();
    expect(() => parseConfig({ ...config, profiles: [{ ...config.profiles[0], screenReader: 'jaws' }] })).toThrow();
  });
  it('starts a project with one default profile', () => {
    const config = defaultConfig();
    expect(config.profiles.map(p => p.id)).toEqual(['default']); expect(config.profiles[0]).toMatchObject({ executors: { screenreader: { followPlan: true } }, page: 'default', screenReader: 'simulation' }); expect(config.profiles[0]).not.toHaveProperty('structure'); expect(config.profiles[0]).not.toHaveProperty('planner');
    expect(config.profiles[0]!.actions.keyboard.keys).toContain('Tab'); expect(config.machine.atEndpoints).toEqual({ voiceover: '', nvda: '' });
  });
  it('finds connections and profiles by id first, then by name', () => {
    const list = [{ id: 'one', name: 'two' }, { id: 'two', name: 'one' }];
    expect(findByIdOrName(list, 'one')).toBe(list[0]); expect(findByIdOrName(list, 'two')).toBe(list[1]); expect(findByIdOrName(list, 'three')).toBeUndefined();
  });
  it('keeps the profile\'s run rules whole and a task\'s own fields apart from them', () => {
    const config = defaultConfig(); config.tasks.push({ id: 'task', name: 'T', file: 't.json', analysisInstructions: 'Look at forms.' });
    const parsed = parseConfig(JSON.parse(JSON.stringify(config)));
    expect(parsed.tasks[0]).toEqual({ id: 'task', name: 'T', file: 't.json', analysisInstructions: 'Look at forms.' });
    expect(() => taskSchema.parse({ id: 'task', name: 'T', file: 't.json', runRules: { maxReplans: 4 } })).toThrow();
    expect(() => taskSchema.parse({ id: 'task', name: 'T', file: 't.json', profileId: 'default' })).toThrow();
    expect(parsed.profiles[0]!.runRules).toEqual(defaultConfig().profiles[0]!.runRules);
  });
  it('layers run rules for one run over the profile\'s, other fields from the profile', () => {
    const config = setup(); config.profiles[0]!.runRules = resolveRunRules(config.profiles[0]!, { maxStateVisits: 7, maxReplans: 3, failureLimit: 6 });
    const profile = config.profiles[0]!, override = { maxStateVisits: 2, maxReplans: 5 };
    const rules = resolveRunRules(profile, override);
    expect(rules).toEqual({ ...profile.runRules, maxStateVisits: 2, maxReplans: 5 });
    expect(profile.runRules.maxStateVisits).toBe(7);
    const checked = checkRun({ config, task: task as never, taskEntry: config.tasks[0], runRules: override, mode: 'keyboard', ...profileConditions(profile) });
    expect(checked.settings.runRules).toEqual(rules);
  });
});

describe('first profile of a project', () => {
  function profilesConfig(): ProjectConfig {
    const config = setup();
    config.profiles.push(profileWith('p2', 'a', 'm-a', 'Second'), profileWith('p3', 'b', 'm-b', 'Third'));
    return config;
  }
  it('is the project\'s first, whatever the tasks hold', () => {
    const config = profilesConfig();
    expect(firstProfile(config).id).toBe('default');
    config.profiles.reverse();
    expect(firstProfile(config).id).toBe('p3');
  });
  it('reads the conditions of a run off the profile, each named after it', () => {
    const profile = { ...profileWith('p2', 'a', 'm-a', 'Second'), page: 'narrow', screenReader: 'nvda' as const };
    const conditions = profileConditions(profile);
    expect(conditions.profile).toBe(profile);
    expect(conditions.combo).toMatchObject({ id: 'p2', name: 'Second', structure: 'solo', executors: profile.executors });
    expect(conditions.actionSet).toMatchObject({ id: 'p2', name: 'Second', keyboard: profile.actions.keyboard, screenreader: profile.actions.screenreader });
    expect(conditions.pageEnvironment).toMatchObject({ id: 'p2', profile: 'narrow' }); expect(conditions.atEnvironment).toMatchObject({ id: 'p2', backend: 'nvda' });
  });
  it('merges run rules as the profile\'s, then those of one run', () => {
    const profile = defaultProfile(); profile.runRules = resolveRunRules(profile, { maxReplans: 5, modelGiveUp: true });
    expect(resolveRunRules(profile)).toMatchObject({ maxReplans: 5, modelGiveUp: true, failureLimit: 2, noChangeLimit: 3 });
    expect(resolveRunRules(profile, { maxReplans: 3, failureLimit: 4 }, undefined, { failureLimit: 7, modelGiveUp: false })).toMatchObject({ maxReplans: 3, failureLimit: 7, modelGiveUp: false, noChangeLimit: 3 });
    expect(() => resolveRunRules(profile, { maxReplans: -1 })).toThrow();
    expect(profile.runRules.maxReplans).toBe(5);
  });
  it('records the conditions of a run by content, with the profile it was made with', () => {
    const config = setup(), conditions = profileConditions(config.profiles[0]!);
    const check = assertRunnable(checkRun({ config, task: task as never, taskEntry: config.tasks[0], ...conditions, mode: 'keyboard' }));
    const record = conditionsRecord(conditions, check);
    expect(record).toMatchObject({
      profile: { id: 'default', name: 'Default' },
      combo: { id: 'default', structure: 'solo', executor: 'a · m-a', prompt: { id: 'default.keyboard' } },
      actionSet: { id: 'default', permissions: { keys: expect.arrayContaining(['Tab']) } },
      pageEnvironment: { id: 'default', profile: 'default' }, atEnvironment: { id: 'default', backend: 'simulation' },
      runRules: { maxReplans: expect.any(Number) },
    });
    expect(record).not.toHaveProperty('preset');
    const spec = runSpecOf(task as never, 'keyboard', conditions, check);
    expect(spec).toMatchObject({ mode: 'keyboard', backend: 'simulation', executor: { historyLimit: 12, focusGate: false }, conditions: record });
  });
});

describe('run checks', () => {
  const choiceOf = (config: ProjectConfig, mode: 'keyboard' | 'screenreader' = 'keyboard') => config.profiles[0]!.executors[mode]! as Executor;
  const check = (config: ProjectConfig, change: (c: ProjectConfig) => void = () => {}, extra: Partial<Parameters<typeof checkRun>[0]> = {}) => {
    change(config);
    return checkRun({ config, task: task as never, taskEntry: config.tasks[0], mode: 'keyboard', ...profileConditions(config.profiles[0]!), ...extra });
  };
  const withLlm = (c: ProjectConfig) => { c.connections.push(connection('llm', { kind: 'llm' })); };
  it('accepts a supported combination and returns its settings and the profile\'s executor with its instructions', () => {
    const result = check(setup());
    expect(result.problem).toBeUndefined(); expect(result.settings.runRules.maxReplans).toBeGreaterThan(0); expect(result.warnings).toEqual([]);
    expect(result.model).toMatchObject({ id: 'a', modelId: 'm-a', name: 'a · m-a' }); expect(result.analysisModel).toBeUndefined();
    expect(result.prompt).toMatchObject({ id: 'default.keyboard', instructions: instructions.keyboard });
    expect(assertRunnable(result).permissions.keys).toContain('Tab');
  });
  it.each([
    ['profile-without-executor', (c: ProjectConfig) => { delete c.profiles[0]!.executors.keyboard; }],
    ['model-needs-images', (c: ProjectConfig) => { choiceOf(c).inputs = ['text']; }],
    ['too-many-choices', (c: ProjectConfig) => { choiceOf(c).maxChoices = 4; }],
    ['unsupported-action', (c: ProjectConfig) => { c.profiles[0]!.actions.keyboard.keys = ['F13']; }],
    ['focus-gate-llm', (c: ProjectConfig) => { c.connections[0]!.kind = 'llm'; choiceOf(c).focusGate = true; }],
    ['environment-unsupported', (c: ProjectConfig) => { c.profiles[0]!.page = 'zoom-200'; }],
  ])('reports %s as the problem, not by throwing', (code, change) => {
    const result = check(setup(), change);
    expect(result.problem).toBeInstanceOf(ProjectError); expect(result.problem!.code).toBe(code);
    expect(() => assertRunnable(result)).toThrow(result.problem!);
    expect(result.permissions).toBeDefined();
  });
  it('explains a missing action by name, and a profile without an executor for the mode by what to do', () => {
    expect(check(setup(), c => { c.profiles[0]!.actions.keyboard.keys = ['Tab', 'F13', 'F14']; }).problem!.message).toMatch(/F13, F14/);
    const none = check(setup(), c => { delete c.profiles[0]!.executors.keyboard; });
    expect(none.model).toBeUndefined(); expect(none.problem!.message).toMatch(/no keyboard executor.*images/i);
    expect(check(setup(), c => { delete c.profiles[0]!.executors.keyboard; }, { mode: 'screenreader' }).problem).toBeUndefined();
    expect(check(setup(), c => { delete c.profiles[0]!.executors.screenreader; }, { mode: 'screenreader' }).problem).toMatchObject({ code: 'profile-without-executor', message: expect.stringMatching(/no screen reader executor/) });
    expect(check(setup(), c => { choiceOf(c).inputs = ['text']; }).problem!.message).toMatch(/image/);
    expect(check(setup(), c => { choiceOf(c, 'screenreader').inputs = ['text']; }, { mode: 'screenreader' }).problem).toBeUndefined();
    expect(check(setup(), c => { choiceOf(c, 'screenreader').inputs = ['image']; }, { mode: 'screenreader' }).problem?.code).toBe('model-needs-text');
    expect(check(setup(), c => { choiceOf(c).maxImages = 1; }).problem?.code).toBe('model-needs-images');
  });
  it('takes the focus gate from the keyboard executor and applies it to keyboard decisions by LLMs only', () => {
    expect(check(setup(), c => { choiceOf(c).focusGate = true; }).problem).toBeUndefined();
    // The screen reader executor has no focus gate to judge; only the keyboard executor's setting counts.
    expect(check(setup(), c => { c.connections[0]!.kind = 'llm'; choiceOf(c, 'screenreader').focusGate = true; }, { mode: 'screenreader' }).problem).toBeUndefined();
    expect(check(setup(), c => { c.connections[0]!.kind = 'llm'; choiceOf(c, 'screenreader').focusGate = true; }).problem).toBeUndefined();
  });
  it('counts three stop choices only while the model may give up', () => {
    // Four keys plus the stop choices: 7 with give-up, 5 without.
    const limit = (modelGiveUp: boolean, maxChoices: number) => check(setup(), c => { choiceOf(c).maxChoices = maxChoices; c.profiles[0]!.runRules.modelGiveUp = modelGiveUp; }).problem?.code;
    expect(limit(true, 6)).toBe('too-many-choices'); expect(limit(true, 7)).toBeUndefined();
    expect(limit(false, 4)).toBe('too-many-choices'); expect(limit(false, 5)).toBeUndefined();
    // A run can turn give-up on for itself.
    const viaRun = check(setup(), c => { choiceOf(c).maxChoices = 6; }, { runRules: { modelGiveUp: true } }).problem?.code;
    expect(viaRun).toBe('too-many-choices');
  });
  it('merges the run rules of the profile and the run, the run last', () => {
    const result = check(setup(), c => { c.profiles[0]!.runRules.maxReplans = 5; c.profiles[0]!.runRules.stepActionLimit = 9; c.profiles[0]!.runRules.noChangeLimit = 6; },
      { runRules: { failureLimit: 7, maxReplans: 1 } });
    expect(result.settings.runRules).toMatchObject({ maxReplans: 1, stepActionLimit: 9, failureLimit: 7, noChangeLimit: 6, modelGiveUp: false });
    expect(check(setup(), c => { c.project.analysis.instructions = 'Project focus.'; }).settings.analysisInstructions).toBe('Project focus.');
    expect(check(setup(), c => { c.project.analysis.instructions = 'Project focus.'; c.tasks[0]!.analysisInstructions = 'Task focus.'; }).settings.analysisInstructions).toBe('Task focus.');
  });
  it('never blocks a run on analysis: a model that is not an LLM only warns, only the project\'s analysis model is used', () => {
    const bad = check(setup(), c => { c.project.analysis.model = { connectionId: 'b', modelId: 'writer' }; });
    expect(bad.problem).toBeUndefined(); expect(bad.analysisModel).toBeUndefined(); expect(bad.warnings).toEqual([expect.stringMatching(/not on an LLM connection.*rules only/)]);
    const project = check(setup(), c => { withLlm(c); c.project.analysis.model = { connectionId: 'llm', modelId: 'writer' }; });
    expect(project.problem).toBeUndefined(); expect(project.warnings).toEqual([]); expect(project.analysisModel).toMatchObject({ id: 'llm', modelId: 'writer', kind: 'llm' });
    expect(check(setup()).warnings).toEqual([]);
    expect(check(setup(), () => {}, { mode: 'screenreader', diagnoseStop: true }).problem?.code).toBe('diagnose-keyboard-only');
  });
  describe('planned profiles', () => {
    const planned = (c: ProjectConfig, instructionsText = 'Plan like an expert.') => { withLlm(c); c.profiles[0] = plannedWith(c.profiles[0]!, 'llm', 'planner', instructionsText); };
    it('plan in screen reader mode, with the planner\'s model and added instructions', () => {
      const reader = check(setup(), c => planned(c), { mode: 'screenreader' });
      expect(reader.problem).toBeUndefined(); expect(reader.warnings).toEqual([]);
      expect(reader.plannerModel).toMatchObject({ id: 'llm', modelId: 'planner', kind: 'llm' }); expect(reader.plannerInstructions).toBe('Plan like an expert.');
    });
    it('refuse a screen reader run that has no planner, and leave the profile saveable', () => {
      expect(check(setup(), c => { delete c.profiles[0]!.planner; }, { mode: 'screenreader' }).problem?.code).toBe('planner-model-invalid');
      expect(check(setup(), c => { delete c.profiles[0]!.planner; c.profiles[0]!.executors.screenreader = { followPlan: true }; }, { mode: 'screenreader' }).problem?.code).toBe('planner-model-invalid');
      expect(check(setup(), c => { delete c.profiles[0]!.planner; }).problem).toBeUndefined();
    });
    it('give keyboard runs no planner and no warning, whatever planner the profile has', () => {
      const keyboard = check(setup(), c => planned(c));
      expect(keyboard.problem).toBeUndefined(); expect(keyboard.plannerModel).toBeUndefined(); expect(keyboard.plannerInstructions).toBeUndefined();
      expect(keyboard.warnings).toEqual([]);
    });
    it('need a planner on an LLM connection or a plan file in screen reader mode, and count the four task choices only when the executor controls tasks', () => {
      expect(check(setup(), c => { c.profiles[0] = plannedWith(c.profiles[0]!, 'b'); }, { mode: 'screenreader' }).problem?.code).toBe('planner-model-invalid');
      expect(check(setup(), c => { c.profiles[0] = plannedWith(c.profiles[0]!, 'b'); }).problem).toBeUndefined();
      const choices = (maxChoices: number, executorControls = false) => check(setup(), c => { planned(c); choiceOf(c, 'screenreader').maxChoices = maxChoices; if (executorControls) c.profiles[0]!.runRules.taskControl = 'executor'; }, { mode: 'screenreader' }).problem?.code;
      const base = check(setup(), () => {}, { mode: 'screenreader' }).permissions, count = base.keys.length + base.intents.length + 1;
      expect(choices(count)).toBeUndefined();
      expect(choices(count + 3, true)).toBe('too-many-choices'); expect(choices(count + 4, true)).toBeUndefined();
    });
    it('give a file planner the task\'s own plan file, and record it in the conditions', () => {
      const filed = check(setup(), c => { Object.assign(c.profiles[0]!, { planner: { planFile: 'plans/{task}/L2.json' } }); }, { mode: 'screenreader', taskEntry: { file: 'tasks/cart.json' } });
      expect(filed.problem).toBeUndefined(); expect(filed.plannerPlanFile).toBe('plans/cart/L2.json'); expect(filed.plannerModel).toBeUndefined();
      expect(check(setup(), c => { Object.assign(c.profiles[0]!, { planner: { planFile: 'plans/{task}/L2.json' } }); }, { mode: 'screenreader', taskEntry: {} }).problem?.code).toBe('plan-file-task');
    });
    it('run a profile that follows its plan without a screen reader executor model or its key', () => {
      const follow = (c: ProjectConfig) => { Object.assign(c.profiles[0]!, { planner: { planFile: 'plans/{task}/L2.json' } }); c.profiles[0]!.executors.screenreader = { followPlan: true }; };
      const result = check(setup(), follow, { mode: 'screenreader', taskEntry: { file: 'tasks/cart.json' } });
      expect(result.problem).toBeUndefined();
      expect(result.model).toMatchObject({ id: 'rawstep-plan-follower', modelId: 'follow-plan' }); expect(result.prompt).toMatchObject({ instructions: '' });
      expect(check(setup(), c => { follow(c); c.profiles[0]!.runRules.taskControl = 'executor'; }, { mode: 'screenreader', taskEntry: { file: 'tasks/cart.json' } }).problem?.code).toBe('follow-plan-task-control');
      // Keyboard runs still need their own executor.
      expect(check(setup(), follow, { mode: 'keyboard', taskEntry: { file: 'tasks/cart.json' } }).model).toMatchObject({ id: 'a' });
      // Following the plan cannot type: a task whose profile enters text into its inputs needs an executor model.
      const typing = (c: ProjectConfig) => { follow(c); c.profiles[0]!.actions.screenreader = { ...c.profiles[0]!.actions.screenreader, inputKeys: ['email'], typeText: true }; };
      expect(check(setup(), typing, { mode: 'screenreader', taskEntry: { file: 'tasks/cart.json' } }).problem?.code).toBe('follow-plan-text-entry');
    });
    it('give a constant plan file to any task, registered or not; only {task} needs the task file', () => {
      const constant = (c: ProjectConfig) => { Object.assign(c.profiles[0]!, { planner: { planFile: 'plans/common.json' } }); };
      const result = check(setup(), constant, { mode: 'screenreader', taskEntry: {} });
      expect(result.problem).toBeUndefined(); expect(result.plannerPlanFile).toBe('plans/common.json');
    });
    it('hand the screen reader executor\'s latitude to the run, and none when the plan is followed', () => {
      const config = setup(); Object.assign(config.profiles[0]!, { planner: { planFile: 'plans/{task}/L2.json' } }); choiceOf(config, 'screenreader').latitude = 'direction';
      const conditions = profileConditions(config.profiles[0]!);
      const spec = (c: ProjectConfig) => runSpecOf(task as never, 'screenreader', conditions, assertRunnable(check(c, () => {}, { mode: 'screenreader', taskEntry: { file: 'tasks/cart.json' } })));
      expect(spec(config).executor).toMatchObject({ latitude: 'direction' });
      config.profiles[0]!.executors.screenreader = { followPlan: true };
      expect(spec(config).executor).toMatchObject({ latitude: 'none' });
    });
  });
  describe('assistive technology', () => {
    it('checks the host for native screen readers, in screen reader mode only', () => {
      const nvda = { id: 'nvda', name: 'NVDA', backend: 'nvda' as const };
      if (process.platform !== 'win32') expect(check(setup(), () => {}, { mode: 'screenreader', atEnvironment: nvda }).problem?.code).toBe('nvda-windows');
      // Keyboard runs never touch a screen reader, whatever environment is picked.
      expect(check(setup(), () => {}, { atEnvironment: nvda }).problem).toBeUndefined();
      if (process.platform !== 'darwin') expect(check(setup(), () => {}, { mode: 'screenreader', atEnvironment: { id: 'vo', name: 'VO', backend: 'voiceover' } }).problem?.code).toBe('voiceover-macos');
    });
    it.skipIf(process.platform !== 'darwin')('allows only a loopback AT Driver address for VoiceOver, from the machine settings', () => {
      const vo = { id: 'vo', name: 'VO', backend: 'voiceover' as const };
      expect(check(setup(), () => {}, { mode: 'screenreader', atEnvironment: vo }).problem).toBeUndefined();
      expect(check(setup(), c => { c.machine.atEndpoints.voiceover = 'ws://127.0.0.1:9999/session'; }, { mode: 'screenreader', atEnvironment: vo }).problem).toBeUndefined();
      expect(check(setup(), c => { c.machine.atEndpoints.voiceover = 'ws://example.com:4382/session'; }, { mode: 'screenreader', atEnvironment: vo }).problem?.code).toBe('endpoint-not-loopback');
    });
  });
  it('knows which models can serve a mode', () => {
    const a = comboExecutor(setup(), setup().profiles[0]!, 'keyboard')!;
    expect(supportsMode(a, 'keyboard')).toBe(true); expect(supportsMode(a, 'screenreader')).toBe(true);
    expect(supportsMode({ ...a, inputs: ['text'], maxImages: 0 }, 'keyboard')).toBe(false);
    expect(supportsMode({ ...a, inputs: ['image'], maxImages: 2 }, 'screenreader')).toBe(false);
    expect(supportsMode({ ...a, maxImages: 1 }, 'keyboard')).toBe(false);
  });
  it('lists the backend capabilities of each mode and backend', () => {
    expect(backendCapabilities('simulation', 'keyboard').keys).toContain('Tab');
    expect(backendCapabilities('simulation', 'screenreader').intents).toContain('next');
    expect(backendCapabilities('voiceover', 'screenreader').intents.length).toBeGreaterThan(0);
    expect(backendCapabilities('nvda', 'screenreader').intents.length).toBeGreaterThan(0);
    // Keyboard mode always uses the screenshot keyboard, whichever screen reader is picked.
    expect(backendCapabilities('nvda', 'keyboard').keys).toContain('Tab');
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

  it('runs a registered task with the executor of its profile, writing under .rawstep/runs and returning the conditions', async () => {
    const { dir } = await project(), { calls, execute } = player(recorded(['Tab', 'Enter'], 'success'));
    const result = await runTask('task', { projectDir: dir }, { execute });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.spec).toMatchObject({ mode: 'keyboard', backend: 'simulation', model: { id: 'a' }, prompt: { id: 'default.keyboard', instructions: instructions.keyboard }, task: { goal: 'Complete fixture' }, environment: expect.objectContaining({ id: 'default' }) });
    expect(calls[0]!.spec.permissions.keys).toContain('Tab');
    expect(dirname(dirname(calls[0]!.outDir))).toBe(join(dir, '.rawstep', 'runs')); expect(basename(dirname(calls[0]!.outDir))).toMatch(/^[0-9T-]+Z-[0-9a-f]{8}$/); expect(basename(calls[0]!.outDir)).toBe('run-1');
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ outDir: calls[0]!.outDir, outcome: { status: 'success', steps: 2 }, hints: { goalReached: true, steps: 2 } });
    expect(result.runs[0]!.runId).toBe(result.runs[0]!.hints.runId);
    for (const file of ['trace.json', 'hints.json', 'analysis.json', 'report.html']) expect(await readFile(join(calls[0]!.outDir, file), 'utf8')).toBeTruthy();
    expect((await readTrace(calls[0]!.outDir)).runId).toBe(result.runs[0]!.runId);
    expect(result.findings).toEqual([]); expect(result.warnings).toEqual([]);
    expect(result.conditions).toMatchObject({
      profile: { id: 'default', name: 'Default' }, combo: { id: 'default', structure: 'solo', executor: 'a · m-a', prompt: { id: 'default.keyboard' } }, actionSet: { id: 'default' }, pageEnvironment: { id: 'default' },
      atEnvironment: { id: 'default', backend: 'simulation' }, runRules: { maxReplans: expect.any(Number) },
    });
    expect(result.conditions).toEqual(calls[0]!.spec.conditions);
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
  it('resolves the profile by id or by name, and reports an unknown one with the choices', async () => {
    const { dir } = await project(config => {
      config.profiles.push({ ...profileWith('zoom', 'b', 'm-b', 'Zoom check'), page: 'narrow' });
      config.profiles.push({ ...profileWith('wide', 'a', 'm-a', 'Wide'), actions: { ...config.profiles[0]!.actions, keyboard: { keys: ['Tab'], intents: [], typeText: false, replaceText: false } } });
    });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'), recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir, profile: 'zoom' }, { execute });
    await runTask('task', { projectDir: dir, profile: 'Zoom check' }, { execute });
    await runTask('task', { projectDir: dir, profile: 'Default' }, { execute });
    await runTask('task', { projectDir: dir, profile: 'Wide' }, { execute });
    expect(calls.map(c => c.spec.model.id)).toEqual(['b', 'b', 'a', 'a']);
    expect(calls[0]!.spec.model).toMatchObject({ modelId: 'm-b', name: 'b · m-b' });
    expect(calls.map(c => (c.spec.environment as { id: string }).id)).toEqual(['narrow', 'narrow', 'default', 'default']);
    expect(calls[3]!.spec.permissions.keys).toEqual(['Tab']); expect(calls[3]!.spec.conditions).toMatchObject({ profile: { id: 'wide', name: 'Wide' }, actionSet: { id: 'wide' } });
    await expect(runTask('task', { projectDir: dir, profile: 'nope' }, { execute })).rejects.toMatchObject({ code: 'profile-not-found', message: expect.stringContaining('Zoom check (zoom)') });
    expect(calls).toHaveLength(4);
  });
  it('uses the first profile unless one is named, with that profile\'s executor and instructions for the mode', async () => {
    const { dir } = await project(config => { config.profiles.push(plannedWith(profileWith('second', 'b', 'm-b', 'Second'), 'setup-llm')); });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir, mode: 'screenreader' }, { execute });
    expect(calls[0]!.spec.permissions.intents).toContain('next'); expect(calls[0]!.spec.mode).toBe('screenreader');
    expect(calls[0]!.spec.model.id).toBe('a'); expect(calls[0]!.spec.environment).toEqual(expect.objectContaining({ id: 'default' }));
    expect(calls[0]!.spec.prompt).toMatchObject({ id: 'default.screenreader', instructions: instructions.screenreader });
    expect(calls[0]!.spec.conditions).toMatchObject({ profile: { id: 'default', name: 'Default' } });
    // A named profile is used instead of the first.
    await runTask('task', { projectDir: dir, profile: 'second', mode: 'screenreader' }, { execute });
    expect(calls[1]!.spec.model.id).toBe('b'); expect(calls[1]!.spec.prompt).toMatchObject({ id: 'second.screenreader' });
  });
  it('merges run rules as the profile\'s and then the options\'', async () => {
    const { dir } = await project(config => { config.profiles[0]!.runRules = resolveRunRules(config.profiles[0]!, { maxReplans: 8, stepActionLimit: 20, failureLimit: 3 }); });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.settings.runRules).toMatchObject({ maxReplans: 8, stepActionLimit: 20, failureLimit: 3 });
    const result = await runTask('task', { projectDir: dir, runRules: { maxReplans: 1 } }, { execute });
    expect(calls[1]!.spec.settings.runRules).toMatchObject({ maxReplans: 1, stepActionLimit: 20, failureLimit: 3 });
    expect(result.conditions).toMatchObject({ runRules: { maxReplans: 1, failureLimit: 3 } });
  });
  it('runs the first profile with its own actions, for a registered task and an unregistered task file alike', async () => {
    const { dir } = await project(config => {
      config.profiles.unshift({ ...profileWith('task-keys', 'a', 'm-a', 'Task keys'), actions: { ...config.profiles[0]!.actions, keyboard: { keys: ['Tab'], intents: [], typeText: false, replaceText: false } } });
    });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    const result = await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.permissions.keys).toEqual(['Tab']);
    expect(result.conditions).toMatchObject({ profile: { id: 'task-keys', name: 'Task keys' }, actionSet: { id: 'task-keys' } });
    await writeFile(join(dir, 'other.json'), JSON.stringify({ ...task, goal: 'Other goal' }));
    await runTask('other.json', { projectDir: dir }, { execute });
    expect(calls[1]!.spec.permissions.keys).toEqual(['Tab']); expect(calls[1]!.spec.conditions).toMatchObject({ profile: { id: 'task-keys' } });
  });
  it('explains when the profile has no executor for the mode or it cannot take images', async () => {
    const text = await project(config => { config.profiles[0]!.executors.keyboard!.inputs = ['text']; });
    await expect(runTask('task', { projectDir: text.dir }, { execute: player().execute })).rejects.toMatchObject({ code: 'model-needs-images', message: expect.stringMatching(/Keyboard runs.*image/) });
    expect((await runTask('task', { projectDir: text.dir, mode: 'screenreader' }, { execute: player(recorded(['Enter'], 'success')).execute })).runs).toHaveLength(1);
    const none = await project(config => { config.profiles[0]!.executors = {}; });
    await expect(runTask('task', { projectDir: none.dir }, { execute: player().execute })).rejects.toMatchObject({ code: 'profile-without-executor', message: expect.stringMatching(/no keyboard executor/i) });
    // Another profile with an executor still runs: nothing else is picked for the profile that has none.
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    const mixed = await project(config => { config.profiles[0]!.executors = {}; config.profiles.push(profileWith('second', 'b')); });
    await runTask('task', { projectDir: mixed.dir, profile: 'second' }, { execute });
    expect(calls[0]!.spec.model.id).toBe('b');
    await expect(runTask('task', { projectDir: mixed.dir }, { execute })).rejects.toMatchObject({ code: 'profile-without-executor' });
  });
  describe('planned profiles', () => {
    const planning = (config: ProjectConfig) => {
      config.connections.push(connection('planner', { kind: 'llm', provider: 'openai' }));
      config.profiles[0] = plannedWith(config.profiles[0]!, 'planner', 'plan-model', 'Be careful.');
    };
    it('plan only in screen reader mode, with the planner\'s key; keyboard runs get no planner, no warning and need no planner key', async () => {
      const { dir, store } = await project(planning), { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
      const keyboard = await runTask('task', { projectDir: dir }, { execute });
      expect(calls[0]!.spec.plannerModel).toBeUndefined();
      expect(keyboard.warnings).toEqual([]);
      expect(keyboard.conditions).toMatchObject({ combo: { structure: 'solo' } });
      expect(keyboard.conditions!.combo).not.toHaveProperty('planner');
      await expect(runTask('task', { projectDir: dir, mode: 'screenreader' }, { execute })).rejects.toMatchObject({ code: 'missing-credential', message: expect.stringContaining('RAWSTEP_OPENAI_API_KEY') });
      await store.setCredential('openai', 'sk-planner-key');
      const reader = await runTask('task', { projectDir: dir, mode: 'screenreader' }, { execute });
      expect(calls).toHaveLength(2);
      expect(calls[1]!.spec).toMatchObject({ plannerModel: { id: 'planner', modelId: 'plan-model' }, plannerInstructions: 'Be careful.' });
      expect(reader.warnings).toEqual([]); expect(reader.conditions).toMatchObject({ combo: { planner: 'planner · plan-model' } });
    });
  });
  describe('assistive technology', () => {
    it('passes the profile\'s screen reader to screen reader runs, and ignores it in keyboard runs', async () => {
      const { dir } = await project(config => { config.profiles.push({ ...plannedWith(profileWith('nvda', 'a', 'm-a', 'NVDA'), 'setup-llm'), screenReader: 'nvda' }); });
      const { calls, execute } = player(recorded(['Enter'], 'success'));
      await runTask('task', { projectDir: dir, profile: 'nvda' }, { execute });
      expect(calls[0]!.spec.backend).toBe('nvda');
      if (process.platform !== 'win32') await expect(runTask('task', { projectDir: dir, mode: 'screenreader', profile: 'nvda' }, { execute })).rejects.toMatchObject({ code: 'nvda-windows' });
      expect(calls).toHaveLength(1);
    });
  });
  it('runs in the profile\'s mode, unless the options name one', async () => {
    const { dir } = await project(config => { config.profiles.push(plannedWith(profileWith('reader', 'a', 'm-a', 'Reader', 'screenreader'), 'setup-llm')); });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir }, { execute });
    await runTask('task', { projectDir: dir, profile: 'reader' }, { execute });
    await runTask('task', { projectDir: dir, profile: 'reader', mode: 'keyboard' }, { execute });
    expect(calls.map(c => c.spec.mode)).toEqual(['keyboard', 'screenreader', 'keyboard']);
  });
  it('runs an unregistered task file with the first profile, resolving the path from the project directory', async () => {
    const { dir } = await project(config => { config.profiles.push(profileWith('second', 'b', 'm-b', 'Second')); });
    await writeFile(join(dir, 'other.json'), JSON.stringify({ ...task, goal: 'Other goal' }));
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('other.json', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.task.goal).toBe('Other goal'); expect(calls[0]!.spec.prompt.id).toBe('default.keyboard'); expect(calls[0]!.spec.model.id).toBe('a');
    // The registered task's own file is recognized, and runs with the first profile too: a task names none.
    await runTask('./task.json', { projectDir: dir, mode: 'keyboard' }, { execute });
    expect(calls[1]!.spec.task.goal).toBe('Complete fixture'); expect(calls[1]!.spec.model.id).toBe('a');
    await expect(runTask('missing.json', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'task-not-found', message: expect.stringContaining('Known tasks: task') });
    await writeFile(join(dir, 'broken.json'), '{nope');
    await expect(runTask('broken.json', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'invalid-task' });
  });
  it('says what to do when there is no config, an old config, no matching setup or bad options', async () => {
    const empty = await root(), { execute } = player();
    await expect(runTask('task', { projectDir: empty }, { execute })).rejects.toMatchObject({ code: 'no-config', message: expect.stringMatching(/rawstep\.config\.json.*rawstep init.*rawstep ui/) });
    const old = await root(); await writeFile(join(old, 'rawstep.config.json'), JSON.stringify({ version: 2 }));
    await expect(runTask('task', { projectDir: old }, { execute })).rejects.toMatchObject({ code: 'old-config', message: expect.stringMatching(/version 2.*rawstep init/) });
    const { dir } = await project();
    await expect(runTask('task', { projectDir: dir, repeat: 0 }, { execute })).rejects.toMatchObject({ code: 'invalid-repeat' });
    await expect(runTask('task', { projectDir: dir, repeat: 1.5 }, { execute })).rejects.toMatchObject({ code: 'invalid-repeat' });
    await expect(runTask('task', { projectDir: dir, mode: 'mouse' as never }, { execute })).rejects.toMatchObject({ code: 'invalid-mode' });
    const unsupported = await project(config => { config.profiles[0]!.page = 'zoom-200'; });
    await expect(runTask('task', { projectDir: unsupported.dir }, { execute })).rejects.toMatchObject({ code: 'environment-unsupported' });
    await expect(runTask('task', { projectDir: dir, diagnoseStop: true, mode: 'screenreader' }, { execute })).rejects.toMatchObject({ code: 'diagnose-keyboard-only' });
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
  describe('analysis', () => {
    const analysed = (config: ProjectConfig) => { config.connections.push(connection('writer', { kind: 'llm', provider: 'openai' })); config.project.analysis.model = { connectionId: 'writer', modelId: 'gpt-fixture' }; };
    it('never blocks a run: without the analysis key the runs get the rule-based analysis and a warning', async () => {
      const { dir, store } = await project(analysed);
      const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
      const result = await runTask('task', { projectDir: dir }, { execute });
      expect(calls).toHaveLength(1); expect(result.runs).toHaveLength(1);
      expect(result.warnings).toEqual([expect.stringMatching(/key for the analysis model "writer · gpt-fixture" is not set.*rule-based/)]);
      expect(JSON.parse(await readFile(join(calls[0]!.outDir, 'analysis.json'), 'utf8')).status).not.toBe('failed');
      await store.setCredential('openai', 'sk-fixture-key');
      // With the key set there is nothing to warn about (the model is called only after the run, never here).
      const fetched = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
      try { expect((await runTask('task', { projectDir: dir }, { execute })).warnings).toEqual([]); } finally { fetched.mockRestore(); }
    });
    it('builds the analyzer of the project\'s analysis model, and says what is missing otherwise', async () => {
      const none = await project();
      await expect(projectAnalyzer(none.dir)).rejects.toMatchObject({ code: 'no-analysis-model', message: expect.stringMatching(/project has no analysis model/) });
      const { dir } = await project(config => { config.connections.push(connection('writer', { kind: 'llm', name: 'Writer' })); config.project.analysis = { model: { connectionId: 'writer', modelId: 'gpt-fixture' }, instructions: 'Focus on forms.' }; });
      expect((await projectAnalyzer(dir)).modelName).toBe('Writer · gpt-fixture');
      const keyed = await project(analysed);
      await expect(projectAnalyzer(keyed.dir)).rejects.toMatchObject({ code: 'missing-credential' });
    });
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
