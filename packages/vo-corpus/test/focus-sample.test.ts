import assert from 'node:assert/strict';
import test from 'node:test';
import {sampleFocusTargets} from '../src/focus-sample.js';
import type {AxDump} from '../src/axdump.js';
test('Native target sampling fixes role slots and keeps missing/ambiguous samples without using speech or focus',()=>{
 const node=(id:number,role:string,name:string,enabled=true)=>({AXElementId:id,AXRole:role,AXTitle:name,AXEnabled:enabled});
 const dump={truncated:false,root:{children:[node(1,'AXButton','One'),node(1,'AXButton','One'),node(2,'AXLink','Article'),node(3,'AXButton','Duplicate'),node(4,'AXButton','Duplicate'),node(5,'AXButton','Disabled',false)]}} as AxDump;
 const result=sampleFocusTargets(dump,'fixed');assert.deepEqual(result.slots.map(s=>s.status),['selected','selected','unavailable','unavailable']);assert.equal(result.ambiguousNames,1);
 assert.equal(result.slots[0]!.target?.name,'One');assert.equal(result.slots[1]!.target?.name,'Article');
 dump.focusedPath=[99];assert.deepEqual(sampleFocusTargets(dump,'fixed'),result);
 assert.throws(()=>sampleFocusTargets({...dump,truncated:true},'fixed'),/complete/);
 assert.throws(()=>sampleFocusTargets(dump,''),/seed/);
});
