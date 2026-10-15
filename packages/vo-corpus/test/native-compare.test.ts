import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeBehavior,nativeSpeechComparison} from '../src/native-compare.js';
import type {AxDump} from '../src/axdump.js';
import type {CaseRecord,CaseSet} from '../src/cases.js';

test('native control/focus comparison ignores browser wrapper paths and excludes secure values',()=>{
  const control={AXRole:'AXCheckBox',AXTitle:'Notices',AXDOMIdentifier:'notice',AXValue:1,AXEnabled:true};
  const secure={AXRole:'AXTextField',AXSubrole:'AXSecureTextField',AXTitle:'Password',AXDOMIdentifier:'password',AXValue:'secret'};
  const a={truncated:false,focusedPath:[0],root:{children:[control,secure]}} as AxDump;
  const b={truncated:false,focusedPath:[0,0],root:{children:[{AXRole:'AXGroup',children:[{...control,AXTitle:'',AXDescription:'Notices'},secure]}]}} as AxDump;
  assert.deepEqual(nativeBehavior(a),nativeBehavior(b));
  assert.ok(!JSON.stringify(nativeBehavior(a)).includes('secret'));
  assert.equal(nativeBehavior({...a,truncated:true}),undefined);
});

test('native browser comparison retains missing actions and forbids simulator sources',()=>{
  const set:CaseSet={id:'pair',generatedAt:'fixed',cases:[{id:'one',page:'one.html',chords:['VO+Right','VO+Right'],axes:{family:'labels'}}]};
  const a:CaseRecord={caseSet:set.id,caseId:'one',source:'voiceover',start:{aligned:true,speech:[]},steps:[{chord:'VO+Right',reason:'quiet',utterances:[{t:1,text:'Travel updates'}]},{chord:'VO+Right',reason:'quiet',utterances:[{t:2,text:'After marker button'}]}]};
  const b={...a,steps:a.steps.slice(0,1)},left=new Map([['one',a]]),right=new Map([['one',b]]);
  const report=nativeSpeechComparison(set,left,right);
  assert.equal(report.allMain.planned,2);assert.equal(report.allMain.matched,1);assert.equal(report.verdicts.missing,1);
  assert.throws(()=>nativeSpeechComparison(set,left,new Map([['one',{...b,source:'simulator'}]])),/native VoiceOver/);
});


test('native browser state comparison removes proven aliases and marks genuine same-name objects ambiguous',()=>{
  const object={AXRole:'AXCheckBox',AXTitle:'Notices',AXValue:1,AXElementId:3};
  const alias={truncated:false,focusedPath:[0],root:{children:[object,{...object}]}} as AxDump;
  const result=nativeBehavior(alias)!;
  assert.equal(Object.keys(result.controls).length,1);
  assert.equal(result.focusComparable,true);
  assert.equal(result.ambiguousIdentities.length,0);
  alias.root.children![1]!.children=[{AXRole:'AXTextField',AXTitle:'Note',AXValue:'Dock',AXElementId:5}];
  assert.equal(Object.keys(nativeBehavior(alias)!.controls).length,2);
  delete alias.root.children![1]!.children;
  alias.root.children![1]!.AXElementId=4;
  const ambiguous=nativeBehavior(alias)!;
  assert.equal(ambiguous.focusComparable,false);
  assert.equal(ambiguous.ambiguousIdentities.length,1);
});
