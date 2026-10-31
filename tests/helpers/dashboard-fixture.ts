import { createServer } from 'node:http';
import { defaultConfig, defaultProfile, resolveRunRules, type Profile } from '@rawstep/project/config';
/** A task page on this computer and a project config of run profiles that read the same plan file: the fixture needs no model. */
export async function dashboardFixture() {
  const server = createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/task') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="en"><title>Fixture</title><body><button onclick="document.getElementById(\'result\').hidden=false">Complete fixture</button><p id="result" hidden>Done</p></body></html>'); return; }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture bind failed');
  const url = 'http://127.0.0.1:' + address.port;
  const config = defaultConfig();
  // Runs always plan: every profile reads the same plan file (`plan`, written next to the config) with one pressing task. The two differ in a run rule, so comparing them still means comparing profiles.
  const a: Profile = { ...defaultProfile('fixture-a', 'fixture-a'), planner: { planFile: 'plan.json' } };
  const b: Profile = { ...a, id: 'fixture-b', name: 'fixture-b', runRules: resolveRunRules(a, { noChangeLimit: 4 }) };
  config.profiles = [a, b, { ...a, id: 'fixture-a-narrow', name: 'fixture-a-narrow', page: 'narrow' }, { ...b, id: 'fixture-b-narrow', name: 'fixture-b-narrow', page: 'narrow' }];
  config.tasks = [{ id: 'fixture-task', name: '버튼 활성화 fixture', file: 'task.json' }];
  // Without a path Rawstep launches Playwright's Chromium, then the installed Chrome, so the fixture runs on any host.
  if (process.env.RAWSTEP_TEST_BROWSER_PATH) config.machine.browserExecutablePath = process.env.RAWSTEP_TEST_BROWSER_PATH;
  const task = { id: 'fixture-task', url: url + '/task', goal: 'Complete fixture button', maxSteps: 8, timeoutMs: 10000, verify: { all: [{ textVisibleExact: 'Done' }] } };
  const plan = { strategy: 'Press the button.', criteria: [{ id: 'C1', text: 'The user hears Done.' }], assumptions: [],
    phases: [{ title: 'Press', tasks: [{ goal: 'Press the Complete fixture button', done: 'The user hears "Done"', cue: { name: 'Done', role: 'text' }, activates: true, moves: ['next'], serves: ['C1'] }] }] };
  return { url, config, task, plan, close: () => new Promise<void>((accept, reject) => server.close(e => e ? reject(e) : accept())) };
}
