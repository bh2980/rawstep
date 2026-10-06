#!/usr/bin/env node
/** Rebuild and recheck a clean source extraction without any checkout output or symlink. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './workspace.mjs';
const directory=await mkdtemp(join(tmpdir(),'rawstep-source-smoke-'));
const archive=join(directory,'rawstep-source.tar.gz'),extracted=join(directory,'source');
const run=(bin,args,cwd)=>execFileSync(bin,args,{cwd,env:process.env,stdio:'inherit'});
try{
  run('tar',['--exclude=node_modules','--exclude=dist','--exclude=.git','--exclude=artifacts','--exclude=*.tsbuildinfo','--exclude=__pycache__','--exclude=.env*','--exclude=./runs','--exclude=./coverage','--exclude=./test-results','--exclude=./playwright-report','--exclude=./.rawstep','--exclude=./examples/screenshot/.venv','--exclude=./examples/screenshot/model','--exclude=./examples/screenshot/onejev4b-assets','--exclude=./examples/screenshot/.hf-cache','--exclude=./examples/screenshot/.uv-cache','--exclude=./packages/rawstep/docs','--exclude=./packages/rawstep/examples','--exclude=./packages/rawstep/fixtures','--exclude=./packages/rawstep/README.md','--exclude=./packages/rawstep/README.ko.md','-czf',archive,'.'],root);
  await mkdir(extracted);run('tar',['-xzf',archive,'-C',extracted],directory);
  const originalLock=await readFile(join(root,'pnpm-lock.yaml'),'utf8');
  run(process.platform==='win32'?'corepack.cmd':'corepack',['pnpm','install','--frozen-lockfile','--ignore-scripts'],extracted);
  run(process.platform==='win32'?'npm.cmd':'npm',['run','check'],extracted);
  run(process.platform==='win32'?'npm.cmd':'npm',['run','test:orca-native'],extracted);
  assert.equal(await readFile(join(extracted,'pnpm-lock.yaml'),'utf8'),originalLock);
  const bytes=await readFile(archive),receipt={result:'passed',archiveBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),checks:['fresh source extraction','frozen-lockfile install','clean workspace build','all source/test typechecks','full behavior tests','single rawstep tarball isolated installation (CLI, ui, imports, TypeScript consumer)','installed protocol/cancellation/report roundtrip','native Python unit tests'],nativeScreenreaderValidated:false};
  await mkdir(join(root,'artifacts'),{recursive:true});await writeFile(join(root,'artifacts','source-verification.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
}finally{if(process.env.RAWSTEP_KEEP_SOURCE_SMOKE!=='1')await rm(directory,{recursive:true,force:true});else console.log(`Source smoke retained: ${directory}`)}
