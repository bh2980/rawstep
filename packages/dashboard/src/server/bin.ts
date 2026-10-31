#!/usr/bin/env node
import { startDashboard } from './index.js';

const args = process.argv.slice(2), options = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const token = args[i]!, [flag] = token.split('=');
  if (!['--project', '--port'].includes(flag!) || options.has(flag!)) throw new Error('Usage: dashboard [--project <directory>] [--port <port>]');
  const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[++i];
  if (!value || value.startsWith('--')) throw new Error(flag + ' needs a value.');
  options.set(flag!, value);
}
const port = options.has('--port') ? Number(options.get('--port')) : undefined;
if (port !== undefined && (!/^[0-9]+$/.test(options.get('--port')!) || !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('The port must be a whole number from 1 to 65535.');
const dashboard = await startDashboard({ projectDir: options.get('--project'), port, allowedOrigin: process.env.RAWSTEP_DASHBOARD_DEV_ORIGIN });
process.stdout.write('Rawstep dashboard: ' + dashboard.url + '\n');
const close = async () => { await dashboard.close(); process.exitCode = 0; };
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
