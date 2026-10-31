import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { speechChoices } from '@rawstep/policies/policy';
import { validateDecision } from '@rawstep/browser/runner';
import { TraceRecorder, readTrace } from '@rawstep/core/trace';
import {
  CONFIG_FILE, comboPlanner, configSchema, credentialId, credentialRequirements, defaultConfig, defaultProfile,
  findByIdOrName, modelKeyEnv, parseConfig, profileConditions, projectAnalysisModel, resolveBaseURL, resolveRunRules, suggestionModel, firstProfile, taskSchema,
  type Profile, type ProjectConfig,
} from '@rawstep/project/config';
import { ProjectError } from '@rawstep/project/errors';
import { ProjectStore, demoConfig, findAgentCli, initProject } from '@rawstep/project/store';
import { discover } from '@rawstep/project/discover';
import { assertRunnable, backendCapabilities, checkRun, conditionsRecord, loadPlanFile, resolvePermissions, runSpecOf } from '@rawstep/project/plan';
import { projectAnalyzer, runTask } from '@rawstep/project/run';
import type { RunExecutor, RunSpec } from '@rawstep/project/execution';
import { connection, profileWith } from './helpers/project-config.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function root() { const r = await mkdtemp(join(tmpdir(), 'rawstep-project-')); dirs.push(r); return r; }
const task = { url: 'https://example.com', goal: 'Complete fixture', input: { email: 'private-value' }, verify: { all: [{ titleIncludes: 'Done' }] } };
function setup(): ProjectConfig {
  const config = defaultConfig();
  // Runs always plan, so the profile carries a planner on an LLM connection.
  config.connections.push(connection('a'), connection('b'), connection('setup-llm'));
  config.profiles[0] = profileWith('default', 'setup-llm', 'planner', 'Default');
  config.tasks.push({ id: 'task', name: 'Fixture', file: 'task.json' }); return config;
}

