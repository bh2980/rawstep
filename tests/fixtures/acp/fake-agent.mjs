// A stand-in ACP agent for tests. Behaviour comes from FAKE_ACP (JSON); every message it receives is appended to FAKE_ACP_LOG.
import { appendFileSync } from 'node:fs';
const config = JSON.parse(process.env.FAKE_ACP ?? '{}');
const log = message => { if (process.env.FAKE_ACP_LOG) appendFileSync(process.env.FAKE_ACP_LOG, JSON.stringify(message) + '\n'); };
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
let nextId = 1000, sessions = 0;
const waiting = new Map();
const ask = (method, params) => new Promise(resolve => { const id = nextId++; waiting.set(id, resolve); send({ id, method, params }); });
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (line.trim()) void handle(JSON.parse(line));
  }
});
async function handle(message) {
  log(message);
  if (!message.method) { waiting.get(message.id)?.(message); waiting.delete(message.id); return; }
  const { id, method, params } = message;
  if (method === 'initialize' && config.hangInit) return;
  if (method === 'initialize') return send({ id, result: { protocolVersion: config.protocolVersion ?? 1, agentInfo: { name: 'fake', version: '9' },
    agentCapabilities: { promptCapabilities: { image: config.images !== false }, sessionCapabilities: { delete: {} } } } });
  if (method === 'session/new') return send({ id, result: { sessionId: `s${++sessions}`, configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: 'small',
    options: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }] }] } });
  if (method === 'session/set_config_option' || method === 'session/delete') return send({ id, result: {} });
  if (method === 'session/cancel') { for (const [pid, cancel] of pendingPrompts) { pendingPrompts.delete(pid); cancel(); } return; }
  if (method === 'session/prompt') {
    if (config.exitOnPrompt) process.exit(3);
    if (config.error) return send({ id, error: { code: -32603, message: 'quota exceeded' } });
    if (config.askPermission) {
      const answer = await ask('session/request_permission', { sessionId: params.sessionId, toolCall: { toolCallId: 't1', title: 'Write file' },
        options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }] });
      log({ permissionAnswer: answer.result });
    }
    if (config.readFile) { const answer = await ask('fs/read_text_file', { sessionId: params.sessionId, path: '/etc/hosts' }); log({ readAnswer: answer.error ? 'error' : 'ok' }); }
    if (config.hang) { pendingPrompts.set(id, () => send({ id, result: { stopReason: 'cancelled' } })); return; }
    for (const text of config.reply ?? ['{"choiceId":', '"a"}']) send({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
    send({ method: 'session/update', params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } } } });
    return send({ id, result: { stopReason: config.stopReason ?? 'end_turn' } });
  }
  send({ id, error: { code: -32601, message: 'unknown' } });
}
const pendingPrompts = new Map();
