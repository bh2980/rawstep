#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, buildPackages as packages } from './workspace.mjs';

/** Real package tarballs: pnpm resolves workspace protocols to versioned dependencies. */
export async function packWorkspace(destination, { build = true, environment = process.env } = {}) {
  const out = resolve(destination); await mkdir(out, { recursive: true });
  if (build) execFileSync(process.execPath, [join(root,'scripts/build.mjs')], { cwd: root, stdio: 'inherit', env: environment });
  const receipts = [];
  for (const pkg of packages) {
    const packed = JSON.parse(execFileSync(process.platform==='win32'?'corepack.cmd':'corepack', ['pnpm','pack','--json','--pack-destination',out], { cwd:pkg.path, env:{...environment,npm_config_ignore_scripts:'true'}, encoding:'utf8', stdio:['ignore','pipe','pipe'] }));
    const filename = basename(packed.filename), path = join(out, filename);
    const manifest = JSON.parse(execFileSync('tar',['-xOf',path,'package/package.json'],{encoding:'utf8'}));
    assert.equal(manifest.name,pkg.name);
    for (const [dependency,version] of Object.entries(manifest.dependencies??{})) {
      assert.doesNotMatch(version,/^(?:workspace|file|link):/);
      if (dependency.startsWith('@rawstep/')) assert.equal(version,pkg.version);
    }
    const bytes = await readFile(path);
    receipts.push({ name:pkg.name, version:pkg.version, filename, size:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'), files:packed.files, manifest });
  }
  await writeFile(join(out,'packages.json'),JSON.stringify(receipts.map(({manifest,files,...receipt})=>({...receipt,files:files.length,dependencies:manifest.dependencies})),null,2)+'\n');
  await writeFile(join(out,'SHA256SUMS'),receipts.map(r=>`${r.sha256}  ${r.filename}`).join('\n')+'\n');
  await writeFile(join(out,'INSTALL.md'),'# Local Rawstep packages\n\nNo npm publication is required. From your consumer project install all local tarballs in one command:\n\n```sh\nnpm install /absolute/path/to/artifacts/*.tgz\n```\n\nEach package has its own implementation, export map, declarations and dependency manifest. Installing only a selected package requires supplying its local workspace dependency closure as tarballs in the same command because these versions are unpublished. Native screen readers, Python/model runtimes and browser executables are separate prerequisites; imports and installation do not start or download them.\n');
  return receipts;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const packed=await packWorkspace(process.argv[2]??join(root,'artifacts'));console.log(JSON.stringify(packed.map(({name,filename,size,sha256})=>({name,filename,size,sha256})),null,2));
}