describe('project store', () => {
  it('detects external writes and keeps keys out of config responses', async () => {
    const dir = await root(); const store = new ProjectStore(dir); const first = await store.initialize();
    await writeFile(store.path, JSON.stringify({ ...first.config, machine: { ...first.config.machine, headless: false } }));
    await expect(store.save(first.config, first.revision)).rejects.toMatchObject({ code: 'config-conflict', status: 409 });
    await store.setCredential('anthropic', 'secret-fixture-value');
    expect(await store.credential('anthropic')).toBe('secret-fixture-value');
    expect(JSON.stringify(await store.read())).not.toContain('secret-fixture-value');
    const reread = new ProjectStore(dir); expect((await reread.read()).config.machine.headless).toBe(false);
  });
  it('keeps one key per preset provider and one per custom connection, under their environment variables', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.connections.push(connection('or-llm', { provider: 'openrouter' }), connection('or-second', { provider: 'openrouter' }),
      connection('keyed', { baseURL: 'http://127.0.0.1:1/v1', apiKeyEnv: 'RAWSTEP_TEST_CUSTOM_KEY' }));
    await store.save(config, initial.revision, { file: 'task.json', task });
    expect(await store.credentialStatus(config)).toMatchObject({ 'provider:openrouter': false, 'connection:keyed': false });
    // Two OpenRouter connections share one key; the file stores it under the preset variable.
    await store.setCredential('openrouter', 'sk-or-fixture');
    expect(await store.credential(config.connections.find(c => c.id === 'or-llm')!)).toBe('sk-or-fixture');
    expect(await store.credential(config.connections.find(c => c.id === 'or-second')!)).toBe('sk-or-fixture');
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toContain('RAWSTEP_OPENROUTER_API_KEY="sk-or-fixture"');
    await store.setCredential(config.connections.find(c => c.id === 'keyed')!, 'sk-custom-fixture');
    expect(await store.credentialStatus(config)).toMatchObject({ 'provider:openrouter': true, 'connection:keyed': true });
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
  it('starts a project with the demo task and its files, connects no model, and keeps demo files already there', async () => {
    const dir = await root();
    await mkdir(join(dir, 'rawstep/demo'), { recursive: true }); await writeFile(join(dir, 'rawstep/demo/page.html'), 'mine');
    await initProject(dir);
    const config = parseConfig(JSON.parse(await readFile(join(dir, 'rawstep.config.json'), 'utf8')));
    expect(config).toEqual(demoConfig());
    // Nothing is connected for the person, so the profile that follows the written plan comes first and `rawstep run demo` works.
    expect(config.connections).toEqual([]);
    expect(config.profiles.map(p => [p.id, p.planner])).toEqual([['written-plan', { planFile: 'rawstep/demo/plan.json' }], ['item-by-item', undefined]]);
    expect(config.tasks).toEqual([{ id: 'demo', name: 'Demo: add a mug to the cart', file: 'rawstep/demo/task.json' }]);
    expect(await readFile(join(dir, 'rawstep/demo/page.html'), 'utf8')).toBe('mine');
    expect((await new ProjectStore(dir).task('rawstep/demo/task.json')).url).toBe(pathToFileURL(join(dir, 'rawstep/demo/page.html')).href);
    await loadPlanFile(new ProjectStore(dir), 'rawstep/demo/plan.json');
  });
  it('finds the first coding-agent CLI on PATH', async () => {
    const dir = await root(), bin = join(dir, 'bin');
    await mkdir(bin); expect(await findAgentCli(bin)).toBeUndefined();
    await writeFile(join(bin, 'codex'), '#!/bin/sh\n', { mode: 0o755 }); await writeFile(join(bin, 'grok'), '#!/bin/sh\n', { mode: 0o755 });
    expect(await findAgentCli(bin)).toBe('codex');
  });
  it('writes a config once and never overwrites an existing one', async () => {
    const dir = await root();
    expect(await initProject(dir)).toBe(join(dir, 'rawstep.config.json'));
    await expect(initProject(dir)).rejects.toMatchObject({ code: 'config-exists' });
    await writeFile(join(dir, 'rawstep.config.json'), '{"mine":true}');
    await expect(initProject(dir)).rejects.toBeInstanceOf(ProjectError);
    expect(await readFile(join(dir, 'rawstep.config.json'), 'utf8')).toBe('{"mine":true}');
  });
  it('reads an invalid config as an error naming the file, an old-version one as old-config with what to do instead, and a missing task file as 404', async () => {
    const dir = await root(), store = new ProjectStore(dir);
    for (const version of [0, 8]) {
      await writeFile(store.path, JSON.stringify({ ...defaultConfig(), version }));
      await expect(store.read()).rejects.toMatchObject({ code: 'invalid-config', message: expect.stringContaining('rawstep.config.json') });
    }
    await writeFile(store.path, '{nope');
    await expect(store.read()).rejects.toMatchObject({ code: 'invalid-config' });
    for (const version of [1, 2, 3, 4, 5, 6]) {
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
    ['profile-connection-missing', (c: ProjectConfig) => { Object.assign(c.profiles[0]!, profileWith('default', 'ghost')); }],
    ['analysis-connection-missing', (c: ProjectConfig) => { c.project.analysis.model = { connectionId: 'ghost', modelId: 'writer' }; }],
    ['duplicate-task-file', (c: ProjectConfig) => { c.tasks.push({ id: 'other', name: 'Other', file: 'task.json' }); }],
  ])('validates references: %s', async (code, change) => {
    const store = new ProjectStore(await root()), config = setup(); change(config);
    expect(() => store.validateReferences(config)).toThrow(expect.objectContaining({ code, status: 400 }));
  });
  it('saves a task without a profile, and the profiles beside it, and reads them back', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.profiles.push({ ...profileWith('strict', 'setup-llm', 'planner', 'Strict'), runRules: resolveRunRules(config.profiles[0]!, { maxPlannerCalls: 1 }) });
    await store.save(config, initial.revision, { file: 'task.json', task });
    const saved = (await new ProjectStore(dir).read()).config;
    expect(saved.tasks[0]).toEqual({ id: 'task', name: 'Fixture', file: 'task.json' }); expect(saved.profiles[1]).toMatchObject({ id: 'strict', runRules: { maxPlannerCalls: 1 } });
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
  it('lists a custom server\'s models and omits credential echoes', async () => {
    const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'first' }, { id: 'second', name: 'Second' }, { id: 'PRIVATE_DISCOVERY_KEY' }] })); });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    try {
      const models = await discover({ provider: 'custom', baseURL: 'http://127.0.0.1:' + (server.address() as { port: number }).port }, 'PRIVATE_DISCOVERY_KEY');
      expect(models.map(m => [m.modelId, m.name])).toEqual([['first', 'first'], ['second', 'Second']]);
      expect(JSON.stringify(models)).not.toContain('PRIVATE_DISCOVERY_KEY');
    } finally { server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); }
  });
  it('lists LLM presets from their /models, leaving out models that do not produce text', async () => {
    const { calls, fetcher } = catalog({
      'https://openrouter.ai/api/v1/models': { data: [{ id: 'chat/vision', name: 'Vision', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }, { id: 'art/maker', architecture: { input_modalities: ['text'], output_modalities: ['image'] } }, { id: 'one/decider', architecture: { input_modalities: ['text'], output_modalities: ['decisions'] } }] },
      'https://api.openai.com/v1/models': { data: [{ id: 'gpt-fixture', modalities: { input: ['text', 'image'] } }, { id: 'plain' }] },
      'https://generativelanguage.googleapis.com/v1beta/openai/models': { data: [{ id: 'models/gemini-fixture' }] },
      'https://api.anthropic.com/v1/models?limit=1000': { data: [{ id: 'claude-fixture', display_name: 'Claude Fixture' }] },
    });
    const openrouter = await discover({ provider: 'openrouter' }, 'sk-or', { fetch: fetcher });
    expect(openrouter.map(m => [m.modelId, m.name])).toEqual([['chat/vision', 'Vision']]);
    const openai = await discover({ provider: 'openai' }, 'sk-openai', { fetch: fetcher });
    expect(openai.map(m => m.modelId)).toEqual(['gpt-fixture', 'plain']);
    expect((await discover({ provider: 'google' }, 'k', { fetch: fetcher })).map(m => m.modelId)).toEqual(['gemini-fixture']);
    const anthropic = await discover({ provider: 'anthropic' }, 'sk-ant', { fetch: fetcher });
    expect(anthropic.map(m => [m.modelId, m.name])).toEqual([['claude-fixture', 'Claude Fixture']]);
    expect(calls.find(c => c.url.startsWith('https://api.anthropic.com'))!.headers).toMatchObject({ authorization: 'Bearer sk-ant', 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' });
    expect(calls.find(c => c.url.startsWith('https://api.openai.com'))!.headers).not.toHaveProperty('x-api-key');
  });
  it('leaves the agent CLIs\' models to the agent and rejects a custom provider without a usable address', async () => {
    await expect(discover({ provider: 'custom' })).rejects.toMatchObject({ code: 'invalid-base-url' });
    await expect(discover({ provider: 'custom', baseURL: 'http://example.com/v1' })).rejects.toMatchObject({ code: 'invalid-base-url' });
    await expect(discover({ provider: 'nope' as never })).rejects.toMatchObject({ code: 'invalid-provider' });
  });
  it('answers an unreachable server and a server without a model list with project errors', async () => {
    await expect(discover({ provider: 'custom', baseURL: 'http://127.0.0.1:1/v1' }, undefined, { timeoutMs: 500 })).rejects.toMatchObject({ code: 'model-unreachable', status: 502 });
    await expect(discover({ provider: 'openai' }, 'k', { fetch: async () => json({ object: 'list' }) })).rejects.toMatchObject({ code: 'model-list-missing', status: 502 });
    await expect(discover({ provider: 'openai' }, 'k', { fetch: async () => json({}, 401) })).rejects.toMatchObject({ code: 'model-http' });
  });
});

