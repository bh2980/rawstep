import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'), 'run', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, RAWSTEP_TEST_SUITE: 'browser' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
