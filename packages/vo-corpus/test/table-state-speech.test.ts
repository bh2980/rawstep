import assert from 'node:assert/strict';import test from 'node:test';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {generateTableStateSpeech} from '../src/generate/table-state-speech.js';

test('table state calibration preserves reserved source bytes, commands and independently observed value transitions',async()=>{
 const f=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-table-state-calibration-2026-10-16.json',import.meta.url),'utf8')),g=generateTableStateSpeech('train');assert.equal(g.cases.length,3);
 for(const page of f.pages){assert.equal(g.pages[page.page.slice(6,-5)],page.html);assert.equal(createHash('sha256').update(page.html).digest('hex'),page.htmlSha256);const {html,htmlSha256,...c}=page;assert.deepEqual(g.cases.find(s=>s.id===c.id),c);}
 for(const p of f.profiles){
  assert.ok(Date.parse(f.ready.readyAt)<Date.parse(p.nativeStartedAt));assert.equal(p.summary.planned,24);assert.equal(p.summary.eligible,24);assert.equal(p.summary.mainSpeechExact.matched,p.browser==='safari'?20:22);assert.equal(p.summary.tasks.planned,0);assert.equal(p.summary.fixtureHealth.passed,3);
  let changes=0;
  for(const r of p.rows){assert.equal(r.evaluation.inputVerification.status,'verified');assert.equal(r.readingTarget.status,'matched');
   if(r.verificationInput.checkedStateChanged){const prior=p.rows.find((s:any)=>s.caseId===r.caseId&&s.step===r.step-1);assert.equal(prior.readingTarget.native.id,r.rendererDOMId);assert.equal(prior.nativeAxSha256,r.beforeAxSha256);const transition=r.stateTransitions.find((s:any)=>s.key==='checked');assert.equal(transition.status,'matched');assert.notEqual(transition.native[0],transition.native[1]);changes++;}
  }assert.equal(changes,6);
 }
});

test('reserved table/form tasks keep first predictions and all speech/target/state/task denominators',async()=>{
 const f=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-table-state-transfer-2026-10-16.json',import.meta.url),'utf8')),g=generateTableStateSpeech('test');assert.equal(g.cases.length,2);assert.deepEqual(f.plan.collisions,[]);
 assert.equal(createHash('sha256').update(JSON.stringify(f.plan,null,2)+'\n').digest('hex'),f.ready.planSha256);
 const reservation=f.plan.reservation;assert.ok(Date.parse(reservation.reservedAt)<Date.parse(f.ready.readyAt));
 assert.equal(createHash('sha256').update(await readFile(new URL('../src/generate/table-state-speech.ts',import.meta.url))).digest('hex'),reservation.generatorSha256);
 for(const page of f.pages){assert.equal(g.pages[page.page.slice(6,-5)],page.html);assert.equal(createHash('sha256').update(page.html).digest('hex'),page.htmlSha256);const {html,htmlSha256,...c}=page;assert.deepEqual(g.cases.find(s=>s.id===c.id),c);}
 for(const p of f.profiles){
  assert.ok(Date.parse(f.ready.readyAt)<Date.parse(p.nativeStartedAt));assert.equal(p.rows.length,30);assert.equal(p.summary.eligible,30);assert.equal(p.summary.inputEquivalent,30);assert.equal(p.summary.mainSpeechExact.matched,30);assert.equal(p.summary.fullSpeechExact.matched,27);assert.deepEqual(p.summary.tasks,{success:2,planned:2});
  assert.deepEqual(p.summary.readingTargets,{matched:30,mismatch:0,unmeasured:0,planned:30});assert.deepEqual(p.summary.declaredStateFields,{matched:74,mismatch:0,unmeasured:0,planned:74});assert.deepEqual(p.summary.declaredStateTransitions,{matched:9,mismatch:0,unmeasured:0,planned:9});
  const flags=p.rows.filter((r:any)=>r.stateChangeBefore);assert.equal(flags.length,2);assert.ok(flags.every((r:any)=>r.stateChangeBefore.status==='verified'));
  const failures=p.rows.filter((r:any)=>r.evaluation.fullSpeechExact===false);assert.equal(failures.length,3);assert.ok(failures.every((r:any)=>r.evaluation.mainSpeechExact===true&&r.evaluation.hintCandidateExact===false));
 }
});

test('table acquisition audit retains all attempts and environment/source tuples without pooling accuracy',async()=>{
 const a=JSON.parse(await readFile(new URL('./table-acquisition-audit.json',import.meta.url),'utf8'));assert.deepEqual(a.totals,{plannedActions:140,recordedActions:140,journalWindows:140});assert.equal(a.attempts.length,6);
 for(const key of ['plannedActions','recordedActions','journalWindows'])assert.equal(a.totals[key],a.attempts.reduce((n:number,r:any)=>n+r[key],0));
 for(const r of a.attempts){const f=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/'+r.cohort+'-2026-10-16.json',import.meta.url),'utf8')),p=f.profiles.find((p:any)=>p.browser===r.browser);assert.equal(r.sourceRecordsSha256,p.sourceRecordsSha256);assert.equal(r.recordedActions,p.rows.length);assert.equal(r.plannedActions,p.summary.planned);assert.equal(r.status,'collector-completed');assert.equal(r.environment.settings,'baseline-v2-dnd');assert.ok(r.environment.voiceOverAppVersion);assert.ok(r.environment.browser.version);assert.ok(r.environment.observationProtocol.startsWith('host-receipts-v9:'));}
});
