import assert from "node:assert/strict";
import test from "node:test";
import {captureWarnings,firstDivergences,hintComparison} from "../src/analyze.js";
import {validateRuns} from "../src/validate.js";
import type {CaseRecord,CaseSet} from "../src/cases.js";

test("error sampling groups the first failure rather than every cascading mismatch",()=>{
  const set:CaseSet={id:'questions',generatedAt:'fixed',cases:['a','b'].map(id=>({id,page:id+'.html',chords:['Tab','VO+Right','VO+Right'],axes:{family:'focus'}}))};
  const records=(source:CaseRecord['source'],speech:string)=>new Map(set.cases.map(c=>[c.id,{caseSet:set.id,caseId:c.id,source,start:{aligned:true,speech:[]},steps:c.chords.map(chord=>({chord,reason:'quiet' as const,utterances:[{t:0,text:speech}]}))}]));
  const report=validateRuns(set,records('voiceover','Native'),records('simulator','Model'));
  assert.equal(report.verdicts.mismatch,6);
  const queue=firstDivergences(report);assert.equal(queue.length,1);assert.equal(queue[0]!.cases.length,2);
  assert.ok(queue[0]!.cases.every(c=>c.step===0));
});

test('hint analysis retains failures even when main speech matches and counts unsupported windows as failures',()=>{
  const set:CaseSet={id:'hints',generatedAt:'fixed',cases:[{id:'a',page:'a.html',chords:['VO+Right','VO+Right'],axes:{role:'button'}}]};
  const record=(source:CaseRecord['source']):CaseRecord=>({caseSet:set.id,caseId:'a',source,start:{aligned:true,speech:[]},steps:set.cases[0]!.chords.map(chord=>({chord,reason:'quiet',utterances:[{t:0,text:'Save button'}]}))});
  const a=record('voiceover'),b=record('simulator');a.steps[0]!.utterances.push({t:750,text:'You are currently on a button.'});b.steps[1]!.reason='unsupported';
  const hints=hintComparison(validateRuns(set,new Map([['a',a]]),new Map([['a',b]])));
  assert.equal(hints.matched,0);assert.equal(hints.planned,2);assert.equal(hints.nativeHintSteps,1);assert.equal(hints.firstDifferences.length,1);
});

test('native failure receipts and deadlines become review flags without changing the raw observation',()=>{
  const record:CaseRecord={caseSet:'question',caseId:'one',source:'voiceover',start:{aligned:true,speech:[]},steps:[
    {chord:'VO+Space',reason:'quiet',utterances:[{t:1,text:'Safari is not responding'}]},
    {chord:'VO+Right',reason:'deadline',axError:'read failed',utterances:[{t:2,text:'Destination'}]},
  ]};
  const original=JSON.stringify(record),warnings=captureWarnings(record);
  assert.equal(warnings.length,3);assert.equal(warnings[0]!.step,0);assert.equal(warnings[1]!.step,1);
  assert.equal(JSON.stringify(record),original);
  assert.deepEqual(captureWarnings({...record,start:{aligned:false,speech:[]},steps:[]}),[{caseId:'one',step:-1,flag:'native-start-unaligned'}]);
});
