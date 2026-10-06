#!/usr/bin/env node
/** Pack the one published package: `rawstep` (the internal @rawstep/* workspaces are bundled into it and never published). */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './workspace.mjs';

export async function packRawstep(destination, { build = true, environment = process.env } = {}) {
  const out = resolve(destination); await mkdir(out, { recursive: true });
  if (build) execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit', env: environment });
  const [packed] = JSON.parse(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: join(root, 'packages/rawstep'), env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const filename = basename(packed.filename), path = join(out, filename);
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', path, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(manifest.name, 'rawstep');
  // Everything internal is bundled: the manifest may depend on third-party packages only, at pinned versions.
  assert.doesNotMatch(JSON.stringify(manifest), /@rawstep\/|workspace:/);
  for (const version of Object.values(manifest.dependencies)) assert.match(version, /^\d+\.\d+\.\d+$/);
  const bytes = await readFile(path);
  const receipt = { name: manifest.name, version: manifest.version, filename, path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), files: packed.files, unpackedSize: packed.unpackedSize, manifest };
  await writeFile(join(out, 'SHA256SUMS'), `${receipt.sha256}  ${filename}\n`);
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { name, filename, size, sha256 } = await packRawstep(process.argv[2] ?? join(root, 'artifacts'));
  console.log(JSON.stringify({ name, filename, size, sha256 }, null, 2));
  console.log('\nInstall it anywhere with: npm install ' + resolve(process.argv[2] ?? join(root, 'artifacts'), filename));
}
