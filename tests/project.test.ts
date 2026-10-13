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
  CONFIG_FILE, comboAnalysis, comboExecutor, comboPlanner, configSchema, credentialId, credentialRequirements, defaultActionSet, defaultAtEnvironment, defaultCombo, defaultConfig, defaultInputs,
  defaultPageEnvironment, findByIdOrName, modelKeyEnv, parseConfig, projectAnalysisModel, resolveBaseURL, resolveRepetitionGuard, resolveRunRules, sharedItems, suggestionModel, taskConditions, taskSchema,
  type Combo, type Executor, type ProjectConfig,
} from '@rawstep/project/config';
import { ProjectError } from '@rawstep/project/errors';
import { ProjectStore, initProject } from '@rawstep/project/store';
import { discover } from '@rawstep/project/discover';
import { assertRunnable, backendCapabilities, checkRun, comboModes, conditionsRecord, executorPrompt, resolvePermissions, runSpecOf, supportsMode } from '@rawstep/project/plan';
import { projectAnalyzer, runTask } from '@rawstep/project/run';
import type { RunExecutor, RunSpec } from '@rawstep/project/execution';
import { comboWith, connection, instructions, plannedWith } from './helpers/project-config.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function root() { const r = await mkdtemp(join(tmpdir(), 'rawstep-project-')); dirs.push(r); return r; }
const task = { url: 'https://example.com', goal: 'Complete fixture', input: { email: 'private-value' }, verify: { all: [{ titleIncludes: 'Done' }] } };
function setup(): ProjectConfig {
  const config = defaultConfig();
  config.connections.push(connection('a'), connection('b'));
  config.combos[0] = comboWith('default', 'a', 'm-a', 'Default');
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
  it('reads an invalid config as an error naming the file, an old-version one as old-config with the way to convert it, and a missing task file as 404', async () => {
    const dir = await root(), store = new ProjectStore(dir);
    await writeFile(store.path, JSON.stringify({ ...defaultConfig(), version: 4 }));
    await expect(store.read()).rejects.toMatchObject({ code: 'invalid-config', message: expect.stringContaining('rawstep.config.json') });
    await writeFile(store.path, '{nope');
    await expect(store.read()).rejects.toMatchObject({ code: 'invalid-config' });
    for (const version of [1, 2]) {
      await writeFile(store.path, JSON.stringify({ version, agents: [] }));
      await expect(store.read()).rejects.toMatchObject({ code: 'old-config', message: expect.stringMatching(new RegExp(`version ${version}.*migrate-config\\.mjs.*\\.bak`)) });
    }
    await writeFile(store.path, JSON.stringify({ ...setup() }));
    await expect(store.read()).rejects.toMatchObject({ code: 'task-file-missing', status: 404 });
  });
  it('throws plain project errors with a status hint, never HTTP errors', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.tasks[0]!.comboId = 'ghost';
    const error = await store.save(config, initial.revision, { file: 'task.json', task }).catch(e => e as ProjectError);
    expect(error).toBeInstanceOf(ProjectError); expect(error).toMatchObject({ code: 'task-combo-missing', status: 400 });
    config.tasks[0]!.comboId = 'default'; config.combos.push(defaultCombo());
    await expect(store.save(config, initial.revision, { file: 'task.json', task })).rejects.toMatchObject({ code: 'duplicate-id' });
    await expect(store.save(setup(), initial.revision, { file: 'rawstep.config.json', task })).rejects.toMatchObject({ code: 'task-file-reserved' });
    expect(() => store.validateReferences({ ...setup(), pageEnvironments: [{ id: 'default', name: 'Default', profile: 'no-such-environment' }] })).toThrow();
  });
  it.each([
    ['duplicate-id', (c: ProjectConfig) => { c.actionSets.push(defaultActionSet()); }],
    ['duplicate-id', (c: ProjectConfig) => { c.atEnvironments.push(defaultAtEnvironment()); }],
    ['duplicate-id', (c: ProjectConfig) => { c.presets.push({ id: 'p', name: 'P' }, { id: 'p', name: 'Q' }); }],
    ['combo-connection-missing', (c: ProjectConfig) => { c.combos[0]!.executors.keyboard!.connectionId = 'ghost'; }],
    ['planner-needs-llm', (c: ProjectConfig) => { Object.assign(c.combos[0]!, plannedWith(c.combos[0]!, 'a')); }],
    ['analysis-needs-llm', (c: ProjectConfig) => { c.combos[0]!.analysis = { connectionId: 'a', modelId: 'writer' }; }],
    ['analysis-needs-llm', (c: ProjectConfig) => { c.project.analysis.model = { connectionId: 'a', modelId: 'writer' }; }],
    ['duplicate-task-file', (c: ProjectConfig) => { c.tasks.push({ id: 'other', name: 'Other', file: 'task.json' }); }],
    ['owner-missing', (c: ProjectConfig) => { c.actionSets.push({ ...defaultActionSet('copy'), owner: 'ghost' }); }],
    ['owner-missing', (c: ProjectConfig) => { c.pageEnvironments.push({ ...defaultPageEnvironment('copy'), owner: 'ghost' }); }],
    ['task-action-set-missing', (c: ProjectConfig) => { c.tasks[0]!.actionSetId = 'ghost'; }],
    ['task-page-environment-missing', (c: ProjectConfig) => { c.tasks[0]!.pageEnvironmentId = 'ghost'; }],
    ['task-at-environment-missing', (c: ProjectConfig) => { c.tasks[0]!.atEnvironmentId = 'ghost'; }],
    ['task-preset-missing', (c: ProjectConfig) => { c.tasks[0]!.presetId = 'ghost'; }],
    ['task-copy-foreign', (c: ProjectConfig) => { c.tasks.push({ id: 'other', name: 'Other', file: 'other.json' }); c.actionSets.push({ ...defaultActionSet('copy'), owner: 'other' }); c.tasks[0]!.actionSetId = 'copy'; }],
    ['preset-combo-missing', (c: ProjectConfig) => { c.presets.push({ id: 'p', name: 'P', comboId: 'ghost' }); }],
    ['preset-action-set-missing', (c: ProjectConfig) => { c.presets.push({ id: 'p', name: 'P', actionSetId: 'ghost' }); }],
    ['preset-page-environment-missing', (c: ProjectConfig) => { c.presets.push({ id: 'p', name: 'P', pageEnvironmentId: 'ghost' }); }],
    ['preset-at-environment-missing', (c: ProjectConfig) => { c.presets.push({ id: 'p', name: 'P', atEnvironmentId: 'ghost' }); }],
    ['preset-task-copy', (c: ProjectConfig) => { c.actionSets.push({ ...defaultActionSet('copy'), owner: 'task', copiedFrom: 'basic' }); c.presets.push({ id: 'p', name: 'P', actionSetId: 'copy' }); }],
  ])('validates references: %s', async (code, change) => {
    const store = new ProjectStore(await root()), config = setup(); change(config);
    expect(() => store.validateReferences(config)).toThrow(expect.objectContaining({ code, status: 400 }));
  });
  it('accepts a task-only copy used by its own task, and saves and reads it back', async () => {
    const dir = await root(), store = new ProjectStore(dir), initial = await store.initialize(), config = setup();
    config.actionSets.push({ ...defaultActionSet('task-keys', 'Task keys'), owner: 'task', copiedFrom: 'basic' });
    config.tasks[0]!.actionSetId = 'task-keys';
    config.presets.push({ id: 'p', name: 'P', comboId: 'default', runRules: { maxReplans: 1 } });
    await store.save(config, initial.revision, { file: 'task.json', task });
    expect((await new ProjectStore(dir).read()).config.actionSets[1]).toMatchObject({ id: 'task-keys', owner: 'task', copiedFrom: 'basic' });
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
  it('keeps executors on existing connections, and the planner and analysis models on LLM connections', () => {
    const config = setup(); config.connections.push(connection('llm', { kind: 'llm' }));
    const withCombo = (change: (a: Combo, c: ProjectConfig) => void) => { const copy = structuredClone(config); change(copy.combos[0]!, copy); return copy; };
    expect(() => parseConfig(withCombo((_, c) => { c.project.analysis.model = { connectionId: 'llm', modelId: 'writer' }; }))).not.toThrow();
    expect(() => parseConfig(withCombo((_, c) => { c.project.analysis.model = { connectionId: 'a', modelId: 'writer' }; }))).toThrow(/LLM connection/);
    expect(() => parseConfig(withCombo((_, c) => { c.project.analysis.model = { connectionId: 'ghost', modelId: 'writer' }; }))).toThrow();
    expect(() => parseConfig(withCombo((_, c) => { c.project.suggestions.model = { connectionId: 'a', modelId: 'writer' }; }))).toThrow(/LLM connection/);
    expect(() => parseConfig(withCombo((_, c) => { c.project.suggestions.model = { connectionId: 'llm', modelId: 'writer' }; }))).not.toThrow();
    expect(() => parseConfig(withCombo(a => { a.analysis = { connectionId: 'llm', modelId: 'writer' }; }))).not.toThrow();
    expect(() => parseConfig(withCombo(a => { a.analysis = { connectionId: 'a', modelId: 'writer' }; }))).toThrow(/explain runs with an LLM/);
    expect(() => parseConfig(withCombo((_, c) => { c.combos[0] = plannedWith(c.combos[0]!, 'llm'); }))).not.toThrow();
    expect(() => parseConfig(withCombo((_, c) => { c.combos[0] = plannedWith(c.combos[0]!, 'a'); }))).toThrow(/plan with an LLM/);
    expect(() => parseConfig(withCombo(a => { a.structure = 'planned'; }))).toThrow(/needs a planner/);
    expect(() => parseConfig(withCombo(a => { a.executors.screenreader = { followPlan: true }; }))).toThrow(/no plan to follow/);
    expect(() => parseConfig(withCombo(a => { a.executors.keyboard!.connectionId = 'ghost'; }))).toThrow(/does not exist/);
    expect(() => parseConfig(withCombo(a => { a.executors = {}; }))).not.toThrow();
    expect(() => parseConfig(withCombo(a => { (a.executors.screenreader as Executor).instructions = ' '; }))).toThrow();
  });
  it('joins a combo with its connections into the models a run calls', () => {
    const config = setup(); config.connections.push(connection('llm', { kind: 'llm', name: 'My LLM' }), connection('llm2', { kind: 'llm', name: 'Other LLM' }));
    const combo = plannedWith(comboWith('p', 'a', 'jev-latest'), 'llm');
    config.project.analysis.model = { connectionId: 'llm', modelId: 'writer' };
    expect(comboExecutor(config, combo, 'keyboard')).toMatchObject({ id: 'a', name: 'a · jev-latest', modelId: 'jev-latest', kind: 'decision', provider: 'custom', baseURL: 'http://127.0.0.1:1234', inputs: ['text', 'image'], maxChoices: 255, maxImages: 2 });
    expect(comboPlanner(config, combo)).toMatchObject({ id: 'llm', name: 'My LLM · planner', kind: 'llm' });
    // A solo combo has no planner, even when one is left in it.
    expect(comboPlanner(config, { ...combo, structure: 'solo' })).toBeUndefined();
    expect(projectAnalysisModel(config)).toMatchObject({ id: 'llm', name: 'My LLM · writer', modelId: 'writer', kind: 'llm', inputs: ['text'] });
    // A combo's own analysis model wins over the project's; without one the project's is used, and without both there is none.
    expect(comboAnalysis(config, combo)).toMatchObject({ id: 'llm', modelId: 'writer' });
    expect(comboAnalysis(config, { analysis: { connectionId: 'llm2', modelId: 'own' } })).toMatchObject({ id: 'llm2', modelId: 'own' });
    expect(comboAnalysis(setup(), combo)).toBeUndefined();
    // A decision connection is never an analysis or suggestion model.
    expect(comboAnalysis(config, { analysis: { connectionId: 'a', modelId: 'own' } })).toBeUndefined();
    // Suggestions use their own model, otherwise the analysis model.
    expect(suggestionModel(config)).toMatchObject({ id: 'llm', modelId: 'writer' });
    config.project.suggestions.model = { connectionId: 'llm2', modelId: 'suggest' };
    expect(suggestionModel(config)).toMatchObject({ id: 'llm2', modelId: 'suggest' });
    // A text-only model takes no images, whatever maxImages says.
    expect(comboExecutor(config, { executors: { keyboard: { ...combo.executors.keyboard!, inputs: ['text'], maxImages: 2 } } }, 'keyboard')!.maxImages).toBe(0);
    expect(comboExecutor(config, defaultCombo(), 'screenreader')).toBeUndefined();
    expect(comboExecutor(config, { executors: { screenreader: { ...combo.executors.screenreader!, connectionId: 'ghost' } } }, 'screenreader')).toBeUndefined();
    expect(comboPlanner(config, { structure: 'planned', planner: { connectionId: 'a', modelId: 'x', instructions: '' } })).toBeUndefined();
  });
  it('lists the modes a combo can run', () => {
    const config = setup();
    expect(comboModes(config, config.combos[0]!)).toEqual(['screenreader', 'keyboard']);
    expect(comboModes(config, defaultCombo())).toEqual([]);
    const textOnly = comboWith('t', 'a'); textOnly.executors.keyboard!.inputs = ['text'];
    expect(comboModes(config, textOnly)).toEqual(['screenreader']);
  });
  it('versions executor instructions by their wording, per combo and mode', () => {
    const combo = comboWith('p', 'a');
    expect(executorPrompt(combo, 'screenreader')).toMatchObject({ id: 'p.screenreader', name: 'p', instructions: instructions.screenreader });
    expect(executorPrompt(combo, 'keyboard')).toMatchObject({ id: 'p.keyboard' });
    const changed = { ...combo, executors: { ...combo.executors, screenreader: { ...combo.executors.screenreader!, instructions: 'Other wording.' } } };
    expect(executorPrompt(changed, 'screenreader')!.version).not.toBe(executorPrompt(combo, 'screenreader')!.version);
    expect(executorPrompt(defaultCombo(), 'keyboard')).toBeUndefined();
  });
  it('assumes images only for providers that pass them', () => {
    expect(defaultInputs({ kind: 'llm', provider: 'openai' })).toEqual(['text', 'image']);
    expect(defaultInputs({ kind: 'decision', provider: 'gateway' })).toEqual(['text']);
  });
});

