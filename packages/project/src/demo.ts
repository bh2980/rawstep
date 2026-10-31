import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { defaultConfig, defaultProfile, type Profile, type ProjectConfig, type ProviderId } from './config.js';

/** Where `rawstep init` puts the demo: a page, a task on it and a plan written for it, all in the project. */
export const DEMO_DIR = 'rawstep/demo';
const DEMO_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Demo shop</title></head>
  <body>
    <header>
      <a href="#main">Skip to main content</a>
      <nav aria-label="Main"><a href="#">Home</a> <a href="#">Cart</a></nav>
    </header>
    <main id="main">
      <h1>Demo mug</h1>
      <p>A plain white mug. 12,000 won.</p>
      <button id="add">Add to cart</button>
      <p id="status" role="status"></p>
    </main>
    <script>
      document.getElementById('add').addEventListener('click', () => { document.getElementById('status').textContent = 'Added to cart'; });
    </script>
  </body>
</html>
`;
const DEMO_TASK = { url: `${DEMO_DIR}/page.html`, goal: 'Add the Demo mug to the cart.', maxSteps: 20, verify: { all: [{ textVisible: 'Added to cart' }] } };
/** The plan a person would write for the demo page: walk to the button item by item, then press it. */
const DEMO_PLAN = {
  strategy: 'Walk the page item by item to the Add to cart button and press it.',
  criteria: [{ id: 'C1', text: 'The page says the mug was added to the cart' }],
  assumptions: [{ id: 'A1', text: 'The Add to cart button comes after the product name' }],
  phases: [{ title: 'Add to cart', criteria: ['C1'], tasks: [
    { goal: 'Move to the Add to cart button', done: 'Hear the Add to cart button', cue: { name: 'Add to cart', role: 'button' }, activates: false, moves: ['next'], relies: ['A1'] },
    { goal: 'Press Add to cart', done: 'Hear that the mug was added', cue: 'Added to cart', activates: true, serves: ['C1'] },
  ] }],
};
/** The files `rawstep init` writes besides the config, by project-relative path. */
export const DEMO_FILES: Readonly<Record<string, string>> = {
  [`${DEMO_DIR}/page.html`]: DEMO_PAGE,
  [`${DEMO_DIR}/task.json`]: JSON.stringify(DEMO_TASK, null, 2) + '\n',
  [`${DEMO_DIR}/plan.json`]: JSON.stringify(DEMO_PLAN, null, 2) + '\n',
};

/** Coding-agent CLIs Rawstep can plan with through the person's own sign-in, by the command that shows one is installed. */
const AGENT_COMMANDS: readonly [string, ProviderId][] = [['claude', 'claudeCode'], ['codex', 'codex'], ['opencode', 'opencode'], ['grok', 'grok']];
/** The first coding-agent CLI on PATH, if any, to point the person to. Being installed is not being signed in. */
export async function findAgentCli(path = process.env.PATH ?? ''): Promise<ProviderId | undefined> {
  const dirs = path.split(delimiter).filter(Boolean), names = (command: string) => process.platform === 'win32' ? [`${command}.cmd`, `${command}.exe`] : [command];
  for (const [command, provider] of AGENT_COMMANDS) {
    for (const dir of dirs) for (const name of names(command)) {
      try { await access(join(dir, name), constants.X_OK); return provider; } catch { /* not here */ }
    }
  }
  return undefined;
}

/**
 * A new project that runs at once: the demo task and a profile that follows the written demo plan (no model, no key), first so that
 * `rawstep run demo` works, then an "Item by item" profile with no planner yet. Nothing is connected for the person: a connection
 * sends what the user hears to a model provider on their account, so they add one themselves.
 */
export function demoConfig(): ProjectConfig {
  const config = defaultConfig();
  const written: Profile = { ...defaultProfile('written-plan', 'Written plan (no model)'), planner: { planFile: `${DEMO_DIR}/plan.json` } };
  return { ...config, profiles: [written, defaultProfile('item-by-item', 'Item by item')],
    tasks: [{ id: 'demo', name: 'Demo: add a mug to the cart', file: `${DEMO_DIR}/task.json` }] };
}
