import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('native visual observer rejects blank, solid and multiple frames without using focus or speech',{skip:process.platform!=='darwin'},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vo-cursor-overlay-test-')),exec=promisify(execFile);
  try{
    const source=(await Promise.all(['cursor-overlay.swift','cursor-overlay.test.swift'].map(f=>readFile(new URL('../axdump/'+f,import.meta.url),'utf8')))).join('\n');
    const swift=join(dir,'overlay.swift'),binary=join(dir,'overlay');await writeFile(swift,source);
    await exec('swiftc',['-O',swift,'-o',binary]);
    assert.match((await exec(binary)).stdout,/cursor outline cases passed/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
