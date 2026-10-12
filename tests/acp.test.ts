import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { AcpAgent, parseAgentJson } from '@rawstep/policies/acp';
import { chooseCandidate, createAgentModel, generateStructured } from '@rawstep/policies/llm';

const FAKE = resolve('tests/fixtures/acp/fake-agent.mjs');
const open: AcpAgent[] = [], dirs: string[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(agent => agent.close())); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
/** A fake agent with behaviour `config`; `received()` lists what it was sent. */
function fake(config: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rawstep-acp-test-')); dirs.push(dir);
  const logFile = join(dir, 'log.jsonl');
  process.env.FAKE_ACP = JSON.stringify(config); process.env.FAKE_ACP_LOG = logFile;
  const agent = new AcpAgent({ command: process.execPath, args: [FAKE] }); open.push(agent);
  const received = () => existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return { agent, received };
}

describe('ACP agent client', () => {
  it('hands over no file system or terminal and reads the agent, its image support and its models', async () => {
    const { agent, received } = fake();
    expect(await agent.start()).toEqual({ name: 'fake', version: '9', images: true, models: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }], currentModel: 'small' });
    expect(received()[0].params.clientCapabilities).toEqual({ fs: { readTextFile: false, writeTextFile: false }, terminal: false });
  });
  it('sends each prompt in a fresh session in an empty folder, picks the model, joins only the reply text and deletes the session', async () => {
    const { agent, received } = fake();
    expect(await agent.prompt({ text: 'choose', images: ['iVBORw0KGgo='], modelId: 'large' })).toBe('{"choiceId":"a"}');
    expect(await agent.prompt({ text: 'again', modelId: 'small' })).toBe('{"choiceId":"a"}');
    const log = received(), methods = log.map(m => m.method);
    const cwd = log.find(m => m.method === 'session/new').params.cwd;
    expect(cwd).toMatch(/rawstep-agent-/);
    expect(log.filter(m => m.method === 'session/new').every(m => m.params.cwd === cwd && m.params.mcpServers.length === 0)).toBe(true);
    expect(log.find(m => m.method === 'session/set_config_option').params).toEqual({ sessionId: 's2', configId: 'model', value: 'large' });
    // The current model is not set again.
    expect(methods.filter(m => m === 'session/set_config_option')).toHaveLength(1);
    expect(log.find(m => m.method === 'session/prompt').params.prompt).toEqual([{ type: 'text', text: 'choose' }, { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }]);
    expect(log.filter(m => m.method === 'session/delete').map(m => m.params.sessionId)).toEqual(['s1', 's2', 's3']);
    await agent.close();
    expect(existsSync(cwd)).toBe(false);
  });
  it('rejects every permission request and every file request', async () => {
    const { agent, received } = fake({ askPermission: true, readFile: true });
    await agent.prompt({ text: 'go' });
    expect(received().find(m => m.permissionAnswer).permissionAnswer).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
    expect(received().find(m => m.readAnswer).readAnswer).toBe('error');
  });
  it('refuses images for an agent that takes none, an unknown model, an agent error and an unfinished turn', async () => {
    await expect(fake({ images: false }).agent.prompt({ text: 'x', images: ['AAAA'] })).rejects.toMatchObject({ reason: 'no-images' });
    await expect(fake().agent.prompt({ text: 'x', modelId: 'huge' })).rejects.toMatchObject({ reason: 'unknown-model' });
    await expect(fake({ error: true }).agent.prompt({ text: 'x' })).rejects.toMatchObject({ reason: 'agent-error' });
    await expect(fake({ stopReason: 'max_tokens' }).agent.prompt({ text: 'x' })).rejects.toMatchObject({ reason: 'stopped' });
    await expect(fake({ protocolVersion: 2 }).agent.start()).rejects.toMatchObject({ reason: 'protocol' });
  });
  it('cancels the turn when the caller aborts', async () => {
    const { agent, received } = fake({ hang: true });
    const controller = new AbortController();
    const prompt = agent.prompt({ text: 'x', signal: controller.signal });
    await expect.poll(() => received().some(m => m.method === 'session/prompt')).toBe(true);
    controller.abort(new Error('stop'));
    await expect(prompt).rejects.toThrow('stop');
    await expect.poll(() => received().some(m => m.method === 'session/cancel')).toBe(true);
  });
  it('fails a waiting prompt when the agent exits, and starts again after close', async () => {
    const { agent } = fake({ exitOnPrompt: true });
    await expect(agent.prompt({ text: 'x' })).rejects.toMatchObject({ reason: 'exited' });
    await agent.close();
    process.env.FAKE_ACP = '{}';
    expect(await agent.prompt({ text: 'x' })).toBe('{"choiceId":"a"}');
  });
  it('has the session deleted before a one-shot caller closes the agent', async () => {
    const { agent, received } = fake();
    await agent.prompt({ text: 'only call' });
    await agent.close();
    expect(received().filter(m => m.method === 'session/delete').map(m => m.params.sessionId)).toEqual(['s1', 's2']);
  });
  it('gives up starting at the caller\'s deadline', async () => {
    const started = Date.now();
    await expect(fake({ hangInit: true }).agent.start(AbortSignal.timeout(200))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5000);
  });
  it('reports a command that does not exist as a start failure', async () => {
    const agent = new AcpAgent({ command: 'rawstep-no-such-agent-cli', args: [] }); open.push(agent);
    await expect(agent.start()).rejects.toMatchObject({ reason: 'start-failed' });
  });
});

describe('agent replies as model output', () => {
  it('finds the JSON object in plain, fenced or surrounded text', () => {
    expect(parseAgentJson(' {"a":1} ')).toEqual({ a: 1 });
    expect(parseAgentJson('Here:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseAgentJson('I pick {"a":3} because')).toEqual({ a: 3 });
    expect(() => parseAgentJson('no json')).toThrow();
  });
  it('chooses a candidate through an agent with the instructions in the prompt', async () => {
    const { agent, received } = fake({ reply: ['```json\n{"choiceId":"b"}\n```'] });
    const model = createAgentModel({ agent, modelId: 'default' });
    expect(await chooseCandidate({ model, system: 'Pick wisely.', state: { goal: 'g' }, candidates: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })).toEqual({ choiceId: 'b', modelId: 'default' });
    const text = received().find(m => m.method === 'session/prompt').params.prompt[0].text;
    expect(text.startsWith('Pick wisely.')).toBe(true);
    expect(text).toContain('Do not use tools');
    expect(received().some(m => m.method === 'session/set_config_option')).toBe(false);
  });
  it('maps an unknown candidate, a timeout and a cancel to the shared LLM errors', async () => {
    const choose = (agent: AcpAgent) => chooseCandidate({ model: createAgentModel({ agent, modelId: 'default' }), system: 's', state: {}, candidates: [{ id: 'a', label: 'A' }] });
    await expect(choose(fake({ reply: ['{"choiceId":"z"}'] }).agent)).rejects.toMatchObject({ code: 'llm-failed' });
    await expect(generateStructured({ model: createAgentModel({ agent: fake({ hang: true }).agent, modelId: 'default', timeoutMs: 300 }), system: 's', user: 'u', schema: z.object({}) })).rejects.toMatchObject({ code: 'llm-timeout' });
    const controller = new AbortController(), hanging = fake({ hang: true });
    const pending = generateStructured({ model: createAgentModel({ agent: hanging.agent, modelId: 'default' }), system: 's', user: 'u', schema: z.object({}), signal: controller.signal });
    await expect.poll(() => hanging.received().some(m => m.method === 'session/prompt')).toBe(true);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'llm-cancelled' });
  });
});