describe('connection schema', () => {
  const base = { id: 'm', name: 'm' };
  const parse = (extra: Record<string, unknown>) => parseConfig({ ...defaultConfig(), connections: [{ ...base, ...extra }] });
  it('resolves the address and key variable of presets and custom connections', () => {
    const preset = connection('p', { provider: 'anthropic' });
    expect(resolveBaseURL(preset)).toBe('https://api.anthropic.com/v1'); expect(modelKeyEnv(preset)).toBe('RAWSTEP_ANTHROPIC_API_KEY');
    expect(resolveBaseURL(connection('o', { provider: 'openrouter' }))).toBe('https://openrouter.ai/api/v1');
    const custom = connection('c', { baseURL: 'http://127.0.0.1:1234/v1', apiKeyEnv: 'MY_KEY' });
    expect(resolveBaseURL(custom)).toBe('http://127.0.0.1:1234/v1'); expect(modelKeyEnv(custom)).toBe('MY_KEY'); expect(modelKeyEnv({ ...custom, apiKeyEnv: undefined })).toBeUndefined();
    expect(credentialId(preset)).toBe('provider:anthropic'); expect(credentialId(custom)).toBe('connection:c');
    expect(parse({ provider: 'google' }).connections[0]).toMatchObject({ timeoutMs: expect.any(Number) });
  });
  it('keeps the address and key variable with custom connections, and knows only LLM providers', () => {
    expect(() => parse({ provider: 'openai' })).not.toThrow();
    for (const provider of ['typesafe', 'gateway']) expect(() => parse({ provider })).toThrow();
    expect(() => parse({ provider: 'custom' })).toThrow();
    expect(() => parse({ provider: 'custom', baseURL: 'http://127.0.0.1:8000/v1' })).not.toThrow();
    expect(() => parse({ provider: 'openai', baseURL: 'https://example.com/v1' })).toThrow();
    expect(() => parse({ provider: 'openai', apiKeyEnv: 'MY_KEY' })).toThrow();
    expect(() => parse({ provider: 'custom', baseURL: 'http://127.0.0.1:1/v1', apiKeyEnv: 'lower' })).toThrow();
  });
  it('holds no model and no kind: a connection with a model ID, inputs, roles or a kind is rejected', () => {
    for (const extra of [{ modelId: 'x' }, { inputs: ['text'] }, { roles: ['decision'] }, { maxChoices: 255 }, { capabilitySource: 'manual' }, { family: 'LLM', protocol: 'chat' }, { kind: 'llm' }])
      expect(() => parse({ provider: 'openai', ...extra })).toThrow();
  });
  it('rejects duplicate connection ids and a config that still has a models list', () => {
    const twice = [{ ...base, provider: 'openai' }, { ...base, provider: 'anthropic' }];
    expect(() => parseConfig({ ...defaultConfig(), connections: twice })).toThrow(/used twice/);
    expect(() => parseConfig({ ...defaultConfig(), connections: [], models: [] })).toThrow();
  });
  it('keeps the planner, analysis and suggestion models on existing connections, and a profile to its planner', () => {
    const config = setup(); config.connections.push(connection('llm'));
    const withProfile = (change: (a: Profile, c: ProjectConfig) => void) => { const copy = structuredClone(config); change(copy.profiles[0]!, copy); return copy; };
    expect(() => parseConfig(withProfile((_, c) => { c.project.analysis.model = { connectionId: 'llm', modelId: 'writer' }; }))).not.toThrow();
    expect(() => parseConfig(withProfile((_, c) => { c.project.analysis.model = { connectionId: 'ghost', modelId: 'writer' }; }))).toThrow(/does not exist/);
    expect(() => parseConfig(withProfile((_, c) => { c.project.suggestions.model = { connectionId: 'ghost', modelId: 'writer' }; }))).toThrow(/does not exist/);
    expect(() => parseConfig(withProfile((_, c) => { c.project.suggestions.model = { connectionId: 'llm', modelId: 'writer' }; }))).not.toThrow();
    expect(() => parseConfig(withProfile((_, c) => { c.profiles[0] = profileWith('default', 'llm'); }))).not.toThrow();
    expect(() => parseConfig(withProfile((_, c) => { c.profiles[0] = profileWith('default', 'ghost'); }))).toThrow(/does not exist/);
    for (const field of ['structure', 'mode', 'executors', 'executor'] as const) expect(() => parseConfig(withProfile(a => { (a as Record<string, unknown>)[field] = field === 'executors' ? {} : field === 'executor' ? { followPlan: true } : 'planned'; }))).toThrow();
    expect(() => parseConfig(withProfile(a => { a.actions = { keyboard: a.actions, screenreader: a.actions } as never; }))).toThrow();
    // A profile without a planner is saved as it is; only a run of it is refused.
    expect(() => parseConfig(withProfile(a => { delete a.planner; }))).not.toThrow();
  });
  it('joins a profile with its connections into the models a run calls', () => {
    const config = setup(); config.connections.push(connection('llm', { name: 'My LLM' }), connection('llm2', { name: 'Other LLM' }));
    const combo = profileWith('p', 'llm', 'planner');
    config.project.analysis.model = { connectionId: 'llm', modelId: 'writer' };
    expect(comboPlanner(config, combo)).toEqual({ id: 'llm', name: 'My LLM · planner', modelId: 'planner', provider: 'custom', baseURL: 'http://127.0.0.1:1234', timeoutMs: 10000 });
    expect(projectAnalysisModel(config)).toMatchObject({ id: 'llm', name: 'My LLM · writer', modelId: 'writer' });
    // Without a project analysis model there is none; a model on a connection that is gone is none either.
    expect(projectAnalysisModel(setup())).toBeUndefined();
    expect(projectAnalysisModel({ ...config, project: { ...config.project, analysis: { ...config.project.analysis, model: { connectionId: 'ghost', modelId: 'own' } } } })).toBeUndefined();
    // Suggestions use their own model, otherwise the analysis model.
    expect(suggestionModel(config)).toMatchObject({ id: 'llm', modelId: 'writer' });
    config.project.suggestions.model = { connectionId: 'llm2', modelId: 'suggest' };
    expect(suggestionModel(config)).toMatchObject({ id: 'llm2', modelId: 'suggest' });
    // A plan file or no planner has no model to call.
    expect(comboPlanner(config, { planner: { planFile: 'plans/common.json' } })).toBeUndefined();
    expect(comboPlanner(config, {})).toBeUndefined();
    expect(comboPlanner(config, { planner: { connectionId: 'ghost', modelId: 'x', instructions: '' } })).toBeUndefined();
  });
});

