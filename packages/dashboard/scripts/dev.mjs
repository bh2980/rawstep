import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(pkg, 'package.json'));
const project = resolve(process.env.RAWSTEP_DASHBOARD_PROJECT ?? resolve(pkg, '../..'));
// Another app may hold the usual ports; RAWSTEP_DASHBOARD_API_PORT and RAWSTEP_DASHBOARD_WEB_PORT move them.
const apiPort = process.env.RAWSTEP_DASHBOARD_API_PORT ?? '4318', webPort = process.env.RAWSTEP_DASHBOARD_WEB_PORT ?? '5173';
const server = spawn(process.execPath, [require.resolve('tsx/cli'), resolve(pkg, 'src/server/bin.ts'), '--project', project, '--port', apiPort], { cwd: pkg, stdio: 'inherit', env: { ...process.env, RAWSTEP_DASHBOARD_DEV_ORIGIN: `http://127.0.0.1:${webPort}` } });
const vite = spawn(process.execPath, [resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', webPort, '--strictPort'], { cwd: pkg, stdio: 'inherit', env: { ...process.env, RAWSTEP_DASHBOARD_API_PORT: apiPort } });
let closing = false;
const close = () => { if (!closing) { closing = true; server.kill('SIGTERM'); vite.kill('SIGTERM'); } };
process.once('SIGINT', close); process.once('SIGTERM', close);
for (const child of [server, vite]) { child.once('error', error => { console.error(error.message); process.exitCode = 1; close(); }); child.once('exit', code => { close(); if (code) process.exitCode = code; }); }
