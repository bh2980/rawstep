import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listProjectFiles } from '../packages/dashboard/src/server/files.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('project files for path fields', () => {
  it('lists project-relative paths, skipping hidden entries, run records, dependencies and symlinks out of the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rawstep-files-')), outside = await mkdtemp(join(tmpdir(), 'rawstep-outside-')); dirs.push(root, outside);
    for (const dir of ['plans/shop-cart', 'pages/bad', '.rawstep/experiments', 'node_modules/x', '.git']) await mkdir(join(root, dir), { recursive: true });
    for (const file of ['rawstep.config.json', 'plans/shop-cart/L1.json', 'pages/bad/shop.html', '.rawstep/experiments/run.json', 'node_modules/x/index.js', '.git/HEAD', '.env.local']) await writeFile(join(root, file), '');
    await writeFile(join(outside, 'secret.json'), '');
    await symlink(outside, join(root, 'linked'));
    const listed = await listProjectFiles(root);
    expect(listed).toEqual({ root, files: ['pages/bad/shop.html', 'plans/shop-cart/L1.json', 'rawstep.config.json'], truncated: false });
  });
});
