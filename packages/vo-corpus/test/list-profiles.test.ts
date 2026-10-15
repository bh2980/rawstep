import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {generateListProfiles} from '../src/generate/list-profiles.js';
import {generateMeasuredListTransfer} from '../src/generate/list-profile-measured-transfer.js';
import {generateListProfileGeometry} from '../src/generate/list-profile-geometry.js';
import {fixturePageState} from '../src/state.js';
import {evaluateTaskOutcome} from '../src/task-outcomes.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('list browser contrasts and reserved dynamic tasks execute the exact focus/state histories',async()=>{
 const browser=await chromium.launch({headless:true});let actions=0,changes=0;
 try{for(const partition of ['train','test'] as const){const generated=generateListProfiles(partition);
  for(const c of generated.cases){const page=await browser.newPage();try{
   await page.setContent(generated.pages[c.page.slice(6,-5)]!);await page.locator('#before').focus();
   if(partition==='test')assert.notEqual(evaluateTaskOutcome(c.taskOutcome!,await fixturePageState(page)).status,'success');
   for(const [i,key]of c.chords.entries()){
    const before=await fixturePageState(page);await page.keyboard.press(key);const after=await fixturePageState(page);
    assert.equal(after.focusId,generated.focusTargets[c.id]![i]);assert.deepEqual(after.objectErrors??[],[]);
    if(JSON.stringify(before.controls)!==JSON.stringify(after.controls))changes++;actions++;
   }
   assert.equal(evaluateTaskOutcome(c.taskOutcome!,await fixturePageState(page)).status,'success');
  }finally{await page.close();}}
 }}finally{await browser.close();}
 assert.deepEqual({actions,changes},{actions:64,changes:2});
});

test('list profile update pages preserve the original fixed HTML, histories and outcomes',async()=>{
 for(const mode of ['calibration','geometry','transfer'] as const){
  const fixture=JSON.parse(await readFile(new URL(`../../../tests/fixtures/voiceover-evidence/${mode==='geometry'?'native-list-profile-geometry':`native-list-profiles-${mode}`}-2026-10-16.json`,import.meta.url),'utf8')),generated=mode==='calibration'?generateListProfiles('train'):mode==='geometry'?generateListProfileGeometry():generateMeasuredListTransfer();
  assert.equal(fixture.pages.length,generated.cases.length);
  assert.equal(createHash('sha256').update(JSON.stringify(fixture.plan,null,2)+'\n').digest('hex'),fixture.ready.planSha256);
  for(const {html,htmlSha256,...c}of fixture.pages){assert.equal(generated.pages[c.page.slice(6,-5)],html);assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);assert.deepEqual(generated.cases.find(s=>s.id===c.id),c);}
  for(const p of fixture.profiles){
   assert.ok(Date.parse(fixture.ready.readyAt)<Date.parse(p.nativeStartedAt));
   for(const c of generated.cases)assert.deepEqual(p.rows.filter((r:any)=>r.caseId===c.id).map((r:any)=>r.chord),c.chords);
  }
 }
});


test('post-inspection audit preserves first predictions, unmeasured layout windows and all acquisition attempts',async()=>{
 const bytes=await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-list-profiles-transfer-2026-10-16.json',import.meta.url)),fixture=JSON.parse(bytes.toString()),audit=JSON.parse(await readFile(new URL('./list-profiles-transfer-input-audit.json',import.meta.url),'utf8'));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),audit.sourceFixtureSha256);
 for(const p of audit.profiles){
  const first=fixture.profiles.find((f:any)=>f.browser===p.browser);assert.deepEqual(p.originalSummary,first.summary);
  assert.deepEqual({planned:p.auditedSummary.planned,observed:p.auditedSummary.nativeObserved,eligible:p.auditedSummary.eligible,main:p.auditedSummary.mainSpeechExact.matched,full:p.auditedSummary.fullSpeechExact.matched},{planned:28,observed:28,eligible:24,main:24,full:24});
  assert.equal(p.rows.filter((r:any)=>r.evaluation.inputVerification.status==='unmeasured').length,2);
  assert.equal(p.rows.filter((r:any)=>r.evaluation.issues.includes('previous-context-unverified')).length,2);
  assert.equal(p.geometry.length,2);
  for(const g of p.geometry){
   assert.equal(g.controlAfter.position.y-g.controlBefore.position.y,g.deltaY);assert.equal(g.deltaY,46);
   assert.equal(g.outline.y,g.controlBefore.position.y-4);assert.notEqual(g.outline.y,g.controlAfter.position.y-4);assert.equal(g.status,'unmeasured');
   const original=first.rows.find((r:any)=>r.caseId===g.caseId&&r.step===g.step);assert.equal(original.readingTarget.status,'unmeasured');assert.equal(original.evaluation.eligible,false);
  }
 }
 const acquisition=JSON.parse(await readFile(new URL('./list-profiles-acquisition-audit.json',import.meta.url),'utf8'));
 assert.equal(acquisition.attempts.length,7);assert.deepEqual(acquisition.totals,{plannedActions:200,caseRecordActions:188,journalWindows:191});
 const interrupted=acquisition.attempts.filter((a:any)=>a.status==='interrupted-environment-failure');assert.equal(interrupted.length,1);assert.equal(interrupted[0].plannedActions,36);assert.equal(interrupted[0].caseRecordActions,24);assert.equal(interrupted[0].journalWindows,27);
 for(const key of ['plannedActions','caseRecordActions','journalWindows'])assert.equal(acquisition.totals[key],acquisition.attempts.reduce((n:number,a:any)=>n+a[key],0));
 assert.equal(acquisition.safariTabRestoration.ui.value,0);assert.equal(acquisition.safariTabRestoration.keyAfter.status,'absent');
});
