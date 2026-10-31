import { createServer } from 'node:http';
import { defaultConfig, type Profile } from '@rawstep/project/config';
import { profileWith } from './project-config.js';
export async function dashboardFixture() {
  const requests: { model: string; instructions: string; state: unknown; choices: string[]; path: string }[] = [];
  const server = createServer((req, res) => { void (async () => {
    const path = req.url ?? '/';
    res.setHeader('content-type', 'application/json');
    if (path === '/task') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="en"><title>Fixture</title><body><button onclick="document.getElementById(\'result\').hidden=false">Complete fixture</button><p id="result" hidden>Done</p></body></html>'); return; }
    if (path.endsWith('/models')) { res.end(JSON.stringify({ data: ['fixture-a', 'fixture-b'].map(id => ({ id, name: id, maxChoices: 255 })) })); return; }
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
  // One decision server and one LLM at the fixture address. Each run profile picks a model on them: comparing models means comparing profiles.
  // Runs always plan: every profile reads the same plan file (`plan`, written next to the config) with one pressing task.
  config.connections = [
    { id: 'fixture', name: 'Fixture decision server', kind: 'decision', provider: 'custom', baseURL: url, timeoutMs: 5000 },
    { id: 'fixture-llm', name: 'Fixture LLM', kind: 'llm', provider: 'custom', baseURL: url, timeoutMs: 5000 },
  ];
  const careful = 'Fixture careful variant. Select a permitted candidate.', baseline = 'Fixture baseline. Select a permitted candidate.';
  const profileOn = (id: string, connectionId: string, modelId: string, instructions = baseline): Profile => {
    const profile = profileWith(id, connectionId, modelId, id);
    return { ...profile, planner: { planFile: 'plan.json' }, executor: { ...profile.executor!, instructions } };
  };
  const a = profileOn('fixture-a', 'fixture', 'fixture-a'), b = profileOn('fixture-b', 'fixture', 'fixture-b', careful);
  config.profiles = [a, b, profileOn('fixture-llm', 'fixture-llm', 'fixture-llm'), { ...a, id: 'fixture-a-narrow', name: 'fixture-a-narrow', page: 'narrow' }, { ...b, id: 'fixture-b-narrow', name: 'fixture-b-narrow', page: 'narrow' }];
  config.tasks = [{ id: 'fixture-task', name: '버튼 활성화 fixture', file: 'task.json' }];
  // Without a path Rawstep launches Playwright's Chromium, then the installed Chrome, so the fixture runs on any host.
  if (process.env.RAWSTEP_TEST_BROWSER_PATH) config.machine.browserExecutablePath = process.env.RAWSTEP_TEST_BROWSER_PATH;
  const task = { id: 'fixture-task', url: url + '/task', goal: 'Complete fixture button', maxSteps: 8, timeoutMs: 10000, verify: { all: [{ textVisibleExact: 'Done' }] } };
  const plan = { strategy: 'Press the button.', criteria: [{ id: 'C1', text: 'The user hears Done.' }], assumptions: [],
    phases: [{ title: 'Press', tasks: [{ goal: 'Press the Complete fixture button', done: 'The user hears "Done"', cue: { name: 'Done', role: 'text' }, activates: true, moves: ['next'], serves: ['C1'] }] }] };
  return { url, config, task, plan, requests, close: () => new Promise<void>((accept, reject) => server.close(e => e ? reject(e) : accept())) };
}
