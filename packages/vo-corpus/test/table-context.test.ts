import assert from 'node:assert/strict';import test from 'node:test';import {nativeCellContext} from '../src/table-context.js';import {readFile} from 'node:fs/promises';import {nativeSpeechInput} from '../src/speech-input.js';import {createHash} from 'node:crypto';import type {AxDump,AxNode} from '../src/axdump.js';
function fixture(){const header:AxNode={AXRole:'AXCell',AXElementId:3,children:[{AXRole:'AXStaticText',AXValue:'Reminder'}]},cell:AxNode={AXRole:'AXCell',AXElementId:4,AXRowIndexRange:{location:1,length:1},AXColumnIndexRange:{location:0,length:1},AXColumnHeaderUIElements:{status:'observed',count:1,elementIds:[3]}};const table:AxNode={AXRole:'AXTable',AXElementId:2,children:[{AXRole:'AXRow',AXElementId:5,children:[header]},{AXRole:'AXRow',AXElementId:6,children:[cell]},{AXRole:'AXColumn',AXElementId:7,children:[header,cell]}]},dump={truncated:false,root:{AXRole:'AXWebArea',children:[table]}} as AxDump;return {dump,table,cell,header};}
test('Native cell coordinates/spans and header references are independent of model text, focus and alias paths',()=>{
 const {dump,table,cell,header}=fixture();const result=nativeCellContext(dump,[dump.root,table,cell]);assert.equal(result.status,'observed');if(result.status!=='observed')return;
 assert.deepEqual(result.cell,{row:1,column:0,rows:2,columns:1,header:'Reminder',rowSpan:1,columnSpan:1});
 dump.focusedPath=[99];assert.deepEqual(nativeCellContext(dump,[dump.root,table,cell]),result);
 header.children![0]!.AXValue='Changed source';const changed=nativeCellContext(dump,[table,cell]);assert.equal(changed.status,'observed');if(changed.status==='observed')assert.equal(changed.cell.header,'Changed source');
});
test('missing/invalid ranges, dimensions, reference quality and alias conflicts stay unmeasured',()=>{
 for(const mutate of [
  (f:ReturnType<typeof fixture>)=>delete f.cell.AXRowIndexRange,
  (f:ReturnType<typeof fixture>)=>f.cell.AXColumnIndexRange={location:1,length:1},
  (f:ReturnType<typeof fixture>)=>f.cell.AXRowIndexRange={location:1,length:0},
  (f:ReturnType<typeof fixture>)=>f.table.childrenTruncated=1,
  (f:ReturnType<typeof fixture>)=>f.cell.AXColumnHeaderUIElements={status:'no-value'},
  (f:ReturnType<typeof fixture>)=>f.cell.AXColumnHeaderUIElements={status:'observed',count:2,elementIds:[3,3]},
  (f:ReturnType<typeof fixture>)=>f.cell.AXColumnHeaderUIElements={status:'observed',count:1,elementIds:[99]},
  (f:ReturnType<typeof fixture>)=>f.header.childrenTruncated=1,
  (f:ReturnType<typeof fixture>)=>f.dump.root.children!.push({...f.header,children:[{AXRole:'AXStaticText',AXValue:'Conflicting source'}]}),
 ]){const f=fixture();mutate(f);assert.equal(nativeCellContext(f.dump,[f.table,f.cell]).status,'unmeasured');}
 const f=fixture();assert.equal(nativeCellContext(f.dump,[f.table,f.table,f.cell]).status,'unmeasured');assert.equal(nativeCellContext(f.dump,[]).status,'not-applicable');
});


test('real Safari/Chrome AX ranges and references construct cell inputs without speech or author-provided coordinates',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-table-ax-metadata-2026-10-16.json',import.meta.url),'utf8'));
 for(const p of fixture.profiles){
  assert.equal(createHash('sha256').update(JSON.stringify(p.dump,null,2)+'\n').digest('hex'),p.sourceAxSha256);
  const object=nativeSpeechInput(p.dump,p.targetPath,'next_item'),focus=nativeSpeechInput(p.dump,p.targetPath,'next_focusable_item');assert.equal(object.status,'constructed');assert.equal(focus.status,'constructed');
  if(object.status!=='constructed'||focus.status!=='constructed')throw new Error('Native metadata input missing');
  assert.deepEqual(object.input,p.constructedObject);assert.deepEqual(focus.input,p.constructedFocus);assert.equal(focus.input.target.cell,undefined);assert.equal(focus.input.target.hintInCell,true);
 }
});
