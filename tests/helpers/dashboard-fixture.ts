import { createServer } from 'node:http';
import { defaultConfig, defaultModes, defaultProfile } from '@rawstep/project/config';
export async function dashboardFixture() {
  const requests: { model: string; instructions: string; state: unknown; choices: string[]; path: string }[] = [];
  const server = createServer((req, res) => { void (async () => {
    const path = req.url ?? '/';
    res.setHeader('content-type', 'application/json');
    if (path === '/task') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="en"><title>Fixture</title><body><button onclick="document.getElementById(\'result\').hidden=false">Complete fixture</button><p id="result" hidden>Done</p></body></html>'); return; }
    if (path.endsWith('/models')) { res.end(JSON.stringify({ data: ['fixture-a', 'fixture-b'].map(id => ({ id, name: id, inputs: ['text', 'image'], maxChoices: 255 })) })); return; }
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    let state: Record<string, unknown>, choices: string[], instructions: string;
    if (path.endsWith('/systemone')) { state = body.state; choices = Object.keys(body.questions.next.criteria); instructions = body.questions.next.instructions; }
    else { const content = body.messages[1].content; const payload = JSON.parse(typeof content === 'string' ? content : content[0].text); state = payload.state; choices = payload.candidates.map((c: { id: string }) => c.id); instructions = body.messages[0].content; }
    requests.push({ model: body.model, instructions, state, choices, path });
    const history = state.history as unknown[] ?? [];
    const choiceId = choices.includes('key:Tab') && history.length === 0 ? 'key:Tab' : choices.includes('key:Enter') ? 'key:Enter' : choices.includes('intent:activate') && JSON.stringify(state.speech).includes('button') ? 'intent:activate' : choices.includes('intent:next') ? 'intent:next' : 'stop:success';
    if (path.endsWith('/systemone')) res.end(JSON.stringify({ model: body.model, answers: { next: { type: 'choice', choice: choiceId, probabilities: Object.fromEntries(choices.map(c => [c, c === choiceId ? 1 : 0])) } } }));
    else res.end(JSON.stringify({ model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ choiceId }) } }] }));
  })().catch(() => { res.statusCode = 400; res.end('{}'); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture bind failed');
  const url = 'http://127.0.0.1:' + address.port;
  const config = defaultConfig();
  // One decision server and one LLM at the fixture address. Each profile picks a model on them: comparing models means comparing profiles.
  config.connections = [
    { id: 'fixture', name: 'Fixture decision server', kind: 'decision', provider: 'custom', baseURL: url, timeoutMs: 5000 },
    { id: 'fixture-llm', name: 'Fixture LLM', kind: 'llm', provider: 'custom', baseURL: url, timeoutMs: 5000 },
  ];
  const profileOn = (id: string, connectionId: string, modelId: string) => ({ ...defaultProfile(id, id), model: { connectionId, modelId, inputs: ['text' as const, 'image' as const], maxChoices: 255, maxImages: 2 } });
  config.profiles = [profileOn('fixture-a', 'fixture', 'fixture-a'), profileOn('fixture-b', 'fixture', 'fixture-b'), profileOn('fixture-llm', 'fixture-llm', 'fixture-llm')];
  const modes = defaultModes(); modes.keyboard.prompts.push({ ...modes.keyboard.prompts[0]!, id: 'careful', name: '신중하게', version: '2', instructions: 'Fixture careful variant. Select a permitted candidate.' });
  config.tasks = [{ id: 'fixture-task', name: '버튼 활성화 fixture', file: 'task.json', modes }];
  config.machine.browserExecutablePath = process.env.RAWSTEP_TEST_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const task = { id: 'fixture-task', url: url + '/task', goal: 'Complete fixture button', mode: 'keyboard', maxSteps: 8, timeoutMs: 10000, verify: { all: [{ textVisibleExact: 'Done' }] } };
  return { url, config, task, requests, close: () => new Promise<void>((accept, reject) => server.close(e => e ? reject(e) : accept())) };
}
