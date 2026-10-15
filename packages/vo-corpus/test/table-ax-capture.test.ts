import assert from 'node:assert/strict';import test from 'node:test';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
test('table-capable Native dumper compiles and rejects invalid budgets before accessing any application',{skip:process.platform!=='darwin'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vo-table-capture-'));
 try{
  const source=(await Promise.all(['cursor-overlay.swift','custom-content.swift','axdump.swift'].map(f=>readFile(new URL('../axdump/'+f,import.meta.url),'utf8')))).join('\n');
  await writeFile(join(dir,'main.swift'),source);await exec('swiftc',['-O',join(dir,'main.swift'),'-o',join(dir,'axdump')]);
  for(const args of [['--max-nodes','0'],['--max-nodes','-1'],['--max-depth','-1']])await assert.rejects(exec(join(dir,'axdump'),['--app','Safari',...args]),(e:any)=>e.code===1&&e.stderr.includes('--max-nodes must be positive and --max-depth nonnegative'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
