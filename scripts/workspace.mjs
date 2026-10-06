import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const order = ['core', 'policies', 'browser', 'screenreaders', 'reports', 'project', 'cli', 'rawstep'];
export const packages = order.map(directory => ({ directory, path: resolve(root, 'packages', directory), ...JSON.parse(readFileSync(resolve(root, 'packages', directory, 'package.json'), 'utf8')) }));
export const dashboard = { directory: 'dashboard', path: resolve(root, 'packages/dashboard'), ...JSON.parse(readFileSync(resolve(root, 'packages/dashboard/package.json'), 'utf8')) };
// Build order. The dashboard is built after the project package it imports; `rawstep` (the only published package) is bundled last, inlining all the others.
export const buildPackages = [...packages.slice(0, 6), dashboard, ...packages.slice(6)];
