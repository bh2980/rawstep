import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ProjectStore } from '@rawstep/project/store';
import { defaultActionSet } from '@rawstep/project/config';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe('task files for editing', () => {
  it('keeps relative start URLs and omitted defaults as written, while runs still resolve them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-task-files-')); dirs.push(dir);
    const store = new ProjectStore(dir); const initial = await store.initialize();
    await writeFile(join(dir, 'shop.html'), '<title>Shop</title>');
    await mkdir(join(dir, 'tasks'), { recursive: true });
    const task = { url: 'shop.html', goal: 'Pay', verify: { all: [{ textVisible: 'Paid' }] } };
    const config = { ...initial.config, tasks: [{ id: 'pay', name: 'Pay', file: 'tasks/pay.json' }] };
    await store.save(config, initial.revision, { file: 'tasks/pay.json', task });

    const files = await store.taskFiles((await store.read()).config);
    expect(files.pay).toEqual(task);
    expect((await store.task('tasks/pay.json')).url).toBe(pathToFileURL(join(dir, 'shop.html')).href);
    expect(JSON.parse(await readFile(join(dir, 'tasks/pay.json'), 'utf8'))).toEqual(task);
  });

  it('keeps a task\'s condition choices, run rules and task-only copy in the config next to its file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-task-conditions-')); dirs.push(dir);
    const store = new ProjectStore(dir), initial = await store.initialize();
    const task = { url: 'https://example.com', goal: 'Pay', verify: { all: [{ textVisible: 'Paid' }] } };
    const config = { ...initial.config,
      actionSets: [...initial.config.actionSets, { ...defaultActionSet('pay-keys', 'Pay keys'), owner: 'pay', copiedFrom: 'basic' }],
      presets: [{ id: 'strict', name: 'Strict', runRules: { maxReplans: 1 } }],
      tasks: [{ id: 'pay', name: 'Pay', file: 'tasks/pay.json', presetId: 'strict', actionSetId: 'pay-keys', runRules: { failureLimit: 5 } }] };
    await store.save(config, initial.revision, { file: 'tasks/pay.json', task });
    const saved = (await store.read()).config;
    expect(saved.tasks[0]).toMatchObject({ presetId: 'strict', actionSetId: 'pay-keys' });
    expect(saved.actionSets.find(s => s.id === 'pay-keys')).toMatchObject({ owner: 'pay', copiedFrom: 'basic' });
    // The task file holds only the task: conditions never leak into it.
    expect(JSON.parse(await readFile(join(dir, 'tasks/pay.json'), 'utf8'))).toEqual(task);
    // Deleting the task deletes its own copies with it; shared items stay.
    await store.deleteTask('pay', (await store.read()).revision);
    const after = (await store.read()).config;
    expect(after.actionSets.map(s => s.id)).toEqual(initial.config.actionSets.map(s => s.id));
    expect(after.presets.map(p => p.id)).toEqual(['strict']);
  });

  it('finds unregistered task files in the project and skips dependencies and non-task JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-find-tasks-')); dirs.push(dir);
    const store = new ProjectStore(dir); await store.initialize();
    const task = (goal: string) => JSON.stringify({ url: 'https://example.com', goal, verify: { all: [{ textVisible: 'Done' }] } });
    await mkdir(join(dir, 'tests/a11y'), { recursive: true }); await mkdir(join(dir, 'node_modules/pkg'), { recursive: true });
    await writeFile(join(dir, 'tests/a11y/checkout.json'), task('Pay'));
    await writeFile(join(dir, 'node_modules/pkg/task.json'), task('Hidden'));
    await writeFile(join(dir, 'package.json'), '{"name":"x"}');
    await writeFile(join(dir, 'settings.json'), '{"theme":"dark"}');
    const found = await store.findTaskFiles((await store.read()).config);
    expect(found).toEqual([{ file: 'tests/a11y/checkout.json', goal: 'Pay', url: 'https://example.com' }]);
  });
});
