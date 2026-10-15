import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
const zipped=readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-practical-speech-tasks-2026-10-16.json.gz',import.meta.url)),raw=gunzipSync(zipped),fixture=JSON.parse(raw.toString()),manifest=JSON.parse(readFileSync(new URL('practical-speech-first-export.json',import.meta.url),'utf8'));
test('first task evidence is lossless and keeps every original action, missing input and unknown outcome',()=>{
 const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');assert.equal(hash(raw),manifest.uncompressedSha256);assert.equal(hash(zipped),manifest.gzipSha256);
 for(const p of fixture.profiles){
  assert.equal(p.rows.length,48);assert.equal(p.summary.nativeObserved,48);assert.equal(p.summary.navigationTargets.planned,24);assert.equal(p.summary.stateFields.planned,145);
  assert.equal(p.summary.mainSpeechExact.matched,p.browser==='safari'?29:35);assert.equal(p.summary.fullSpeechExact.matched,p.browser==='safari'?29:35);
  assert.equal(p.summary.tasks.success,p.browser==='safari'?2:3);assert.equal(p.summary.navigationTargets.matched,p.browser==='safari'?20:24);
  assert.equal(p.rows.filter((r:any)=>!r.diagnostic.events.length).length,7);assert.equal(p.rows.filter((r:any)=>r.diagnostic.events.length>1).length,2);
  assert.ok(Date.parse(fixture.ready.readyAt)<Date.parse(p.nativeStartedAt));assert.ok(Date.parse(fixture.acquisition.sealedAt)<Date.parse(p.nativeStartedAt));
 }
 assert.equal(fixture.profiles[0].tasks[2].native.status,'unmeasured');assert.deepEqual(fixture.profiles[0].tasks[2].native.unknown,['post-state missing']);
});
test('the Safari cascade starts after current-button disabling, while keyboard focus stays separate from VO position',()=>{
 const p=fixture.profiles[0],rows=p.rows.filter((r:any)=>r.caseId.endsWith('supply-basket'));
 assert.equal(rows[5].chord,'Space');assert.equal(rows[5].readingTarget.status,'matched');assert.equal(rows[5].afterState.objects.find((o:any)=>o.id==='remove').state.disabled,true);
 assert.equal(rows[6].readingTarget.native.id,'before');assert.equal(rows[6].readingTarget.predicted.id,'order');
 assert.equal(rows[6].keyboardFocus.status,'mismatch');assert.equal(p.tasks[2].firstBehaviorDivergence.step,6);
 assert.equal(rows.slice(0,6).some((r:any)=>r.readingTarget.status==='mismatch'),false);
 for(const r of fixture.profiles[1].rows.filter((r:any)=>r.navigationAction))assert.equal(r.readingTarget.status,'matched');
});
test('unverified editing and fallback receipts cannot be advertised as perfect whole-task speech',()=>{
 for(const p of fixture.profiles){
  for(const r of p.rows.filter((r:any)=>r.unmodeledOutputs.length||r.diagnostic.events.length!==1)){assert.equal(r.evaluation.eligible,false);assert.equal(r.evaluation.mainSpeechExact,null);}
  const returned=p.rows.find((r:any)=>r.caseId.endsWith('support-search')&&r.step===9);assert.equal(returned.stateFields.filter((f:any)=>f.id==='query').every((f:any)=>f.status==='matched'),true);
  assert.equal(returned.evaluation.eligible,false);
 }
 const p=fixture.profiles[1];for(const step of [5,11]){const r=p.rows.find((r:any)=>r.caseId.endsWith('supply-basket')&&r.step===step);assert.deepEqual(r.utterances,[]);assert.ok(r.prediction.utterances.length);assert.equal(r.diagnostic.events[0].status,'unsupported');}
});