describe('permissions', () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])('independently restricts type=%s and replace=%s in candidates and execution', (typeText, replaceText) => {
    const actionSet = { ...defaultActionSet(), keyboard: { keys: [], intents: [], inputKeys: ['email'], typeText, replaceText } };
    const permissions = resolvePermissions('simulation', actionSet, task as never, 'keyboard');
    for (const candidates of [screenshotChoices(permissions as Required<typeof permissions>), speechChoices(permissions as Required<typeof permissions>)]) {
      expect(candidates.some(c => c.id === 'type:email')).toBe(typeText);
      expect(candidates.some(c => c.id === 'replace:email')).toBe(replaceText);
    }
    const check = (kind: 'typeText' | 'replaceText') => () => validateDecision({ action: { kind, input: 'email' } }, permissions as Required<typeof permissions>);
    if (typeText) expect(check('typeText')).not.toThrow(); else expect(check('typeText')).toThrow();
    if (replaceText) expect(check('replaceText')).not.toThrow(); else expect(check('replaceText')).toThrow();
    expect(permissions.keys).toEqual([]);
    expect(resolvePermissions('simulation', defaultActionSet(), task as never, 'keyboard').keys).toEqual(defaultActionSet().keyboard.keys);
  });
  it('refuses actions the assistive technology lacks, listing them, and input names the task does not have', () => {
    const keys = { ...defaultActionSet(), keyboard: { ...defaultActionSet().keyboard, keys: ['Tab', 'F13', 'F14'] } };
    expect(() => resolvePermissions('simulation', keys, task as never, 'keyboard')).toThrow(expect.objectContaining({ code: 'unsupported-action', message: expect.stringContaining('F13, F14') }));
    const intents = { ...defaultActionSet(), screenreader: { ...defaultActionSet().screenreader, intents: ['next', 'levitate'] } };
    expect(() => resolvePermissions('simulation', intents, task as never, 'screenreader')).toThrow(expect.objectContaining({ code: 'unsupported-action', message: expect.stringContaining('levitate') }));
    const unknown = { ...defaultActionSet(), keyboard: { ...defaultActionSet().keyboard, inputKeys: ['nope'], typeText: true } };
    expect(() => resolvePermissions('simulation', unknown, task as never, 'keyboard')).toThrow(expect.objectContaining({ code: 'unknown-input' }));
  });
  it('resolves a copy of the action set, never changing the stored one', () => {
    const actionSet = defaultActionSet(), before = structuredClone(actionSet);
    resolvePermissions('simulation', actionSet, task as never, 'keyboard').keys.push('X');
    expect(actionSet).toEqual(before);
  });
});

