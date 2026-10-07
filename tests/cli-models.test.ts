import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { cliStatus, createCliModel, generateStructured, listCliModels, strictJsonSchema, type CliProvider } from '@rawstep/policies/llm';
import { connectionSchema } from '@rawstep/project/config';
import { discover } from '@rawstep/project/discover';
import { llmModelOf } from '@rawstep/project/llm';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), 'rawstep-cli-test-')); dirs.push(dir); return dir; };

/** How each fake CLI hands back `answer`, as the real CLI does. */
const REPLY: Record<CliProvider, string> = {
  codex: `fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(answer));`,
  grok: `process.stdout.write(JSON.stringify({ text: JSON.stringify(answer), structuredOutput: answer, stopReason: 'end_turn' }));`,
  antigravity: `process.stdout.write(JSON.stringify({ event: 'init' }) + '\\n' + JSON.stringify({ event: 'result', result: { status: 'SUCCESS', structured_output: answer } }) + '\\n');`,
};
/**
 * A stand-in for a CLI: records its arguments, working directory and input, then answers the way that CLI does (or exits 1).
 * `models` is what `<cli> models` prints. Nothing reaches a real model.
 */
async function fakeCli(provider: CliProvider, answer: unknown, options: { exitCode?: number; models?: string } = {}) {
  const dir = await temp(), log = join(dir, 'seen.json'), command = join(dir, provider);
  await writeFile(command, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), answer = ${JSON.stringify(answer)};
if (args[0] === 'models' || (args[0] === 'login' && args[1] === 'status')) { process.stdout.write(${JSON.stringify(options.models ?? '')}); process.exit(${options.exitCode ?? 0}); }
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  const at = flag => args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : undefined;
  const prompt = at('--prompt-file') ? fs.readFileSync(at('--prompt-file'), 'utf8') : input;
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), input, prompt }));
  if (${options.exitCode ?? 0} !== 0) process.exit(${options.exitCode ?? 0});
  ${REPLY[provider]}
});
`);
  await chmod(command, 0o755);
  return { command, seen: async () => JSON.parse(await readFile(log, 'utf8')) as { args: string[]; cwd: string; input: string; prompt: string } };
}
const schema = z.object({ choiceId: z.enum(['a', 'b']), note: z.string().optional() }).strict();
const call = (provider: CliProvider, command: string, extra: { modelId?: string; reasoningEffort?: 'low' } = {}) =>
  generateStructured({ model: createCliModel({ provider, modelId: extra.modelId ?? 'm1', timeoutMs: 10000, command, ...(extra.reasoningEffort ? { reasoningEffort: extra.reasoningEffort } : {}) }),
    system: 'Pick yes.', user: '{"candidates":["a","b"]}', schema });

describe('coding-agent CLIs as LLMs', () => {
  it('turns optional fields into required nullable ones, as the CLIs\' structured output demands', () => {
    const strict = strictJsonSchema(z.object({ a: z.string(), b: z.string().optional(), list: z.array(z.object({ x: z.string(), y: z.array(z.string()).optional() }).strict()) }).strict());
    expect(strict).toMatchObject({ type: 'object', required: ['a', 'b', 'list'], additionalProperties: false, properties: { b: { anyOf: [{ type: 'string' }, { type: 'null' }] } } });
    expect((strict.properties as { list: { items: unknown } }).list.items).toMatchObject({ required: ['x', 'y'], additionalProperties: false });
    expect(strict).not.toHaveProperty('$schema');
  });

  it('runs codex exec sandboxed in an empty folder without the person\'s config, prompt on stdin', async () => {
    const fake = await fakeCli('codex', { choiceId: 'b', note: null });
    expect(await call('codex', fake.command, { modelId: 'gpt-5.5', reasoningEffort: 'low' })).toEqual({ object: { choiceId: 'b' }, modelId: 'gpt-5.5' });
    const seen = await fake.seen();
    expect(seen.args).toEqual(expect.arrayContaining(['exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-m', 'gpt-5.5', '-c', 'model_reasoning_effort="low"', '--output-schema']));
    expect(seen.args.slice(seen.args.indexOf('-s'), seen.args.indexOf('-s') + 2)).toEqual(['-s', 'read-only']);
    expect(seen.cwd).toContain('rawstep-codex-');
    expect(seen.prompt).toMatch(/^Pick yes\.[\s\S]*\{"candidates":\["a","b"\]\}$/);
  });

  it('runs grok for one turn without tools, web search or subagents, prompt in a file', async () => {
    const fake = await fakeCli('grok', { choiceId: 'a' });
    expect((await call('grok', fake.command, { modelId: 'grok-4.7', reasoningEffort: 'low' })).object).toEqual({ choiceId: 'a' });
    const seen = await fake.seen();
    expect(seen.args).toEqual(expect.arrayContaining(['--prompt-file', '--json-schema', '--output-format', 'json', '--max-turns', '1', '--tools', '', '--disable-web-search', '--no-subagents', '-m', 'grok-4.7', '--reasoning-effort', 'low']));
    expect(JSON.parse(seen.args[seen.args.indexOf('--json-schema') + 1]!)).toMatchObject({ required: ['choiceId', 'note'] });
    expect(seen.input).toBe(''); expect(seen.prompt).toMatch(/^Pick yes\./);
  });

  it('runs Antigravity in print mode with a sandbox, the prompt as one stream-json user message', async () => {
    const fake = await fakeCli('antigravity', { choiceId: 'b' });
    expect((await call('antigravity', fake.command, { modelId: 'gemini-3.8-flash-medium', reasoningEffort: 'low' })).object).toEqual({ choiceId: 'b' });
    const seen = await fake.seen();
    expect(seen.args).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--output-format', 'stream-json', '--json-schema', '--sandbox', '--disable-slash-commands', '--model', 'gemini-3.8-flash-medium', '--effort', 'low', '-p=']));
    expect(JSON.parse(seen.input)).toMatchObject({ event: 'user', message: { role: 'user', content: expect.stringMatching(/^Pick yes\./) } });
  });

  it('lets the CLI pick its own model when no model ID is set', async () => {
    const fake = await fakeCli('grok', { choiceId: 'a' });
    expect((await call('grok', fake.command, { modelId: '' })).modelId).toBe('grok-default');
    expect((await fake.seen()).args).not.toContain('-m');
  });

  it('reports a failed run, a malformed answer, a missing CLI or a request with images only as the fixed LLM failure', async () => {
    for (const provider of ['codex', 'grok', 'antigravity'] as const) {
      await expect(call(provider, (await fakeCli(provider, {}, { exitCode: 1 })).command)).rejects.toMatchObject({ code: 'llm-failed' });
      await expect(call(provider, (await fakeCli(provider, { choiceId: 'z' })).command)).rejects.toMatchObject({ code: 'llm-failed' });
      await expect(call(provider, join(await temp(), 'missing'))).rejects.toMatchObject({ code: 'llm-failed' });
    }
    const fake = await fakeCli('codex', { choiceId: 'a' });
    await expect(generateStructured({ model: createCliModel({ provider: 'codex', modelId: 'm', timeoutMs: 10000, command: fake.command }), system: 's', user: 'u', schema, images: ['png'] })).rejects.toMatchObject({ code: 'llm-failed' });
  });

  it('lists each CLI\'s models and says whether it is signed in', async () => {
    const home = await temp();
    await writeFile(join(home, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' }, { slug: 'internal', visibility: 'hide' }] }));
    const previous = process.env.CODEX_HOME; process.env.CODEX_HOME = home;
    try {
      expect(await listCliModels('codex')).toEqual([{ id: 'gpt-5.5', name: 'GPT-5.5' }]);
      expect(await discover({ kind: 'llm', provider: 'codex' })).toEqual([{ modelId: 'gpt-5.5', name: 'GPT-5.5', inputs: ['text'], inputsKnown: true }]);
    } finally { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; }
    const grok = await fakeCli('grok', {}, { models: 'You are logged in with grok.com.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n  - grok-4.6\n' });
    expect(await listCliModels('grok', grok.command)).toEqual([{ id: 'grok-4.7', name: 'grok-4.7' }, { id: 'grok-4.6', name: 'grok-4.6' }]);
    const agy = await fakeCli('antigravity', {}, { models: 'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-5-5-low\tClaude Sonnet 5.5 (Low)\n' });
    expect(await listCliModels('antigravity', agy.command)).toEqual([{ id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }, { id: 'claude-sonnet-5-5-low', name: 'Claude Sonnet 5.5 (Low)' }]);
    expect(await cliStatus('grok', grok.command)).toBe('signed-in');
    expect(await cliStatus('codex', (await fakeCli('codex', {}, { exitCode: 1 })).command)).toBe('signed-out');
    expect(await cliStatus('antigravity', join(await temp(), 'missing'))).toBe('missing');
  });

  it('are LLM connections with no address or key, each taking only its own reasoning efforts', () => {
    expect(connectionSchema.parse({ id: 'codex', name: 'Codex', kind: 'llm', provider: 'codex', reasoningEffort: 'medium', timeoutMs: 180000 })).toMatchObject({ provider: 'codex', reasoningEffort: 'medium' });
    expect(connectionSchema.safeParse({ id: 'a', name: 'A', kind: 'llm', provider: 'antigravity', reasoningEffort: 'max' }).success).toBe(true);
    expect(connectionSchema.safeParse({ id: 'g', name: 'G', kind: 'llm', provider: 'grok', reasoningEffort: 'minimal' }).success).toBe(false);
    expect(connectionSchema.safeParse({ id: 'c', name: 'C', kind: 'llm', provider: 'codex', baseURL: 'https://example.test/v1' }).success).toBe(false);
    expect(connectionSchema.safeParse({ id: 'o', name: 'O', kind: 'llm', provider: 'openai', reasoningEffort: 'low' }).success).toBe(false);
    expect(connectionSchema.safeParse({ id: 'd', name: 'D', kind: 'decision', provider: 'grok' }).success).toBe(false);
    const model = llmModelOf({ id: 'agy', kind: 'llm', provider: 'antigravity', timeoutMs: 180000, reasoningEffort: 'high', name: 'Antigravity · gemini', modelId: 'gemini-3.8-flash-high', inputs: ['text'], maxChoices: 255, maxImages: 0 }, 'rawstep-planner');
    expect(model).toMatchObject({ kind: 'cli', modelId: 'gemini-3.8-flash-high', cli: { provider: 'antigravity', reasoningEffort: 'high' } });
  });
});
