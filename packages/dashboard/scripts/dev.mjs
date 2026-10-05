import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(pkg, 'package.json'));
const project = resolve(process.env.RAWSTEP_DASHBOARD_PROJECT ?? resolve(pkg, '../..'));
const server = spawn(process.execPath, [require.resolve('tsx/cli'), resolve(pkg, 'src/server/bin.ts'), '--project', project], { cwd: pkg, stdio: 'inherit', env: { ...process.env, RAWSTEP_DASHBOARD_DEV_ORIGIN: 'http://127.0.0.1:5173' } });
const vite = spawn(process.execPath, [resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: pkg, stdio: 'inherit' });
let closing = false;
const close = () => { if (!closing) { closing = true; server.kill('SIGTERM'); vite.kill('SIGTERM'); } };
process.once('SIGINT', close); process.once('SIGTERM', close);
for (const child of [server, vite]) { child.once('error', error => { console.error(error.message); process.exitCode = 1; close(); }); child.once('exit', code => { close(); if (code) process.exitCode = code; }); }
