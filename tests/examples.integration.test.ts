import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runEnding } from '@rawstep/reports/endings';
import { runTask } from '@rawstep/project/run';
import { ProjectStore } from '@rawstep/project/store';

const browserSuite = process.env.RAWSTEP_TEST_SUITE === 'browser';

/**
 * Every example task, run as a user would run it: from a project that holds `examples/` and `fixtures/`, on the simulation, with the
 * written plan that ships next to it (no model). Each example is there to show one situation, so the ending it is documented with
 * is pinned here: an example that stops showing it is a broken example.
 */
describe.skipIf(!browserSuite)('examples run and end as their README says', () => {
  let dir = '', server: ChildProcess | undefined;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rawstep-examples-'));
    await cp(resolve('examples'), join(dir, 'examples'), { recursive: true });
    await cp(resolve('fixtures'), join(dir, 'fixtures'), { recursive: true });
    const actions = { keys: [], intents: ['next', 'previous', 'activate'], typeText: true, replaceText: true };
    await writeFile(join(dir, 'rawstep.config.json'), JSON.stringify({ version: 7, connections: [], tasks: [], machine: {},
      profiles: [{ id: 'example-plans', name: 'Example plans (no model)', actions, planner: { planFile: 'examples/plans/{task}.json' } }] }));
    await new ProjectStore(dir).read();
    // The example's own port may be taken on this machine: the copy of its task is pointed at a free one.
    const port = await new Promise<number>((found, failed) => { const probe = createServer(); probe.once('error', failed); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address() as AddressInfo; probe.close(() => found(port)); }); });
    const api = join(dir, 'examples/api/api-cart.json');
    await writeFile(api, (await readFile(api, 'utf8')).replace('127.0.0.1:4173', `127.0.0.1:${port}`));
    server = spawn(process.execPath, [join(dir, 'examples/api/server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((ready, failed) => { server!.stdout!.once('data', () => ready()); server!.once('error', failed); server!.once('exit', code => failed(new Error(`The example server exited with code ${code}.`))); });
  }, 60_000);
  afterAll(async () => { server?.removeAllListeners('exit'); server?.kill(); await rm(dir, { recursive: true, force: true }); });

  const run = async (file: string) => {
    const result = await runTask(file, { projectDir: dir, profile: 'example-plans' });
    const [only] = result.runs;
    return { ending: runEnding(only!.outcome), moves: only!.outcome?.steps, hints: only!.hints.hints.map(hint => hint.kind), runDir: only!.outDir };
  };

  it.each([
    ['examples/tasks/checkout-steps.json', 'reached'],
    ['examples/tasks/settings-dialog.json', 'reached'],
    ['examples/tasks/quiet-cart.json', 'reached'],
    ['examples/api/api-cart.json', 'reached'],
    ['examples/tasks/missing-invoice.json', 'gave-up'],
    ['examples/tasks/newsletter.json', 'gave-up'],
    ['examples/tasks/remove-item.json', 'gave-up'],
  ])('%s ends as %s', async (file, ending) => {
    expect((await run(file)).ending?.ending).toBe(ending);
  }, 120_000);

  it('the dialog example finds nothing wrong with a dialog that returns focus, and the quiet cart is reached without the user hearing it', async () => {
    const dialog = await run('examples/tasks/settings-dialog.json');
    expect(dialog.hints).not.toContain('focus-lost');
    expect(dialog.hints).not.toContain('modal-focus-outside');
    const quiet = await run('examples/tasks/quiet-cart.json');
    const trace = JSON.parse(await readFile(join(quiet.runDir, 'trace.json'), 'utf8')) as { outcome: { goalConfirmed?: boolean } };
    expect(trace.outcome.goalConfirmed).toBe(false);
  }, 120_000);

  it('uses every kind of completion rule at least once across the examples', async () => {
    const files = ['checkout-steps', 'settings-dialog', 'quiet-cart', 'missing-invoice', 'newsletter', 'remove-item', 'simple-cta', 'search'].map(name => `examples/tasks/${name}.json`).concat('examples/api/api-cart.json');
    const used = new Set<string>();
    const walk = (rule: Record<string, unknown>) => { const [key] = Object.keys(rule).filter(k => k !== 'after'); used.add(key!);
      if (key === 'not') walk(rule.not as Record<string, unknown>); if (key === 'any') for (const inner of rule.any as Record<string, unknown>[]) walk(inner); };
    for (const file of files) for (const rule of (JSON.parse(await readFile(resolve(file), 'utf8')) as { verify: { all: Record<string, unknown>[] } }).verify.all) walk(rule);
    expect([...used].sort()).toEqual(['activatedAnnouncementIncludes', 'any', 'domEventSeen', 'event', 'focused', 'not', 'requestSeen', 'responseSeen', 'script', 'textVisible', 'textVisibleExact', 'titleIncludes', 'urlIncludes']);
  });
});
