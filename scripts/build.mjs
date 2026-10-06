#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { root, buildPackages } from './workspace.mjs';
import { bundleRawstep } from './bundle-rawstep.mjs';
const require = createRequire(import.meta.url);
rmSync(join(root, 'dist'), { recursive: true, force: true });
for (const pkg of buildPackages) rmSync(join(pkg.path, 'dist'), { recursive: true, force: true });
for (const pkg of buildPackages) {
  console.log(`Building ${pkg.name}`);
  // `rawstep` is the one published package: it bundles all the others instead of compiling its own sources with tsc.
  if (pkg.directory === 'rawstep') { bundleRawstep(); continue; }
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: pkg.path, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (pkg.bin) chmodSync(join(pkg.path, 'dist/cli/bin.js'), 0o755);
  if (pkg.directory === 'dashboard') {
    const server = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.server.json'], { cwd: pkg.path, stdio: 'inherit' });
    if (server.error) throw server.error;
    if (server.status !== 0) process.exit(server.status ?? 1);
    const dashboardRequire = createRequire(join(pkg.path, 'package.json'));
    const vite = join(dirname(dashboardRequire.resolve('vite/package.json')), 'bin/vite.js');
    const bundled = spawnSync(process.execPath, [vite, 'build'], { cwd: pkg.path, stdio: 'inherit' });
    if (bundled.error) throw bundled.error;
    if (bundled.status !== 0) process.exit(bundled.status ?? 1);
  }
}
