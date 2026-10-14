import assert from "node:assert/strict";
import test from "node:test";
import {firstDivergences} from "../src/analyze.js";
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
