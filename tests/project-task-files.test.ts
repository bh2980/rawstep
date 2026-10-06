import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ProjectStore } from '@rawstep/project/store';
import { defaultModes } from '@rawstep/project/config';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe('task files for editing', () => {
  it('keeps relative start URLs and omitted defaults as written, while runs still resolve them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-task-files-')); dirs.push(dir);
    const store = new ProjectStore(dir); const initial = await store.initialize();
    await writeFile(join(dir, 'shop.html'), '<title>Shop</title>');
    await mkdir(join(dir, 'tasks'), { recursive: true });
    const task = { url: 'shop.html', goal: 'Pay', verify: { all: [{ textVisible: 'Paid' }] } };
    const config = { ...initial.config, tasks: [{ id: 'pay', name: 'Pay', file: 'tasks/pay.json', modes: defaultModes() }] };
    await store.save(config, initial.revision, { file: 'tasks/pay.json', task });

    const files = await store.taskFiles((await store.read()).config);
    expect(files.pay).toEqual(task);
    expect((await store.task('tasks/pay.json')).url).toBe(pathToFileURL(join(dir, 'shop.html')).href);
    expect(JSON.parse(await readFile(join(dir, 'tasks/pay.json'), 'utf8'))).toEqual(task);
  });
});
