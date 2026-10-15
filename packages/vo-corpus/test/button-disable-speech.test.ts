import assert from 'node:assert/strict';import test from 'node:test';
import {readFileSync} from 'node:fs';
import {generateButtonDisableSpeech} from '../src/generate/button-disable-speech.js';import {actionSequenceGroup} from '../src/dataset-split.js';
test('self-disable controls isolate state/context and reserve complete reverse-entry histories',()=>{
 const train=generateButtonDisableSpeech('train'),held=generateButtonDisableSpeech('test');assert.equal(train.cases.length,4);assert.equal(held.cases.length,2);
 for(const c of train.cases)assert.deepEqual(c.chords,['Tab','Space']);
 for(const c of held.cases){assert.equal(c.axes.exposure,'unseen');assert.equal(c.axes.oraclePurpose,'fixture-health');assert.ok(!train.cases.some(t=>actionSequenceGroup(t.chords)===actionSequenceGroup(c.chords)));assert.equal(c.chords.at(-1),'Space');assert.equal(c.taskOutcome!.controls[0]!.state.disabled,true);}
});
test('reserved first transfer keeps complete before/after inputs, silence, and all planned metrics',()=>{
 const f=JSON.parse(readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-button-disable-transfer-v1-2026-10-16.json',import.meta.url),'utf8'));
 for(const p of f.profiles){assert.equal(p.rows.length,14);assert.equal(p.summary.eligible,14);assert.equal(p.summary.mainSpeechExact.matched,14);assert.equal(p.summary.fullSpeechExact.matched,14);
  assert.equal(p.summary.navigationTargets.matched,12);assert.equal(p.summary.stateTransitions.matched,2);assert.equal(p.summary.tasks.planned,0);assert.equal(p.summary.fixtureHealth.passed,2);
  assert.ok(Date.parse(f.acquisition.reservation.reservedAt)<Date.parse(p.nativeStartedAt));assert.ok(Date.parse(f.ready.readyAt)<Date.parse(p.nativeStartedAt));
  for(const r of p.rows.filter((r:any)=>r.chord==='Space')){assert.deepEqual(r.prediction.utterances,[]);assert.deepEqual(r.utterances,[]);assert.equal(r.diagnostic.events.length,1);assert.equal(r.diagnostic.events[0].status,'modeled');assert.equal(r.beforeInputVerification.status,'verified');}
 }
});
test('acquisition totals include the original terminal zero-action attempt without merging model accuracy',()=>{
 const audit=JSON.parse(readFileSync(new URL('practical-speech-acquisition-audit.json',import.meta.url),'utf8'));assert.equal(audit.attempts.length,7);assert.equal(audit.totals.plannedActions,148);assert.equal(audit.totals.observedActions,140);
 const failed=audit.attempts.filter((r:any)=>r.status!=='completed');assert.equal(failed.length,1);assert.equal(failed[0].plannedActions,8);assert.equal(failed[0].observedActions,0);
 const original=audit.attempts.find((r:any)=>r.cohort==='task'&&r.browser==='safari');assert.equal(original.axErrors,5);
});