describe('permissions', () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])('independently restricts type=%s and replace=%s in candidates and execution', (typeText, replaceText) => {
    const actionSet = { actions: { keys: [], intents: [], inputKeys: ['email'], typeText, replaceText } };
    const permissions = resolvePermissions('simulation', actionSet, task as never);
    const candidates = speechChoices(permissions as Required<typeof permissions>);
    expect(candidates.some(c => c.id === 'type:email')).toBe(typeText);
    expect(candidates.some(c => c.id === 'replace:email')).toBe(replaceText);
    const check = (kind: 'typeText' | 'replaceText') => () => validateDecision({ action: { kind, input: 'email' } }, permissions as Required<typeof permissions>);
    if (typeText) expect(check('typeText')).not.toThrow(); else expect(check('typeText')).toThrow();
    if (replaceText) expect(check('replaceText')).not.toThrow(); else expect(check('replaceText')).toThrow();
    expect(permissions.keys).toEqual([]);
    expect(resolvePermissions('simulation', { actions: { ...defaultProfile().actions, keys: ['Tab', 'Escape'] } }, task as never).keys).toEqual(['Tab', 'Escape']);
  });
  it('refuses actions the assistive technology lacks, listing them, and input names the task does not have', () => {
    const keys = { actions: { ...defaultProfile().actions, keys: ['Tab', 'F13', 'F14'] } };
    expect(() => resolvePermissions('simulation', keys, task as never)).toThrow(expect.objectContaining({ code: 'unsupported-action', message: expect.stringContaining('F13, F14') }));
    const intents = { actions: { ...defaultProfile().actions, intents: ['next', 'levitate'] } };
    expect(() => resolvePermissions('simulation', intents, task as never)).toThrow(expect.objectContaining({ code: 'unsupported-action', message: expect.stringContaining('levitate') }));
    const unknown = { actions: { ...defaultProfile().actions, inputKeys: ['nope'], typeText: true } };
    expect(() => resolvePermissions('simulation', unknown, task as never)).toThrow(expect.objectContaining({ code: 'unknown-input' }));
  });
  it('resolves a copy of the profile\'s actions, never changing the stored one', () => {
    const actionSet = { actions: { ...defaultProfile().actions, keys: ['Tab'] } }, before = structuredClone(actionSet);
    resolvePermissions('simulation', actionSet, task as never).keys.push('X');
    expect(actionSet).toEqual(before);
  });
});

