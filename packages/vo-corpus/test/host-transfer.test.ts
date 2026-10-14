import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {tartMachine} from '../src/host.js';

test('a guest that closes its upload input rejects the transfer without an unhandled EPIPE',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vo-transfer-')),previous=process.env.PATH;
  try{
    const fake=join(dir,'tart');
    await writeFile(fake,`#!${process.execPath}\nconst args=process.argv.slice(2);if(args[0]==='ip')console.log('192.168.64.2');else if(args.includes('route'))console.log('gateway: 192.168.64.1');else process.exit(2);\n`);
    await chmod(fake,0o755);process.env.PATH=dir+':'+previous;
    const file=join(dir,'helper');await writeFile(file,Buffer.alloc(8*1024*1024));
    const machine=await tartMachine('disconnected-test-guest');
    await assert.rejects(machine.place(file),/EPIPE|premature close|Copying/);
  }finally{process.env.PATH=previous;await rm(dir,{recursive:true,force:true});}
});
