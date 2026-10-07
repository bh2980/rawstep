import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createCodexModel, generateStructured, listCodexModels, strictJsonSchema } from '@rawstep/policies/llm';
import { connectionSchema } from '@rawstep/project/config';
import { discover } from '@rawstep/project/discover';
import { llmModelOf } from '@rawstep/project/llm';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const temp = async () => { const dir = await mkdtemp(join(tmpdir(), 'rawstep-codex-test-')); dirs.push(dir); return dir; };

/**
 * A stand-in for `codex`: records its arguments, working directory and prompt, then writes `answer` to the -o file (or exits 1).
 * Nothing reaches a real model.
 */
async function fakeCodex(answer: unknown, exitCode = 0): Promise<{ command: string; seen: () => Promise<{ args: string[]; cwd: string; prompt: string; schema: Record<string, unknown> }> }> {
  const dir = await temp(), log = join(dir, 'seen.json'), command = join(dir, 'codex');
  await writeFile(command, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let prompt = '';
process.stdin.on('data', d => prompt += d);
process.stdin.on('end', () => {
  const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), prompt, schema }));
  if (${exitCode} !== 0) process.exit(${exitCode});
  fs.writeFileSync(args[args.indexOf('-o') + 1], ${JSON.stringify(JSON.stringify(answer))});
});
`);
  await chmod(command, 0o755);
  return { command, seen: async () => JSON.parse(await readFile(log, 'utf8')) };
}

describe('Codex CLI as an LLM', () => {
  it('turns optional fields into required nullable ones, as Codex structured output demands', () => {
    const schema = strictJsonSchema(z.object({ a: z.string(), b: z.string().optional(), list: z.array(z.object({ x: z.string(), y: z.array(z.string()).optional() }).strict()) }).strict());
    expect(schema).toMatchObject({ type: 'object', required: ['a', 'b', 'list'], additionalProperties: false, properties: { b: { anyOf: [{ type: 'string' }, { type: 'null' }] } } });
    expect((schema.properties as { list: { items: unknown } }).list.items).toMatchObject({ required: ['x', 'y'], additionalProperties: false });
    expect(schema).not.toHaveProperty('$schema');
  });

  it('runs codex exec sandboxed in an empty folder without the person\'s config, and validates the answer without its nulls', async () => {
    const fake = await fakeCodex({ choiceId: 'b', note: null });
    const model = createCodexModel({ modelId: 'gpt-5.5', reasoningEffort: 'low', timeoutMs: 10000, command: fake.command });
    const { object, modelId } = await generateStructured({ model, system: 'Pick yes.', user: '{"candidates":["a","b"]}', schema: z.object({ choiceId: z.enum(['a', 'b']), note: z.string().optional() }).strict() });
    expect(object).toEqual({ choiceId: 'b' }); expect(modelId).toBe('gpt-5.5');
    const seen = await fake.seen();
    expect(seen.args).toEqual(expect.arrayContaining(['exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-m', 'gpt-5.5', '-c', 'model_reasoning_effort="low"']));
    expect(seen.args.slice(seen.args.indexOf('-s'), seen.args.indexOf('-s') + 2)).toEqual(['-s', 'read-only']);
    expect(seen.cwd).toContain('rawstep-codex-');
    expect(seen.prompt).toMatch(/^Pick yes\.[\s\S]*\{"candidates":\["a","b"\]\}$/);
    expect(seen.schema).toMatchObject({ required: ['choiceId', 'note'] });
  });

  it('lets Codex pick its own model when no model ID is set', async () => {
    const fake = await fakeCodex({ ok: true });
    await generateStructured({ model: createCodexModel({ modelId: '', timeoutMs: 10000, command: fake.command }), system: 's', user: 'u', schema: z.object({ ok: z.boolean() }) });
    expect((await fake.seen()).args).not.toContain('-m');
  });

  it('reports a failed run, a malformed answer or a request with images only as the fixed LLM failure', async () => {
    const failing = await fakeCodex({}, 1), wrong = await fakeCodex({ choiceId: 'z' });
    const schema = z.object({ choiceId: z.enum(['a', 'b']) });
    for (const command of [failing.command, wrong.command, join(await temp(), 'missing-codex')])
      await expect(generateStructured({ model: createCodexModel({ modelId: 'm', timeoutMs: 10000, command }), system: 's', user: 'u', schema })).rejects.toMatchObject({ code: 'llm-failed' });
    await expect(generateStructured({ model: createCodexModel({ modelId: 'm', timeoutMs: 10000, command: wrong.command }), system: 's', user: 'u', schema, images: ['png'] })).rejects.toMatchObject({ code: 'llm-failed' });
  });

  it('lists the models Codex cached for this sign-in, without hidden ones', async () => {
    const home = await temp();
    await writeFile(join(home, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' }, { slug: 'internal', visibility: 'hide' }] }));
    expect(await listCodexModels(home)).toEqual([{ id: 'gpt-5.5', name: 'GPT-5.5' }]);
    expect(await listCodexModels(await temp())).toEqual([]);
    const previous = process.env.CODEX_HOME; process.env.CODEX_HOME = home;
    try { expect(await discover({ kind: 'llm', provider: 'codex' })).toEqual([{ modelId: 'gpt-5.5', name: 'GPT-5.5', inputs: ['text'], inputsKnown: true }]); }
    finally { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; }
  });

  it('is an LLM connection with no address or key, and only it takes a reasoning effort', () => {
    expect(connectionSchema.parse({ id: 'codex', name: 'Codex', kind: 'llm', provider: 'codex', reasoningEffort: 'medium', timeoutMs: 180000 })).toMatchObject({ provider: 'codex', reasoningEffort: 'medium' });
    expect(connectionSchema.safeParse({ id: 'c', name: 'C', kind: 'llm', provider: 'codex', baseURL: 'https://example.test/v1' }).success).toBe(false);
    expect(connectionSchema.safeParse({ id: 'o', name: 'O', kind: 'llm', provider: 'openai', reasoningEffort: 'low' }).success).toBe(false);
    expect(connectionSchema.safeParse({ id: 'd', name: 'D', kind: 'decision', provider: 'codex' }).success).toBe(false);
    const model = llmModelOf({ id: 'codex', kind: 'llm', provider: 'codex', timeoutMs: 180000, reasoningEffort: 'high', name: 'Codex · gpt-5.5', modelId: 'gpt-5.5', inputs: ['text'], maxChoices: 255, maxImages: 0 }, 'rawstep-planner');
    expect(model).toMatchObject({ kind: 'codex', modelId: 'gpt-5.5', timeoutMs: 180000, codex: { reasoningEffort: 'high' } });
  });
});
