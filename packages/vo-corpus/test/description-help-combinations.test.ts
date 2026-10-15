import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {generateDescriptionHelpCombinations} from '../src/generate/description-help-combinations.js';

test('description/help source contrasts preserve the fixed pages and change only target attributes',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-description-help-combinations-2026-10-16.json',import.meta.url),'utf8')),generated=generateDescriptionHelpCombinations();
 const canonical=new Set<string>();assert.equal(fixture.pages.length,5);
 for(const {html,htmlSha256,...c}of fixture.pages){
  assert.equal(generated.pages[c.page.slice(6,-5)],html);assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);
  assert.deepEqual(generated.cases.find(s=>s.id===c.id),c);assert.equal(c.axes.exposure,'calibration');assert.equal(c.axes.partition,'train');
  canonical.add(html.replace(/id="first"[^>]*>/,'id="first">'));
 }
 assert.equal(canonical.size,1);
 for(const p of fixture.profiles){assert.equal(p.rows.length,15);assert.equal(p.summary.nativeObserved,15);assert.equal(p.rows.flatMap((r:any)=>r.stateTransitions).length,0);}
});

test('source-input audit retains every original prediction and distinguishes missing inputs from wording failures',async()=>{
 const audit=JSON.parse(await readFile(new URL('./description-help-input-audit.json',import.meta.url),'utf8'));
 for(const c of audit.cohorts){
  const bytes=await readFile(new URL(`../../../tests/fixtures/voiceover-evidence/native-${c.name}-2026-10-16.json`,import.meta.url)),fixture=JSON.parse(bytes.toString());
  assert.equal(createHash('sha256').update(bytes).digest('hex'),c.fixtureSha256);
  for(const p of c.profiles){const original=fixture.profiles.find((f:any)=>f.browser===p.browser);assert.deepEqual(p.originalSummary,original.summary);assert.equal(p.rows.length,original.rows.length);
   const invalid=p.rows.filter((r:any)=>!r.evaluation.eligible);
   const expected=c.name==='dialog-compositions'?(p.browser==='safari'?3:0):(p.browser==='safari'?6:2);
   assert.equal(invalid.length,expected);assert.equal(p.summary.inputMismatch,expected);
   for(const r of invalid){assert.equal(r.originalEligible,true);assert.equal(r.evaluation.mainSpeechExact,null);assert.equal(r.evaluation.fullSpeechExact,null);assert.equal(r.evaluation.inputVerification.status,'mismatch');}
   for(const r of p.rows){const source=original.rows.find((s:any)=>s.caseId===r.caseId&&s.step===r.step);assert.equal(r.sourceAxSha256,source.nativeAxSha256);assert.deepEqual(r.originalInputVerification,source.evaluation.inputVerification);}
  }
 }
});