describe('project config', () => {
  it('loads a saved config without run rules and defaults them', async () => {
    const dir = await root(), store = new ProjectStore(dir), first = await store.initialize();
    const old = JSON.parse(JSON.stringify(first.config)); delete old.project; delete old.profiles[0].runRules; delete old.profiles[0].page; delete old.profiles[0].screenReader;
    await writeFile(store.path, JSON.stringify(old));
    const config = (await new ProjectStore(dir).read()).config;
    expect(config.profiles[0]).toMatchObject({ page: 'default', screenReader: 'simulation', runRules: { repetitionGuard: true } });
    expect(config.project).toEqual({ analysis: { instructions: '' }, suggestions: {} });
    expect(defaultConfig().profiles[0]!.runRules).toMatchObject({ repetitionGuard: true });
    expect(defaultConfig().profiles[0]!.runRules).not.toHaveProperty('maxStateVisits'); expect(defaultConfig().profiles[0]!.runRules).not.toHaveProperty('modelGiveUp');
    const withRules = (runRules: unknown) => ({ ...old, profiles: [{ ...old.profiles[0], runRules }] });
    for (const rules of [{ repetitionGuard: 'auto' }, { repetitionGuard: 'on' }, { maxStateVisits: 3 }, { modelGiveUp: false }, { unknownRule: 1 }]) expect(() => configSchema.parse(withRules(rules))).toThrow();
    expect(configSchema.parse(withRules({ repetitionGuard: false })).profiles[0]!.runRules.repetitionGuard).toBe(false);
  });
  it('accepts only version 7 configs', () => {
    const config = defaultConfig();
    expect(config.version).toBe(7);
    expect(parseConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(() => parseConfig({ ...config, version: 6 })).toThrow();
    expect(() => parseConfig({ version: 7, connections: [], tasks: [], agents: [], machine: {} })).toThrow();
    expect(() => parseConfig({ ...config, combos: [] })).toThrow();
    expect(() => parseConfig({ ...config, profiles: [] })).toThrow();
    expect(() => parseConfig({ ...config, profiles: [{ ...config.profiles[0], screenReader: 'jaws' }] })).toThrow();
  });
  it('starts a project with one default profile', () => {
    const config = defaultConfig();
    expect(config.profiles.map(p => p.id)).toEqual(['default']); expect(config.profiles[0]).toMatchObject({ page: 'default', screenReader: 'simulation' }); expect(config.profiles[0]).not.toHaveProperty('planner'); expect(config.profiles[0]).not.toHaveProperty('executor');
    expect(config.profiles[0]!.actions).toEqual({ keys: [], intents: ['next', 'previous', 'activate'], typeText: false, replaceText: false }); expect(config.machine.atEndpoints).toEqual({ voiceover: '', nvda: '' });
  });
  it('finds connections and profiles by id first, then by name', () => {
    const list = [{ id: 'one', name: 'two' }, { id: 'two', name: 'one' }];
    expect(findByIdOrName(list, 'one')).toBe(list[0]); expect(findByIdOrName(list, 'two')).toBe(list[1]); expect(findByIdOrName(list, 'three')).toBeUndefined();
  });
  it('keeps the profile\'s run rules whole and a task\'s own fields apart from them', () => {
    const config = defaultConfig(); config.tasks.push({ id: 'task', name: 'T', file: 't.json', analysisInstructions: 'Look at forms.' });
    const parsed = parseConfig(JSON.parse(JSON.stringify(config)));
    expect(parsed.tasks[0]).toEqual({ id: 'task', name: 'T', file: 't.json', analysisInstructions: 'Look at forms.' });
    expect(() => taskSchema.parse({ id: 'task', name: 'T', file: 't.json', runRules: { maxPlannerCalls: 4 } })).toThrow();
    expect(() => taskSchema.parse({ id: 'task', name: 'T', file: 't.json', profileId: 'default' })).toThrow();
    expect(parsed.profiles[0]!.runRules).toEqual(defaultConfig().profiles[0]!.runRules);
  });
  it('layers run rules for one run over the profile\'s, other fields from the profile', () => {
    const config = setup(); config.profiles[0]!.runRules = resolveRunRules(config.profiles[0]!, { maxUnchangedTransitions: 7, maxPlannerCalls: 3, failureLimit: 6 });
    const profile = config.profiles[0]!, override = { maxUnchangedTransitions: 2, maxPlannerCalls: 5 };
    const rules = resolveRunRules(profile, override);
    expect(rules).toEqual({ ...profile.runRules, maxUnchangedTransitions: 2, maxPlannerCalls: 5 });
    expect(profile.runRules.maxUnchangedTransitions).toBe(7);
    const checked = checkRun({ config, task: task as never, taskEntry: config.tasks[0], runRules: override, ...profileConditions(profile) });
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
    const profile = { ...profileWith('p2', 'setup-llm', 'planner', 'Second'), page: 'narrow', screenReader: 'nvda' as const };
    const conditions = profileConditions(profile);
    expect(conditions.profile).toBe(profile);
    expect(conditions.combo).toEqual({ id: 'p2', name: 'Second', planner: profile.planner });
    expect(conditions.actionSet).toEqual({ id: 'p2', name: 'Second', actions: profile.actions });
    expect(conditions.pageEnvironment).toMatchObject({ id: 'p2', profile: 'narrow' }); expect(conditions.atEnvironment).toMatchObject({ id: 'p2', backend: 'nvda' });
  });
  it('merges run rules as the profile\'s, then those of one run', () => {
    const profile = defaultProfile(); profile.runRules = resolveRunRules(profile, { maxPlannerCalls: 5, repetitionGuard: false });
    expect(resolveRunRules(profile)).toMatchObject({ maxPlannerCalls: 5, repetitionGuard: false, failureLimit: 2, noChangeLimit: 3, plannerHistoryLimit: 60 });
    expect(resolveRunRules(profile, { maxPlannerCalls: 3, failureLimit: 4 }, undefined, { failureLimit: 7, repetitionGuard: true })).toMatchObject({ maxPlannerCalls: 3, failureLimit: 7, repetitionGuard: true, noChangeLimit: 3 });
    expect(() => resolveRunRules(profile, { maxPlannerCalls: -1 })).toThrow();
    expect(profile.runRules.maxPlannerCalls).toBe(5);
  });
  it('records the conditions of a run by content, with the profile it was made with', () => {
    const config = setup(), conditions = profileConditions(config.profiles[0]!);
    const check = assertRunnable(checkRun({ config, task: task as never, taskEntry: config.tasks[0], ...conditions }));
    const record = conditionsRecord(conditions, check);
    expect(record).toMatchObject({
      profile: { id: 'default', name: 'Default' },
      combo: { id: 'default', planner: 'setup-llm · planner' },
      actionSet: { id: 'default', permissions: { intents: ['next', 'previous', 'activate'] } },
      pageEnvironment: { id: 'default', profile: 'default' }, atEnvironment: { id: 'default', backend: 'simulation' },
      runRules: { maxPlannerCalls: expect.any(Number) },
    });
    expect(record.combo).not.toHaveProperty('structure'); expect(record).not.toHaveProperty('preset');
    for (const gone of ['executor', 'followPlan', 'prompt']) expect(record.combo).not.toHaveProperty(gone);
    const spec = runSpecOf(task as never, conditions, check);
    expect(spec).toMatchObject({ backend: 'simulation', plannerModel: { id: 'setup-llm', modelId: 'planner' }, plannerInstructions: '', conditions: record });
    for (const gone of ['mode', 'executor', 'model', 'prompt']) expect(spec).not.toHaveProperty(gone);
  });
});

describe('run checks', () => {
  const check = (config: ProjectConfig, change: (c: ProjectConfig) => void = () => {}, extra: Partial<Parameters<typeof checkRun>[0]> = {}) => {
    change(config);
    return checkRun({ config, task: task as never, taskEntry: config.tasks[0], ...profileConditions(config.profiles[0]!), ...extra });
  };
  const withLlm = (c: ProjectConfig) => { c.connections.push(connection('llm')); };
  it('accepts a supported combination and returns its settings and its planner', () => {
    const result = check(setup());
    expect(result.problem).toBeUndefined(); expect(result.settings.runRules.maxPlannerCalls).toBeGreaterThan(0); expect(result.warnings).toEqual([]);
    expect(result.analysisModel).toBeUndefined();
    expect(result.plannerModel).toMatchObject({ id: 'setup-llm', modelId: 'planner' });
    expect(result).not.toHaveProperty('model'); expect(result).not.toHaveProperty('prompt');
    expect(assertRunnable(result).permissions.intents).toEqual(['next', 'previous', 'activate']);
  });
  it.each([
    ['unsupported-action', (c: ProjectConfig) => { c.profiles[0]!.actions.keys = ['F13']; }],
    ['planner-model-invalid', (c: ProjectConfig) => { delete c.profiles[0]!.planner; }],
    ['environment-unsupported', (c: ProjectConfig) => { c.profiles[0]!.page = 'zoom-200'; }],
  ])('reports %s as the problem, not by throwing', (code, change) => {
    const result = check(setup(), change);
    expect(result.problem).toBeInstanceOf(ProjectError); expect(result.problem!.code).toBe(code);
    expect(() => assertRunnable(result)).toThrow(result.problem!);
    expect(result.permissions).toBeDefined();
  });
  it('explains a missing action by name, and a profile without a planner by what to do', () => {
    expect(check(setup(), c => { c.profiles[0]!.actions.keys = ['Tab', 'F13', 'F14']; }).problem!.message).toMatch(/F13, F14/);
    const none = check(setup(), c => { delete c.profiles[0]!.planner; });
    expect(none.plannerModel).toBeUndefined(); expect(none.problem!.message).toMatch(/needs a planner.*LLM connection or a plan file/i);
  });
  it('merges the run rules of the profile and the run, the run last', () => {
    const result = check(setup(), c => { c.profiles[0]!.runRules.maxPlannerCalls = 5; c.profiles[0]!.runRules.stepActionLimit = 9; c.profiles[0]!.runRules.noChangeLimit = 6; },
      { runRules: { failureLimit: 7, maxPlannerCalls: 1 } });
    expect(result.settings.runRules).toMatchObject({ maxPlannerCalls: 1, stepActionLimit: 9, failureLimit: 7, noChangeLimit: 6, repetitionGuard: true });
    expect(check(setup(), c => { c.project.analysis.instructions = 'Project focus.'; }).settings.analysisInstructions).toBe('Project focus.');
    expect(check(setup(), c => { c.project.analysis.instructions = 'Project focus.'; c.tasks[0]!.analysisInstructions = 'Task focus.'; }).settings.analysisInstructions).toBe('Task focus.');
  });
  it('never blocks a run on analysis: a model on a connection that is gone only warns, only the project\'s analysis model is used', () => {
    const bad = check(setup(), c => { c.project.analysis.model = { connectionId: 'ghost', modelId: 'writer' }; });
    expect(bad.problem).toBeUndefined(); expect(bad.analysisModel).toBeUndefined(); expect(bad.warnings).toEqual([expect.stringMatching(/not on an LLM connection.*rules only/)]);
    const project = check(setup(), c => { withLlm(c); c.project.analysis.model = { connectionId: 'llm', modelId: 'writer' }; });
    expect(project.problem).toBeUndefined(); expect(project.warnings).toEqual([]); expect(project.analysisModel).toMatchObject({ id: 'llm', modelId: 'writer' });
    expect(check(setup()).warnings).toEqual([]);
  });
  describe('planners', () => {
    const planned = (c: ProjectConfig, instructionsText = 'Plan like an expert.') => { withLlm(c); c.profiles[0] = profileWith('default', 'llm', 'planner', 'Default', instructionsText); };
    it('plan with the planner\'s model and added instructions', () => {
      const reader = check(setup(), c => planned(c));
      expect(reader.problem).toBeUndefined(); expect(reader.warnings).toEqual([]);
      expect(reader.plannerModel).toMatchObject({ id: 'llm', modelId: 'planner' }); expect(reader.plannerInstructions).toBe('Plan like an expert.');
    });
    it('refuse a run that has no planner, and leave the profile saveable', () => {
      expect(check(setup(), c => { delete c.profiles[0]!.planner; }).problem?.code).toBe('planner-model-invalid');
      expect(() => parseConfig((() => { const c = setup(); delete c.profiles[0]!.planner; return c; })())).not.toThrow();
    });
    it('need a planner on a connection that exists or a plan file', () => {
      expect(check(setup(), c => { c.profiles[0] = profileWith('default', 'ghost'); }).problem?.code).toBe('planner-model-invalid');
    });
    it('give a file planner the task\'s own plan file, and record it in the conditions', () => {
      const filed = check(setup(), c => { Object.assign(c.profiles[0]!, { planner: { planFile: 'plans/{task}/L2.json' } }); }, { taskEntry: { file: 'tasks/cart.json' } });
      expect(filed.problem).toBeUndefined(); expect(filed.plannerPlanFile).toBe('plans/cart/L2.json'); expect(filed.plannerModel).toBeUndefined();
      expect(check(setup(), c => { Object.assign(c.profiles[0]!, { planner: { planFile: 'plans/{task}/L2.json' } }); }, { taskEntry: {} }).problem?.code).toBe('plan-file-task');
    });
    it('run a plan file without any model or key, and let its plan type into the task\'s inputs', () => {
      const filed = (c: ProjectConfig) => { Object.assign(c.profiles[0]!, { planner: { planFile: 'plans/{task}/L2.json' } }); };
      const result = check(setup(), filed, { taskEntry: { file: 'tasks/cart.json' } });
      expect(result.problem).toBeUndefined(); expect(result.plannerModel).toBeUndefined(); expect(result).not.toHaveProperty('model');
      // The plan's typing tasks name the input, so a profile that enters text needs nothing else.
      const typing = (c: ProjectConfig) => { filed(c); c.profiles[0]!.actions = { ...c.profiles[0]!.actions, inputKeys: ['email'], typeText: true }; };
      expect(check(setup(), typing, { taskEntry: { file: 'tasks/cart.json' } }).problem).toBeUndefined();
    });
    it('give a constant plan file to any task, registered or not; only {task} needs the task file', () => {
      const constant = (c: ProjectConfig) => { Object.assign(c.profiles[0]!, { planner: { planFile: 'plans/common.json' } }); };
      const result = check(setup(), constant, { taskEntry: {} });
      expect(result.problem).toBeUndefined(); expect(result.plannerPlanFile).toBe('plans/common.json');
    });
    it('hand the planner and its added instructions to the run spec, and nothing of an executor', () => {
      const config = setup(); Object.assign(config.profiles[0]!, profileWith('default', 'setup-llm', 'planner', 'Default', 'Plan in small steps'));
      const spec = runSpecOf(task as never, profileConditions(config.profiles[0]!), assertRunnable(check(config)));
      expect(spec).toMatchObject({ plannerModel: { id: 'setup-llm', modelId: 'planner' }, plannerInstructions: 'Plan in small steps' });
      expect(spec).not.toHaveProperty('plannerPlan');
    });
  });
  describe('assistive technology', () => {
    it('checks the host for native screen readers', () => {
      const nvda = { id: 'nvda', name: 'NVDA', backend: 'nvda' as const };
      if (process.platform !== 'win32') expect(check(setup(), () => {}, { atEnvironment: nvda }).problem?.code).toBe('nvda-windows');
      if (process.platform !== 'darwin') expect(check(setup(), () => {}, { atEnvironment: { id: 'vo', name: 'VO', backend: 'voiceover' } }).problem?.code).toBe('voiceover-macos');
    });
    it.skipIf(process.platform !== 'darwin')('allows only a loopback AT Driver address for VoiceOver, from the machine settings', () => {
      const vo = { id: 'vo', name: 'VO', backend: 'voiceover' as const };
      expect(check(setup(), () => {}, { atEnvironment: vo }).problem).toBeUndefined();
      expect(check(setup(), c => { c.machine.atEndpoints.voiceover = 'ws://127.0.0.1:9999/session'; }, { atEnvironment: vo }).problem).toBeUndefined();
      expect(check(setup(), c => { c.machine.atEndpoints.voiceover = 'ws://example.com:4382/session'; }, { atEnvironment: vo }).problem?.code).toBe('endpoint-not-loopback');
    });
  });
  it('lists the capabilities of each backend', () => {
    expect(backendCapabilities('simulation').intents).toContain('next');
    expect(backendCapabilities('simulation').keys).toContain('Tab');
    expect(backendCapabilities('voiceover').intents.length).toBeGreaterThan(0);
    expect(backendCapabilities('nvda').intents.length).toBeGreaterThan(0);
  });
});

describe('runTask', () => {
  /** A recorded run: one action per step, each followed by what the screen reader said, ending with the given outcome. */
  const recorded = (keys: string[], status: 'success' | 'failure', reason?: string) => async (spec: RunSpec, outDir: string) => {
    const trace = new TraceRecorder({ ...spec.task, id: spec.task.id ?? 'fixture' }, outDir); await trace.initialize();
    trace.append('simulation.observation', { speech: ['start'] }, { source: 'runner' });
    keys.forEach((key, i) => {
      trace.append('policy.decision', { step: i + 1, decision: { action: { kind: 'key', key } } }, { source: 'policy' });
      trace.append('action.result', { step: i + 1, ok: true, action: { kind: 'key', key } });
      trace.append('simulation.observation', { speech: ['step ' + i] }, { source: 'runner' });
    });
    return trace.finalize({ status, steps: keys.length, ...(reason ? { reason } : {}) });
  };
  /** A run executor that plays the given recordings in order and remembers what it was asked to run. */
  function player(...plays: ReturnType<typeof recorded>[]) {
    const calls: { spec: RunSpec; outDir: string; plannerApiKey?: string | undefined }[] = [];
    const execute: RunExecutor = async (spec, { outDir, plannerApiKey }) => { calls.push({ spec, outDir, plannerApiKey }); return plays[calls.length - 1]!(spec, outDir); };
    return { calls, execute };
  }
  async function project(change: (config: ProjectConfig) => void = () => {}) {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup(); change(config);
    await store.save(config, initial.revision, { file: 'task.json', task }); return { dir, store };
  }
  const back = ['Tab', 'Shift+Tab', 'Tab', 'Shift+Tab'];
  const tabOnly = { keys: ['Tab'], intents: [], typeText: false, replaceText: false };

  it('runs a registered task with the planner of its profile, writing under .rawstep/runs and returning the conditions', async () => {
    const { dir } = await project(), { calls, execute } = player(recorded(['Tab', 'Enter'], 'success'));
    const result = await runTask('task', { projectDir: dir }, { execute });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.spec).toMatchObject({ backend: 'simulation', plannerModel: { id: 'setup-llm' }, task: { goal: 'Complete fixture' }, environment: expect.objectContaining({ id: 'default' }) });
    expect(calls[0]!.spec).not.toHaveProperty('mode'); expect(calls[0]!.spec).not.toHaveProperty('model'); expect(calls[0]!.spec).not.toHaveProperty('prompt');
    expect(calls[0]!.spec.permissions.intents).toContain('next');
    expect(dirname(dirname(calls[0]!.outDir))).toBe(join(dir, '.rawstep', 'runs')); expect(basename(dirname(calls[0]!.outDir))).toMatch(/^[0-9T-]+Z-[0-9a-f]{8}$/); expect(basename(calls[0]!.outDir)).toBe('run-1');
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ outDir: calls[0]!.outDir, outcome: { status: 'success', steps: 2 }, hints: { goalReached: true, steps: 2 } });
    expect(result.runs[0]!.runId).toBe(result.runs[0]!.hints.runId);
    for (const file of ['trace.json', 'hints.json', 'analysis.json', 'report.html']) expect(await readFile(join(calls[0]!.outDir, file), 'utf8')).toBeTruthy();
    expect((await readTrace(calls[0]!.outDir)).runId).toBe(result.runs[0]!.runId);
    expect(result.findings).toEqual([]); expect(result.warnings).toEqual([]);
    expect(result.conditions).toMatchObject({
      profile: { id: 'default', name: 'Default' }, combo: { id: 'default', planner: 'setup-llm · planner' }, actionSet: { id: 'default' }, pageEnvironment: { id: 'default' },
      atEnvironment: { id: 'default', backend: 'simulation' }, runRules: { maxPlannerCalls: expect.any(Number) },
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
      config.profiles.push({ ...profileWith('zoom', 'b', 'plan-b', 'Zoom check'), page: 'narrow' });
      config.profiles.push({ ...profileWith('wide', 'a', 'plan-a', 'Wide'), actions: tabOnly });
    });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'), recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir, profile: 'zoom' }, { execute });
    await runTask('task', { projectDir: dir, profile: 'Zoom check' }, { execute });
    await runTask('task', { projectDir: dir, profile: 'Default' }, { execute });
    await runTask('task', { projectDir: dir, profile: 'Wide' }, { execute });
    expect(calls.map(c => c.spec.plannerModel!.id)).toEqual(['b', 'b', 'setup-llm', 'a']);
    expect(calls[0]!.spec.plannerModel).toMatchObject({ modelId: 'plan-b', name: 'b · plan-b' });
    expect(calls.map(c => (c.spec.environment as { id: string }).id)).toEqual(['narrow', 'narrow', 'default', 'default']);
    expect(calls[3]!.spec.permissions.keys).toEqual(['Tab']); expect(calls[3]!.spec.conditions).toMatchObject({ profile: { id: 'wide', name: 'Wide' }, actionSet: { id: 'wide' } });
    await expect(runTask('task', { projectDir: dir, profile: 'nope' }, { execute })).rejects.toMatchObject({ code: 'profile-not-found', message: expect.stringContaining('Zoom check (zoom)') });
    expect(calls).toHaveLength(4);
  });
  it('uses the first profile unless one is named, with that profile\'s planner and instructions', async () => {
    const { dir } = await project(config => { config.profiles.push(profileWith('second', 'b', 'plan-b', 'Second', 'Plan in small steps')); });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.plannerModel!.id).toBe('setup-llm'); expect(calls[0]!.spec.environment).toEqual(expect.objectContaining({ id: 'default' }));
    expect(calls[0]!.spec.plannerInstructions).toBe('');
    expect(calls[0]!.spec.conditions).toMatchObject({ profile: { id: 'default', name: 'Default' } });
    // A named profile is used instead of the first.
    await runTask('task', { projectDir: dir, profile: 'second' }, { execute });
    expect(calls[1]!.spec.plannerModel).toMatchObject({ id: 'b', modelId: 'plan-b' }); expect(calls[1]!.spec.plannerInstructions).toBe('Plan in small steps');
  });
  it('merges run rules as the profile\'s and then the options\'', async () => {
    const { dir } = await project(config => { config.profiles[0]!.runRules = resolveRunRules(config.profiles[0]!, { maxPlannerCalls: 8, stepActionLimit: 20, failureLimit: 3 }); });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.settings.runRules).toMatchObject({ maxPlannerCalls: 8, stepActionLimit: 20, failureLimit: 3 });
    const result = await runTask('task', { projectDir: dir, runRules: { maxPlannerCalls: 1 } }, { execute });
    expect(calls[1]!.spec.settings.runRules).toMatchObject({ maxPlannerCalls: 1, stepActionLimit: 20, failureLimit: 3 });
    expect(result.conditions).toMatchObject({ runRules: { maxPlannerCalls: 1, failureLimit: 3 } });
  });
  it('runs the first profile with its own actions, for a registered task and an unregistered task file alike', async () => {
    const { dir } = await project(config => {
      config.profiles.unshift({ ...profileWith('task-keys', 'setup-llm', 'planner', 'Task keys'), actions: tabOnly });
    });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    const result = await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.permissions.keys).toEqual(['Tab']);
    expect(result.conditions).toMatchObject({ profile: { id: 'task-keys', name: 'Task keys' }, actionSet: { id: 'task-keys' } });
    await writeFile(join(dir, 'other.json'), JSON.stringify({ ...task, goal: 'Other goal' }));
    await runTask('other.json', { projectDir: dir }, { execute });
    expect(calls[1]!.spec.permissions.keys).toEqual(['Tab']); expect(calls[1]!.spec.conditions).toMatchObject({ profile: { id: 'task-keys' } });
  });
  it('explains when the profile has no planner, and still runs another profile that has one', async () => {
    const unplanned = await project(config => { delete config.profiles[0]!.planner; });
    await expect(runTask('task', { projectDir: unplanned.dir }, { execute: player().execute })).rejects.toMatchObject({ code: 'planner-model-invalid', message: expect.stringMatching(/needs a planner/i) });
    // Nothing else is picked for the profile that has none.
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    const mixed = await project(config => { delete config.profiles[0]!.planner; config.profiles.push(profileWith('second', 'b')); });
    await runTask('task', { projectDir: mixed.dir, profile: 'second' }, { execute });
    expect(calls[0]!.spec.plannerModel!.id).toBe('b');
    await expect(runTask('task', { projectDir: mixed.dir }, { execute })).rejects.toMatchObject({ code: 'planner-model-invalid' });
  });
  it('needs the planner\'s key and hands it to the run, with the planner\'s added instructions', async () => {
    const { dir, store } = await project(config => {
      config.connections.push(connection('planner', { provider: 'openai' }));
      config.profiles[0] = profileWith('default', 'planner', 'plan-model', 'Default', 'Be careful.');
    });
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    await expect(runTask('task', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'missing-credential', message: expect.stringContaining('RAWSTEP_OPENAI_API_KEY') });
    await store.setCredential('openai', 'sk-planner-key');
    const reader = await runTask('task', { projectDir: dir }, { execute });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.spec).toMatchObject({ plannerModel: { id: 'planner', modelId: 'plan-model' }, plannerInstructions: 'Be careful.' }); expect(calls[0]!.plannerApiKey).toBe('sk-planner-key');
    expect(reader.warnings).toEqual([]); expect(reader.conditions).toMatchObject({ combo: { planner: 'planner · plan-model' } });
  });
  it('passes the profile\'s screen reader to the run', async () => {
    const { dir } = await project(config => { config.profiles.push({ ...profileWith('nvda', 'setup-llm', 'planner', 'NVDA'), screenReader: 'nvda' }); });
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    if (process.platform !== 'win32') await expect(runTask('task', { projectDir: dir, profile: 'nvda' }, { execute })).rejects.toMatchObject({ code: 'nvda-windows' });
    else { await runTask('task', { projectDir: dir, profile: 'nvda' }, { execute }); expect(calls[0]!.spec.backend).toBe('nvda'); }
  });
  it('runs an unregistered task file with the first profile, resolving the path from the project directory', async () => {
    const { dir } = await project(config => { config.profiles.push(profileWith('second', 'b', 'plan-b', 'Second')); });
    await writeFile(join(dir, 'other.json'), JSON.stringify({ ...task, goal: 'Other goal' }));
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('other.json', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.task.goal).toBe('Other goal'); expect(calls[0]!.spec.plannerModel!.id).toBe('setup-llm');
    // The registered task's own file is recognized, and runs with the first profile too: a task names none.
    await runTask('./task.json', { projectDir: dir }, { execute });
    expect(calls[1]!.spec.task.goal).toBe('Complete fixture'); expect(calls[1]!.spec.plannerModel!.id).toBe('setup-llm');
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
    const unsupported = await project(config => { config.profiles[0]!.page = 'zoom-200'; });
    await expect(runTask('task', { projectDir: unsupported.dir }, { execute })).rejects.toMatchObject({ code: 'environment-unsupported' });
  });
  it('requires the provider key, reading it from .env.local, and hands it to the run; a custom server needs none', async () => {
    const { dir, store } = await project(config => { config.connections[0] = connection('a', { provider: 'openai' }); config.profiles[0] = profileWith('default', 'a'); config.profiles.push(profileWith('second', 'b')); });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await expect(runTask('task', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'missing-credential', message: expect.stringContaining('RAWSTEP_OPENAI_API_KEY') });
    await store.setCredential('openai', 'sk-fixture-key');
    await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.plannerApiKey).toBe('sk-fixture-key');
    await runTask('task', { projectDir: dir, profile: 'second' }, { execute });
    expect(calls[1]!.plannerApiKey).toBeUndefined();
  });
  describe('analysis', () => {
    const analysed = (config: ProjectConfig) => { config.connections.push(connection('writer', { provider: 'openai' })); config.project.analysis.model = { connectionId: 'writer', modelId: 'gpt-fixture' }; };
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
      const { dir } = await project(config => { config.connections.push(connection('writer', { name: 'Writer' })); config.project.analysis = { model: { connectionId: 'writer', modelId: 'gpt-fixture' }, instructions: 'Focus on forms.' }; });
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
  it('does not treat a run executor failure as a result', async () => {
    const { dir } = await project();
    await expect(runTask('task', { projectDir: dir }, { execute: async () => { throw new Error('browser crashed'); } })).rejects.toThrow('browser crashed');
  });
});