describe('project config', () => {
  it('loads a saved config without run rules and defaults them', async () => {
    const dir = await root(), store = new ProjectStore(dir), first = await store.initialize();
    const old = JSON.parse(JSON.stringify(first.config)); delete old.runRules; delete old.project; delete old.presets; delete old.combos[0].executors;
    old.combos[0].executors = {};
    await writeFile(store.path, JSON.stringify(old));
    const config = (await new ProjectStore(dir).read()).config;
    expect(config.runRules).toMatchObject({ repetitionGuard: 'auto', modelGiveUp: false });
    expect(config.presets).toEqual([]); expect(config.project).toEqual({ analysis: { instructions: '' }, suggestions: {} });
    expect(defaultConfig().runRules).toMatchObject({ repetitionGuard: 'auto', modelGiveUp: false });
    expect(() => configSchema.parse({ ...old, runRules: { repetitionGuard: 'sometimes' } })).toThrow();
    expect(() => configSchema.parse({ ...old, runRules: { unknownRule: 1 } })).toThrow();
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
  it('accepts only version 3 configs', () => {
    const config = defaultConfig();
    expect(config.version).toBe(3);
    expect(parseConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(() => parseConfig({ ...config, version: 2 })).toThrow();
    expect(() => parseConfig({ version: 3, connections: [], tasks: [], agents: [], machine: {} })).toThrow();
    expect(() => parseConfig({ ...config, combos: [] })).toThrow();
    expect(() => parseConfig({ ...config, atEnvironments: [{ id: 'x', name: 'x', backend: 'jaws' }] })).toThrow();
  });
  it('starts a project with one shared item of each condition and no presets', () => {
    const config = defaultConfig();
    expect(config.combos.map(c => c.id)).toEqual(['default']); expect(config.combos[0]).toMatchObject({ structure: 'solo', executors: {} });
    expect(config.actionSets).toEqual([defaultActionSet()]); expect(config.actionSets[0]!.keyboard.keys).toContain('Tab');
    expect(config.pageEnvironments).toEqual([{ id: 'default', name: 'Default', profile: 'default' }]);
    expect(config.atEnvironments).toEqual([{ id: 'simulation', name: 'Simulated VoiceOver', backend: 'simulation' }]);
    expect(config.presets).toEqual([]); expect(config.machine.atEndpoints).toEqual({ voiceover: '', nvda: '' });
  });
  it('finds connections and combos by id first, then by name', () => {
    const list = [{ id: 'one', name: 'two' }, { id: 'two', name: 'one' }];
    expect(findByIdOrName(list, 'one')).toBe(list[0]); expect(findByIdOrName(list, 'two')).toBe(list[1]); expect(findByIdOrName(list, 'three')).toBeUndefined();
  });
  it('keeps only the fields a preset or a task overrides, so the project\'s other rules still apply', () => {
    const config = defaultConfig(); config.tasks.push({ id: 'task', name: 'T', file: 't.json', runRules: { maxReplans: 4 } }); config.presets.push({ id: 'p', name: 'P', runRules: { failureLimit: 5 } });
    const parsed = parseConfig(JSON.parse(JSON.stringify(config)));
    expect(parsed.tasks[0]!.runRules).toEqual({ maxReplans: 4 }); expect(parsed.presets[0]!.runRules).toEqual({ failureLimit: 5 });
  });
  it('layers run rules field by field: the task over the preset over the project, other fields from the project', () => {
    const config = setup(); config.runRules = resolveRunRules(config, { maxStateVisits: 7, maxReplans: 3, failureLimit: 6 });
    const preset = { id: 'p', name: 'P', runRules: { maxReplans: 5 } };
    const parsedTask = taskSchema.parse({ id: 'task', name: 'T', file: 'task.json', runRules: { maxStateVisits: 2 } });
    expect(parsedTask.runRules).toEqual({ maxStateVisits: 2 });
    const rules = resolveRunRules(config, preset.runRules, parsedTask.runRules);
    expect(rules).toEqual({ ...config.runRules, maxStateVisits: 2, maxReplans: 5 });
    const checked = checkRun({ config, task: task as never, taskEntry: parsedTask, combo: config.combos[0]!, actionSet: config.actionSets[0]!, pageEnvironment: config.pageEnvironments[0]!, atEnvironment: config.atEnvironments[0]!, preset, mode: 'keyboard' });
    expect(checked.settings.runRules).toEqual(rules);
  });
  it('lists shared items without task-only copies', () => {
    expect(sharedItems([{ id: 'a' }, { id: 'b', owner: 'task' }, { id: 'c', owner: undefined }]).map(i => i.id)).toEqual(['a', 'c']);
  });
});

describe('conditions of a task', () => {
  /** Two items of every kind, the second one chosen by the preset, a third one chosen by the task. */
  function conditionsConfig(): ProjectConfig {
    const config = setup();
    config.combos.push(comboWith('c2', 'a'), comboWith('c3', 'b'));
    config.actionSets.push({ ...defaultActionSet('s2'), name: 'S2' }, { ...defaultActionSet('s3'), name: 'S3' });
    config.pageEnvironments.push({ id: 'e2', name: 'E2', profile: 'narrow' }, { id: 'e3', name: 'E3', profile: 'narrow' });
    config.atEnvironments.push({ id: 'at2', name: 'AT2', backend: 'nvda' }, { id: 'at3', name: 'AT3', backend: 'voiceover' });
    config.presets.push({ id: 'pre', name: 'Pre', comboId: 'c2', actionSetId: 's2', pageEnvironmentId: 'e2', atEnvironmentId: 'at2' });
    return config;
  }
  const ids = (c: ReturnType<typeof taskConditions>) => [c.combo.id, c.actionSet.id, c.pageEnvironment.id, c.atEnvironment.id, c.preset?.id];
  it('falls back to the first shared item of each kind when nothing is chosen', () => {
    expect(ids(taskConditions(conditionsConfig(), {}))).toEqual(['default', 'basic', 'default', 'simulation', undefined]);
  });
  it('takes each field from the task, then the preset, then the first shared item', () => {
    const config = conditionsConfig();
    expect(ids(taskConditions(config, { presetId: 'pre' }))).toEqual(['c2', 's2', 'e2', 'at2', 'pre']);
    expect(ids(taskConditions(config, { presetId: 'pre', comboId: 'c3', pageEnvironmentId: 'e3' }))).toEqual(['c3', 's2', 'e3', 'at2', 'pre']);
    config.presets[0] = { id: 'pre', name: 'Pre', actionSetId: 's2' };
    expect(ids(taskConditions(config, { presetId: 'pre', atEnvironmentId: 'at3' }))).toEqual(['default', 's2', 'default', 'at3', 'pre']);
    expect(ids(taskConditions(config, { comboId: 'c3', actionSetId: 's3', pageEnvironmentId: 'e3', atEnvironmentId: 'at3' }))).toEqual(['c3', 's3', 'e3', 'at3', undefined]);
  });
  it('falls back to the first shared item for an id that is gone or a preset that does not exist', () => {
    expect(ids(taskConditions(conditionsConfig(), { comboId: 'gone', actionSetId: 'gone', presetId: 'gone' }))).toEqual(['default', 'basic', 'default', 'simulation', undefined]);
  });
  it('never falls back to a task-only copy, but uses one the task names', () => {
    const config = conditionsConfig();
    config.combos.unshift({ ...comboWith('mine', 'b'), owner: 'task', copiedFrom: 'default' });
    config.actionSets.unshift({ ...defaultActionSet('mine'), owner: 'task', copiedFrom: 'basic' });
    config.pageEnvironments.unshift({ id: 'mine', name: 'Mine', profile: 'narrow', owner: 'task', copiedFrom: 'default' });
    expect(ids(taskConditions(config, {}))).toEqual(['default', 'basic', 'default', 'simulation', undefined]);
    expect(ids(taskConditions(config, { comboId: 'mine', actionSetId: 'mine', pageEnvironmentId: 'mine' }))).toEqual(['mine', 'mine', 'mine', 'simulation', undefined]);
    expect(config.combos[0]).toMatchObject({ owner: 'task', copiedFrom: 'default' });
    expect(() => parseConfig(config)).not.toThrow();
    // When every item of a kind is a copy, the first one is still better than nothing.
    config.actionSets = config.actionSets.filter(s => s.owner);
    expect(taskConditions(config, {}).actionSet.id).toBe('mine');
  });
  it('merges run rules as the project\'s, then the preset\'s, then the task\'s', () => {
    const config = setup(); config.runRules = resolveRunRules(config, { maxReplans: 5, modelGiveUp: true });
    expect(resolveRunRules(config)).toMatchObject({ maxReplans: 5, modelGiveUp: true, failureLimit: 2, noChangeLimit: 3 });
    expect(resolveRunRules(config, { maxReplans: 3, failureLimit: 4 }, undefined, { failureLimit: 7, modelGiveUp: false })).toMatchObject({ maxReplans: 3, failureLimit: 7, modelGiveUp: false, noChangeLimit: 3 });
    expect(() => resolveRunRules(config, { maxReplans: -1 })).toThrow();
    expect(config.runRules.maxReplans).toBe(5);
  });
  it('records the conditions of a run by content, marking task-only copies with where they came from', () => {
    const config = setup(), actionSet = { ...defaultActionSet('mine'), owner: 'task', copiedFrom: 'basic' };
    config.actionSets.push(actionSet);
    const conditions = { combo: config.combos[0]!, actionSet, pageEnvironment: config.pageEnvironments[0]!, atEnvironment: config.atEnvironments[0]!, preset: { id: 'pre', name: 'Pre' } };
    const check = assertRunnable(checkRun({ config, task: task as never, taskEntry: config.tasks[0], ...conditions, mode: 'keyboard' }));
    const record = conditionsRecord(conditions, check);
    expect(record).toMatchObject({
      combo: { id: 'default', structure: 'solo', executor: 'a · m-a', prompt: { id: 'default.keyboard' } },
      actionSet: { id: 'mine', owner: 'task', copiedFrom: 'basic', permissions: { keys: expect.arrayContaining(['Tab']) } },
      pageEnvironment: { id: 'default', profile: 'default' }, atEnvironment: { id: 'simulation', backend: 'simulation' },
      runRules: { maxReplans: expect.any(Number) }, preset: { id: 'pre', name: 'Pre' },
    });
    expect((record.combo as Record<string, unknown>).owner).toBeUndefined();
    const spec = runSpecOf(task as never, 'keyboard', conditions, check);
    expect(spec).toMatchObject({ mode: 'keyboard', backend: 'simulation', executor: { historyLimit: 12, focusGate: false }, conditions: record });
  });
});

describe('run checks', () => {
  const choiceOf = (config: ProjectConfig, mode: 'keyboard' | 'screenreader' = 'keyboard') => config.combos[0]!.executors[mode]! as Executor;
  const check = (config: ProjectConfig, change: (c: ProjectConfig) => void = () => {}, extra: Partial<Parameters<typeof checkRun>[0]> = {}) => {
    change(config);
    return checkRun({ config, task: task as never, taskEntry: config.tasks[0], combo: config.combos[0]!, actionSet: config.actionSets[0]!, pageEnvironment: config.pageEnvironments[0]!,
      atEnvironment: config.atEnvironments[0]!, mode: 'keyboard', ...extra });
  };
  const withLlm = (c: ProjectConfig) => { c.connections.push(connection('llm', { kind: 'llm' })); };
  it('accepts a supported combination and returns its settings and the combo\'s executor with its instructions', () => {
    const result = check(setup());
    expect(result.problem).toBeUndefined(); expect(result.settings.runRules.maxReplans).toBeGreaterThan(0); expect(result.warnings).toEqual([]);
    expect(result.model).toMatchObject({ id: 'a', modelId: 'm-a', name: 'a · m-a' }); expect(result.analysisModel).toBeUndefined();
    expect(result.prompt).toMatchObject({ id: 'default.keyboard', instructions: instructions.keyboard });
    expect(assertRunnable(result).permissions.keys).toContain('Tab');
  });
  it.each([
    ['combo-without-executor', (c: ProjectConfig) => { delete c.combos[0]!.executors.keyboard; }],
    ['model-needs-images', (c: ProjectConfig) => { choiceOf(c).inputs = ['text']; }],
    ['too-many-choices', (c: ProjectConfig) => { choiceOf(c).maxChoices = 4; }],
    ['unsupported-action', (c: ProjectConfig) => { c.actionSets[0]!.keyboard.keys = ['F13']; }],
    ['focus-gate-llm', (c: ProjectConfig) => { c.connections[0]!.kind = 'llm'; choiceOf(c).focusGate = true; }],
    ['environment-unsupported', (c: ProjectConfig) => { c.pageEnvironments[0]!.profile = 'zoom-200'; }],
  ])('reports %s as the problem, not by throwing', (code, change) => {
    const result = check(setup(), change);
    expect(result.problem).toBeInstanceOf(ProjectError); expect(result.problem!.code).toBe(code);
    expect(() => assertRunnable(result)).toThrow(result.problem!);
    expect(result.permissions).toBeDefined();
  });
  it('explains a missing action by name, and a combo without an executor for the mode by what to do', () => {
    expect(check(setup(), c => { c.actionSets[0]!.keyboard.keys = ['Tab', 'F13', 'F14']; }).problem!.message).toMatch(/F13, F14/);
    const none = check(setup(), c => { delete c.combos[0]!.executors.keyboard; });
    expect(none.model).toBeUndefined(); expect(none.problem!.message).toMatch(/no keyboard executor.*images/i);
    expect(check(setup(), c => { delete c.combos[0]!.executors.keyboard; }, { mode: 'screenreader' }).problem).toBeUndefined();
    expect(check(setup(), c => { delete c.combos[0]!.executors.screenreader; }, { mode: 'screenreader' }).problem).toMatchObject({ code: 'combo-without-executor', message: expect.stringMatching(/no screen reader executor/) });
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
    const limit = (modelGiveUp: boolean, maxChoices: number) => check(setup(), c => { choiceOf(c).maxChoices = maxChoices; c.runRules.modelGiveUp = modelGiveUp; }).problem?.code;
    expect(limit(true, 6)).toBe('too-many-choices'); expect(limit(true, 7)).toBeUndefined();
    expect(limit(false, 4)).toBe('too-many-choices'); expect(limit(false, 5)).toBeUndefined();
    // The preset and the task can turn give-up on for their runs.
    const rules = { maxChoices: 6 };
    const viaPreset = check(setup(), c => { choiceOf(c).maxChoices = rules.maxChoices; }, { preset: { id: 'p', name: 'P', runRules: { modelGiveUp: true } } }).problem?.code;
    expect(viaPreset).toBe('too-many-choices');
    expect(check(setup(), c => { choiceOf(c).maxChoices = 6; c.tasks[0]!.runRules = { modelGiveUp: true }; }).problem?.code).toBe('too-many-choices');
  });
  it('merges the run rules of the project, the preset and the task, the task last', () => {
    const result = check(setup(), c => { c.runRules.maxReplans = 5; c.runRules.stepActionLimit = 9; c.tasks[0]!.runRules = { failureLimit: 7, maxReplans: 1 }; },
      { preset: { id: 'p', name: 'P', runRules: { maxReplans: 3, failureLimit: 4, noChangeLimit: 6 } } });
    expect(result.settings.runRules).toMatchObject({ maxReplans: 1, stepActionLimit: 9, failureLimit: 7, noChangeLimit: 6, modelGiveUp: false });
    expect(check(setup(), c => { c.project.analysis.instructions = 'Project focus.'; }).settings.analysisInstructions).toBe('Project focus.');
    expect(check(setup(), c => { c.project.analysis.instructions = 'Project focus.'; c.tasks[0]!.analysisInstructions = 'Task focus.'; }).settings.analysisInstructions).toBe('Task focus.');
  });
  it('never blocks a run on analysis: a model that is not an LLM only warns, and the combo\'s own analysis wins over the project\'s', () => {
    const bad = check(setup(), c => { c.project.analysis.model = { connectionId: 'b', modelId: 'writer' }; });
    expect(bad.problem).toBeUndefined(); expect(bad.analysisModel).toBeUndefined(); expect(bad.warnings).toEqual([expect.stringMatching(/not on an LLM connection.*rules only/)]);
    const badCombo = check(setup(), c => { c.combos[0]!.analysis = { connectionId: 'b', modelId: 'writer' }; });
    expect(badCombo.problem).toBeUndefined(); expect(badCombo.warnings).toHaveLength(1);
    const project = check(setup(), c => { withLlm(c); c.project.analysis.model = { connectionId: 'llm', modelId: 'writer' }; });
    expect(project.problem).toBeUndefined(); expect(project.warnings).toEqual([]); expect(project.analysisModel).toMatchObject({ id: 'llm', modelId: 'writer', kind: 'llm' });
    const own = check(setup(), c => { withLlm(c); c.project.analysis.model = { connectionId: 'llm', modelId: 'writer' }; c.combos[0]!.analysis = { connectionId: 'llm', modelId: 'own' }; });
    expect(own.analysisModel).toMatchObject({ modelId: 'own' });
    expect(check(setup()).warnings).toEqual([]);
    expect(check(setup(), () => {}, { mode: 'screenreader', diagnoseStop: true }).problem?.code).toBe('diagnose-keyboard-only');
  });
  describe('planned combos', () => {
    const planned = (c: ProjectConfig, instructionsText = 'Plan like an expert.') => { withLlm(c); c.combos[0] = plannedWith(c.combos[0]!, 'llm', 'planner', instructionsText); };
    it('plan in screen reader mode, with the planner\'s model and added instructions', () => {
      const reader = check(setup(), c => planned(c), { mode: 'screenreader' });
      expect(reader.problem).toBeUndefined(); expect(reader.warnings).toEqual([]);
      expect(reader.plannerModel).toMatchObject({ id: 'llm', modelId: 'planner', kind: 'llm' }); expect(reader.plannerInstructions).toBe('Plan like an expert.');
      expect(check(setup(), c => { c.combos[0]!.planner = { connectionId: 'llm', modelId: 'planner', instructions: '' }; withLlm(c); }, { mode: 'screenreader' }).plannerModel).toBeUndefined();
    });
    it('only warn in keyboard mode: the keyboard executor decides alone', () => {
      const keyboard = check(setup(), c => planned(c));
      expect(keyboard.problem).toBeUndefined(); expect(keyboard.plannerModel).toBeUndefined(); expect(keyboard.plannerInstructions).toBeUndefined();
      expect(keyboard.warnings).toEqual([expect.stringMatching(/Keyboard runs do not use the planner/)]);
    });
    it('need a planner on an LLM connection or a plan file in screen reader mode, and count the four task choices only when the executor controls tasks', () => {
      expect(check(setup(), c => { c.combos[0] = plannedWith(c.combos[0]!, 'b'); }, { mode: 'screenreader' }).problem?.code).toBe('planner-model-invalid');
      expect(check(setup(), c => { c.combos[0] = plannedWith(c.combos[0]!, 'b'); }).problem).toBeUndefined();
      const choices = (maxChoices: number, executorControls = false) => check(setup(), c => { planned(c); choiceOf(c, 'screenreader').maxChoices = maxChoices; if (executorControls) c.runRules.taskControl = 'executor'; }, { mode: 'screenreader' }).problem?.code;
      const base = check(setup(), () => {}, { mode: 'screenreader' }).permissions, count = base.keys.length + base.intents.length + 1;
      expect(choices(count)).toBeUndefined();
      expect(choices(count + 3, true)).toBe('too-many-choices'); expect(choices(count + 4, true)).toBeUndefined();
    });
    it('give a file planner the task\'s own plan file, and record it in the conditions', () => {
      const filed = check(setup(), c => { Object.assign(c.combos[0]!, { structure: 'planned', planner: { planFile: 'plans/{task}/L2.json' } }); }, { mode: 'screenreader', taskEntry: { file: 'tasks/cart.json' } });
      expect(filed.problem).toBeUndefined(); expect(filed.plannerPlanFile).toBe('plans/cart/L2.json'); expect(filed.plannerModel).toBeUndefined();
      expect(check(setup(), c => { Object.assign(c.combos[0]!, { structure: 'planned', planner: { planFile: 'plans/{task}/L2.json' } }); }, { mode: 'screenreader', taskEntry: {} }).problem?.code).toBe('plan-file-task');
    });
    it('run a combo that follows its plan without a screen reader executor model or its key', () => {
      const follow = (c: ProjectConfig) => { Object.assign(c.combos[0]!, { structure: 'planned', planner: { planFile: 'plans/{task}/L2.json' } }); c.combos[0]!.executors.screenreader = { followPlan: true }; };
      const result = check(setup(), follow, { mode: 'screenreader', taskEntry: { file: 'tasks/cart.json' } });
      expect(result.problem).toBeUndefined();
      expect(result.model).toMatchObject({ id: 'rawstep-plan-follower', modelId: 'follow-plan' }); expect(result.prompt).toMatchObject({ instructions: '' });
      expect(check(setup(), c => { follow(c); c.runRules.taskControl = 'executor'; }, { mode: 'screenreader', taskEntry: { file: 'tasks/cart.json' } }).problem?.code).toBe('follow-plan-task-control');
      // Keyboard runs still need their own executor.
      expect(check(setup(), follow, { mode: 'keyboard', taskEntry: { file: 'tasks/cart.json' } }).model).toMatchObject({ id: 'a' });
    });
    it('hand the screen reader executor\'s latitude to the run, and none when the plan is followed', () => {
      const config = setup(); Object.assign(config.combos[0]!, { structure: 'planned', planner: { planFile: 'plans/{task}/L2.json' } }); choiceOf(config, 'screenreader').latitude = 'direction';
      const conditions = { combo: config.combos[0]!, actionSet: config.actionSets[0]!, pageEnvironment: config.pageEnvironments[0]!, atEnvironment: config.atEnvironments[0]! };
      const spec = (c: ProjectConfig) => runSpecOf(task as never, 'screenreader', conditions, assertRunnable(check(c, () => {}, { mode: 'screenreader', taskEntry: { file: 'tasks/cart.json' } })));
      expect(spec(config).executor).toMatchObject({ latitude: 'direction' });
      config.combos[0]!.executors.screenreader = { followPlan: true };
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
    const a = comboExecutor(setup(), setup().combos[0]!, 'keyboard')!;
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

  it('runs a registered task with the executor of its combo, writing under .rawstep/runs and returning the conditions', async () => {
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
      combo: { id: 'default', structure: 'solo', executor: 'a · m-a', prompt: { id: 'default.keyboard' } }, actionSet: { id: 'basic' }, pageEnvironment: { id: 'default' },
      atEnvironment: { id: 'simulation', backend: 'simulation' }, runRules: { maxReplans: expect.any(Number) },
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
  it('resolves each condition by id or by name, and reports unknown ones with the choices', async () => {
    const { dir } = await project(config => {
      config.combos.push(comboWith('zoom', 'b', 'm-b', 'Zoom check')); config.pageEnvironments.push({ id: 'narrow', name: 'Narrow', profile: 'narrow' });
      config.actionSets.push({ ...defaultActionSet('wide', 'Wide'), keyboard: { keys: ['Tab'], intents: [], typeText: false, replaceText: false } });
      config.atEnvironments.push({ id: 'second', name: 'Second simulation', backend: 'simulation' });
    });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'), recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir, combo: 'zoom' }, { execute });
    await runTask('task', { projectDir: dir, combo: 'Zoom check', pageEnvironment: 'Narrow' }, { execute });
    await runTask('task', { projectDir: dir, combo: 'Default' }, { execute });
    await runTask('task', { projectDir: dir, actionSet: 'Wide', atEnvironment: 'second' }, { execute });
    expect(calls.map(c => c.spec.model.id)).toEqual(['b', 'b', 'a', 'a']);
    expect(calls[0]!.spec.model).toMatchObject({ modelId: 'm-b', name: 'b · m-b' });
    expect(calls.map(c => (c.spec.environment as { id: string }).id)).toEqual(['default', 'narrow', 'default', 'default']);
    expect(calls[3]!.spec.permissions.keys).toEqual(['Tab']); expect(calls[3]!.spec.conditions).toMatchObject({ actionSet: { id: 'wide' }, atEnvironment: { id: 'second' } });
    await expect(runTask('task', { projectDir: dir, combo: 'nope' }, { execute })).rejects.toMatchObject({ code: 'combo-not-found', message: expect.stringContaining('Zoom check (zoom)') });
    await expect(runTask('task', { projectDir: dir, actionSet: 'nope' }, { execute })).rejects.toMatchObject({ code: 'action-set-not-found', message: expect.stringContaining('Wide (wide)') });
    await expect(runTask('task', { projectDir: dir, pageEnvironment: 'nope' }, { execute })).rejects.toMatchObject({ code: 'page-environment-not-found' });
    await expect(runTask('task', { projectDir: dir, atEnvironment: 'nope' }, { execute })).rejects.toMatchObject({ code: 'at-environment-not-found' });
    await expect(runTask('task', { projectDir: dir, preset: 'nope' }, { execute })).rejects.toMatchObject({ code: 'preset-not-found' });
    expect(calls).toHaveLength(4);
  });
  it('uses the task\'s combo, otherwise the first shared one, with that combo\'s executor and instructions for the mode', async () => {
    const { dir } = await project(config => { config.combos.push(comboWith('second', 'b', 'm-b', 'Second')); config.tasks[0]!.comboId = 'second'; });
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir, mode: 'screenreader' }, { execute });
    expect(calls[0]!.spec.permissions.intents).toContain('next'); expect(calls[0]!.spec.mode).toBe('screenreader');
    expect(calls[0]!.spec.model.id).toBe('b'); expect(calls[0]!.spec.environment).toEqual(expect.objectContaining({ id: 'default' }));
    expect(calls[0]!.spec.prompt).toMatchObject({ id: 'second.screenreader', instructions: instructions.screenreader });
  });
  it('fills conditions from a preset, below the task\'s own choices and above the options only when none are given', async () => {
    const { dir } = await project(config => {
      config.combos.push(comboWith('c2', 'b', 'm-b', 'Second'), comboWith('c3', 'a', 'm-c', 'Third'));
      config.pageEnvironments.push({ id: 'narrow', name: 'Narrow', profile: 'narrow' });
      config.presets.push({ id: 'pre', name: 'Preset one', comboId: 'c2', pageEnvironmentId: 'narrow', runRules: { maxReplans: 2, failureLimit: 5 } });
    });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    const first = await runTask('task', { projectDir: dir, preset: 'Preset one' }, { execute });
    expect(calls[0]!.spec.model.id).toBe('b'); expect((calls[0]!.spec.environment as { id: string }).id).toBe('narrow');
    expect(calls[0]!.spec.settings.runRules).toMatchObject({ maxReplans: 2, failureLimit: 5 });
    expect(first.conditions).toMatchObject({ preset: { id: 'pre', name: 'Preset one' }, combo: { id: 'c2' }, pageEnvironment: { id: 'narrow' } });
    // An option beats the preset; the preset still fills the rest.
    await runTask('task', { projectDir: dir, preset: 'pre', combo: 'c3' }, { execute });
    expect(calls[1]!.spec.model.modelId).toBe('m-c'); expect((calls[1]!.spec.environment as { id: string }).id).toBe('narrow');
    // A preset the task names itself applies without an option.
    const named = await project(config => { config.combos.push(comboWith('c2', 'b')); config.presets.push({ id: 'pre', name: 'P', comboId: 'c2' }); config.tasks[0]!.presetId = 'pre'; });
    await runTask('task', { projectDir: named.dir }, { execute });
    expect(calls[2]!.spec.model.id).toBe('b'); expect(calls[2]!.spec.conditions).toMatchObject({ preset: { id: 'pre' } });
  });
  it('merges run rules as the project\'s, the preset\'s, the task\'s and then the options\'', async () => {
    const { dir } = await project(config => {
      config.runRules = resolveRunRules(config, { maxReplans: 8, stepActionLimit: 20, failureLimit: 3 });
      config.presets.push({ id: 'pre', name: 'Pre', runRules: { maxReplans: 6, failureLimit: 4 } });
      config.tasks[0]!.runRules = { maxReplans: 4, noChangeLimit: 9 };
    });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.settings.runRules).toMatchObject({ maxReplans: 4, stepActionLimit: 20, failureLimit: 3, noChangeLimit: 9 });
    const result = await runTask('task', { projectDir: dir, preset: 'pre', runRules: { maxReplans: 1 } }, { execute });
    expect(calls[1]!.spec.settings.runRules).toMatchObject({ maxReplans: 1, stepActionLimit: 20, failureLimit: 4, noChangeLimit: 9 });
    expect(result.conditions).toMatchObject({ runRules: { maxReplans: 1, failureLimit: 4 } });
  });
  it('runs a task-only copy for its own task and records what it was copied from', async () => {
    const { dir } = await project(config => {
      config.actionSets.unshift({ ...defaultActionSet('task-keys', 'Task keys'), keyboard: { keys: ['Tab'], intents: [], typeText: false, replaceText: false }, owner: 'task', copiedFrom: 'basic' });
      config.tasks[0]!.actionSetId = 'task-keys';
    });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    const result = await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.permissions.keys).toEqual(['Tab']);
    expect(result.conditions).toMatchObject({ actionSet: { id: 'task-keys', owner: 'task', copiedFrom: 'basic' } });
    // A task file that is not registered never inherits the copy: it gets the first shared action set.
    await writeFile(join(dir, 'other.json'), JSON.stringify({ ...task, goal: 'Other goal' }));
    await runTask('other.json', { projectDir: dir }, { execute });
    expect(calls[1]!.spec.permissions.keys).toContain('Shift+Tab'); expect(calls[1]!.spec.conditions).toMatchObject({ actionSet: { id: 'basic' } });
  });
  it('explains when the combo has none for the mode or it cannot take images', async () => {
    const text = await project(config => { config.combos[0]!.executors.keyboard!.inputs = ['text']; });
    await expect(runTask('task', { projectDir: text.dir }, { execute: player().execute })).rejects.toMatchObject({ code: 'model-needs-images', message: expect.stringMatching(/Keyboard runs.*image/) });
    expect((await runTask('task', { projectDir: text.dir, mode: 'screenreader' }, { execute: player(recorded(['Enter'], 'success')).execute })).runs).toHaveLength(1);
    const none = await project(config => { config.combos[0]!.executors = {}; });
    await expect(runTask('task', { projectDir: none.dir }, { execute: player().execute })).rejects.toMatchObject({ code: 'combo-without-executor', message: expect.stringMatching(/no keyboard executor/i) });
    // Another combo with an executor still runs: nothing else is picked for the combo that has none.
    const { calls, execute } = player(recorded(['Enter'], 'success'));
    const mixed = await project(config => { config.combos[0]!.executors = {}; config.combos.push(comboWith('second', 'b')); });
    await runTask('task', { projectDir: mixed.dir, combo: 'second' }, { execute });
    expect(calls[0]!.spec.model.id).toBe('b');
    await expect(runTask('task', { projectDir: mixed.dir }, { execute })).rejects.toMatchObject({ code: 'combo-without-executor' });
  });
  describe('planned combos', () => {
    const planning = (config: ProjectConfig) => {
      config.connections.push(connection('planner', { kind: 'llm', provider: 'openai' }));
      config.combos[0] = plannedWith(config.combos[0]!, 'planner', 'plan-model', 'Be careful.');
    };
    it('plan only in screen reader mode, with the planner\'s key; keyboard runs warn and need no planner key', async () => {
      const { dir, store } = await project(planning), { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
      const keyboard = await runTask('task', { projectDir: dir }, { execute });
      expect(calls[0]!.spec.plannerModel).toBeUndefined();
      expect(keyboard.warnings).toEqual([expect.stringMatching(/Keyboard runs do not use the planner/)]);
      expect(keyboard.conditions).toMatchObject({ combo: { structure: 'planned' } });
      await expect(runTask('task', { projectDir: dir, mode: 'screenreader' }, { execute })).rejects.toMatchObject({ code: 'missing-credential', message: expect.stringContaining('RAWSTEP_OPENAI_API_KEY') });
      await store.setCredential('openai', 'sk-planner-key');
      const reader = await runTask('task', { projectDir: dir, mode: 'screenreader' }, { execute });
      expect(calls).toHaveLength(2);
      expect(calls[1]!.spec).toMatchObject({ plannerModel: { id: 'planner', modelId: 'plan-model' }, plannerInstructions: 'Be careful.' });
      expect(reader.warnings).toEqual([]); expect(reader.conditions).toMatchObject({ combo: { structure: 'planned', planner: 'planner · plan-model' } });
    });
  });
  describe('assistive technology', () => {
    it('passes the picked environment to screen reader runs, and ignores it in keyboard runs', async () => {
      const { dir } = await project(config => { config.atEnvironments.push({ id: 'nvda', name: 'NVDA', backend: 'nvda' }); });
      const { calls, execute } = player(recorded(['Enter'], 'success'));
      await runTask('task', { projectDir: dir, atEnvironment: 'nvda' }, { execute });
      expect(calls[0]!.spec.backend).toBe('nvda');
      if (process.platform !== 'win32') await expect(runTask('task', { projectDir: dir, mode: 'screenreader', atEnvironment: 'nvda' }, { execute })).rejects.toMatchObject({ code: 'nvda-windows' });
      expect(calls).toHaveLength(1);
    });
  });
  it('runs an unregistered task file with the first shared conditions, resolving the path from the project directory', async () => {
    const { dir } = await project(config => { config.combos.push(comboWith('second', 'b', 'm-b', 'Second')); config.tasks[0]!.comboId = 'second'; });
    await writeFile(join(dir, 'other.json'), JSON.stringify({ ...task, goal: 'Other goal' }));
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await runTask('other.json', { projectDir: dir }, { execute });
    expect(calls[0]!.spec.task.goal).toBe('Other goal'); expect(calls[0]!.spec.prompt.id).toBe('default.keyboard'); expect(calls[0]!.spec.model.id).toBe('a');
    // The registered task's own file is recognized and keeps its configuration.
    await runTask('./task.json', { projectDir: dir, mode: 'keyboard' }, { execute });
    expect(calls[1]!.spec.task.goal).toBe('Complete fixture'); expect(calls[1]!.spec.model.id).toBe('b');
    await expect(runTask('missing.json', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'task-not-found', message: expect.stringContaining('Known tasks: task') });
    await writeFile(join(dir, 'broken.json'), '{nope');
    await expect(runTask('broken.json', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'invalid-task' });
  });
  it('says what to do when there is no config, an old config, no matching setup or bad options', async () => {
    const empty = await root(), { execute } = player();
    await expect(runTask('task', { projectDir: empty }, { execute })).rejects.toMatchObject({ code: 'no-config', message: expect.stringMatching(/rawstep\.config\.json.*rawstep init.*rawstep ui/) });
    const old = await root(); await writeFile(join(old, 'rawstep.config.json'), JSON.stringify({ version: 2 }));
    await expect(runTask('task', { projectDir: old }, { execute })).rejects.toMatchObject({ code: 'old-config', message: expect.stringMatching(/version 2.*migrate-config\.mjs/) });
    const { dir } = await project();
    await expect(runTask('task', { projectDir: dir, repeat: 0 }, { execute })).rejects.toMatchObject({ code: 'invalid-repeat' });
    await expect(runTask('task', { projectDir: dir, repeat: 1.5 }, { execute })).rejects.toMatchObject({ code: 'invalid-repeat' });
    await expect(runTask('task', { projectDir: dir, mode: 'mouse' as never }, { execute })).rejects.toMatchObject({ code: 'invalid-mode' });
    const unsupported = await project(config => { config.pageEnvironments[0]!.profile = 'zoom-200'; });
    await expect(runTask('task', { projectDir: unsupported.dir }, { execute })).rejects.toMatchObject({ code: 'environment-unsupported' });
    await expect(runTask('task', { projectDir: dir, diagnoseStop: true, mode: 'screenreader' }, { execute })).rejects.toMatchObject({ code: 'diagnose-keyboard-only' });
  });
  it('requires the provider key, reading it from .env.local, and hands it to the run; a custom server needs none', async () => {
    const { dir, store } = await project(config => { config.connections[0] = connection('a', { kind: 'llm', provider: 'openai' }); config.combos.push(comboWith('second', 'b')); });
    const { calls, execute } = player(recorded(['Enter'], 'success'), recorded(['Enter'], 'success'));
    await expect(runTask('task', { projectDir: dir }, { execute })).rejects.toMatchObject({ code: 'missing-credential', message: expect.stringContaining('RAWSTEP_OPENAI_API_KEY') });
    await store.setCredential('openai', 'sk-fixture-key');
    await runTask('task', { projectDir: dir }, { execute });
    expect(calls[0]!.apiKey).toBe('sk-fixture-key');
    await runTask('task', { projectDir: dir, combo: 'second' }, { execute });
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
    it('uses the combo\'s own analysis model over the project\'s', async () => {
      const own = await project(config => { analysed(config); config.connections.push(connection('local', { kind: 'llm', name: 'Local' })); config.combos[0]!.analysis = { connectionId: 'local', modelId: 'mine' }; });
      const ran = await runTask('task', { projectDir: own.dir }, { execute: player(recorded(['Enter'], 'success')).execute });
      expect(ran.warnings).toEqual([]); expect(ran.conditions).toMatchObject({ combo: { analysis: 'Local · mine' } });
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
