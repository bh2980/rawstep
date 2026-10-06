#!/usr/bin/env node
/**
 * Build the single published package: bundle `packages/rawstep` (the only package that is published) with every internal
 * `@rawstep/*` workspace inlined, then copy the non-JS files the runtime and the package page need.
 * The workspace packages must be built first (`node scripts/build.mjs` does that).
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './workspace.mjs';

const require = createRequire(import.meta.url);
const facade = join(root, 'packages/rawstep');
const tsdown = join(dirname(require.resolve('tsdown/package.json')), 'dist/run.mjs');

export function bundleRawstep() {
  const dashboardWeb = join(root, 'packages/dashboard/dist/web');
  if (!existsSync(join(dashboardWeb, 'index.html'))) throw new Error('Build the dashboard first: packages/dashboard/dist/web is missing.');
  const result = spawnSync(process.execPath, [tsdown], { cwd: facade, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  chmodSync(join(facade, 'dist/cli/bin.js'), 0o755);
  // `rawstep ui` serves the built dashboard from the package (see defaultWebDir in the dashboard server).
  cpSync(dashboardWeb, join(facade, 'dist/dashboard-web'), { recursive: true });
  // Native helpers loaded from disk at runtime (see orcaBridgePath); unit tests stay in the workspace.
  const native = join(root, 'packages/screenreaders/native'), target = join(facade, 'native');
  rmSync(target, { recursive: true, force: true }); mkdirSync(target);
  for (const file of readdirSync(native)) if (file.endsWith('.py') && !file.startsWith('test_')) cpSync(join(native, file), join(target, file));
  // Documentation/examples are release assets, never runtime source dependencies.
  for (const asset of ['docs', 'examples', 'fixtures', 'README.md', 'README.ko.md']) {
    rmSync(join(facade, asset), { recursive: true, force: true });
    cpSync(join(root, asset), join(facade, asset), { recursive: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) bundleRawstep();
