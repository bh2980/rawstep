import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildPackages } from './workspace.mjs';
const require = createRequire(import.meta.url);
for (const pkg of buildPackages) {
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json', '--noEmit'], { cwd: pkg.path, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (pkg.directory === 'dashboard') {
    const server = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.server.json', '--noEmit'], { cwd: pkg.path, stdio: 'inherit' });
    if (server.error) throw server.error;
    if (server.status !== 0) process.exit(server.status ?? 1);
  }
}
