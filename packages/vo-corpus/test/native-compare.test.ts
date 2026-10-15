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
