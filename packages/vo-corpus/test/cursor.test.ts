import assert from 'node:assert/strict';
import test from 'node:test';
import {observeVisualCursor,summarizeVisualCursor} from '../src/cursor.js';
import type {AxDump,AxNode} from '../src/axdump.js';

const sample={protocol:'visible-vo-overlay-v1',status:'observed',frame:{x:16,y:26,width:108,height:38},window:{id:11,ownerPID:99,layer:2997,x:0,y:0,width:1024,height:768}};
const node:AxNode={AXElementId:2,AXRole:'AXStaticText',AXPosition:{x:20,y:30},AXSize:{width:100,height:30}};
const snapshot=(children:AxNode[]=[node]):AxDump=>({app:'Safari',pid:1,windowTitle:'Fixture',timestamp:'',nodeCount:2,truncated:false,focusedPath:[],root:{AXElementId:1,AXRole:'AXWebArea',children},visualCursor:{before:sample,after:sample,stable:true}});
test('visual geometry is independent of keyboard focus, preserves aliases, and never chooses among different objects',()=>{
  const a=snapshot([node,node]);
  assert.equal(observeVisualCursor(a).status,'observed');
  const result=observeVisualCursor(a);assert.equal(result.status==='observed'&&result.targetStatus,'unique-geometry-candidate');assert.equal(result.candidates[0]!.paths.length,2);
  a.focusedPath=[9,9];assert.deepEqual(observeVisualCursor(a),result);
  const ambiguous=observeVisualCursor(snapshot([node,{...node,AXElementId:3}]));assert.equal(ambiguous.status==='observed'&&ambiguous.targetStatus,'ambiguous');
});
test('absent, unstable, truncated and unidentifiable observations remain unmeasured rather than passing',()=>{
  const a=snapshot();delete a.visualCursor;assert.equal(observeVisualCursor(a).status,'unmeasured');
  const b=snapshot();b.visualCursor!.stable=false;assert.equal(observeVisualCursor(b).status,'unstable');
  const c=snapshot();c.truncated=true;const r=observeVisualCursor(c);assert.equal(r.status==='observed'&&r.targetStatus,'unmeasured');
  const d=observeVisualCursor(snapshot([{...node,AXElementId:undefined}]));assert.equal(d.status==='observed'&&d.targetStatus,'unmeasured');
  const e=snapshot();e.visualCursor!.after={...sample,frame:{...sample.frame,x:NaN}};assert.equal(observeVisualCursor(e).status,'unavailable');
  const f=snapshot();delete (f.visualCursor as {before?:unknown}).before;assert.equal(observeVisualCursor(f).status,'unavailable');
  assert.equal(summarizeVisualCursor([observeVisualCursor(a),observeVisualCursor(b),r]).planned,3);
});
