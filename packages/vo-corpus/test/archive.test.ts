import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveCaseInputs, verifyArchivedInputs } from "../src/archive.js";
import { casesFingerprint, type CaseSet } from "../src/cases.js";
import { saveAxSnapshot, type AxDump } from "../src/axdump.js";

test("run input archive pins original bytes, survives source edits and refuses overwrite",async()=>{
  const root=await mkdtemp(join(tmpdir(),"vo-archive-")), source=join(root,"cases"), run=join(root,"run");
  try {
    const set:CaseSet={id:"questions",generatedAt:"fixed",cases:[{id:"one",page:"pages/one.html",chords:["Tab"],axes:{}}]};
    await mkdir(join(source,"pages"),{recursive:true});
    await writeFile(join(source,"cases.json"),JSON.stringify(set));await writeFile(join(source,"pages/one.html"),'<button>Original</button>');
    const hash=await casesFingerprint(source,set);
    await writeFile(join(source,"split.json"),JSON.stringify({sources:[{caseSet:set.id,casesSha256:hash}]}));
    const result=await archiveCaseInputs(source,run,set,hash);
    await verifyArchivedInputs(run,hash);
    assert.equal(result.directory,"inputs");assert.match(result.manifestSha256,/^[a-f0-9]{64}$/);
    await writeFile(join(source,"pages/one.html"),'<button>Changed</button>');
    assert.equal(await casesFingerprint(join(run,"inputs"),set),hash);
    assert.equal(await readFile(join(run,"inputs/pages/one.html"),"utf8"),'<button>Original</button>');
    assert.deepEqual(JSON.parse(await readFile(join(run,"inputs/split.json"),"utf8")),{sources:[{caseSet:set.id,casesSha256:hash}]});
    await assert.rejects(archiveCaseInputs(source,run,set,hash),/EEXIST/);
    await assert.rejects(archiveCaseInputs(source,join(root,"changed-run"),set,hash),/changed during input archival/);
    await writeFile(join(run,"inputs/pages/one.html"),'<button>Tampered archive</button>');
    await assert.rejects(verifyArchivedInputs(run,hash),/Archived fixture bytes differ/);
    set.cases[0]!.page='../secret.html';
    await assert.rejects(archiveCaseInputs(source,join(root,"escape-run"),set,hash),/escapes case directory/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test("AX retries and start stages retain original observations and reject overwrites",async()=>{
  const root=await mkdtemp(join(tmpdir(),"vo-ax-archive-"));
  try{
    const dump={root:{AXRole:'AXWebArea'},focusedPath:null,truncated:false} as AxDump;
    const first=await saveAxSnapshot(root,'attempt-one','verified-focus',dump);
    const second=await saveAxSnapshot(root,'attempt-two','verified-focus',dump);
    assert.notEqual(first,second);
    await assert.rejects(saveAxSnapshot(root,'attempt-one','verified-focus',{...dump,truncated:true}),/EEXIST/);
    assert.equal(JSON.parse(await readFile(join(root,first),'utf8')).truncated,false);
    await assert.rejects(saveAxSnapshot(root,'../escape','snapshot',dump),/Invalid/);
  }finally{await rm(root,{recursive:true,force:true});}
});
