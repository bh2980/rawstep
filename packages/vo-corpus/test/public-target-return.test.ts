import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {samplePublicPages} from '../src/real-pages.js';
const read=(name:string)=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
test('live target-return sampling preserves the original sites and every observed or unmeasured action',()=>{
 const original=read('./public-target-return-audit.json'),corrected=read('./public-target-return-scope-audit.json');
 assert.deepEqual(samplePublicPages(original.seed,2,original.pool),original.selected);
 assert.deepEqual(corrected.selected,original.selected);
 for(const page of original.selected)assert.ok(!original.excludedPreviouslyPlannedDomains.includes(new URL(page.url).hostname));
 let observed=0;
 for(const attempt of corrected.attempts)for(const profile of attempt.profiles){
  assert.equal(profile.summary.planned,8);assert.equal(profile.summary.nativeObserved,profile.observedScoredActions);
  assert.equal(profile.observedScoredActions,8);assert.equal(profile.summary.eligible,0);
  assert.equal(profile.summary.mainSpeechExact.conditionalRate,null);
  assert.equal(profile.constructedInputs+profile.unconstructedInputs,8);observed+=profile.observedScoredActions;
 }
 assert.equal(observed,32);
 // Keep the earlier, weaker equivalence result visible instead of rewriting its score.
 assert.equal(original.attempts[1].profiles.find(p=>p.browser==='chrome').summary.eligible,1);
 assert.ok(corrected.attempts[1].profiles.find(p=>p.browser==='chrome').summary.inputMismatch>=1);
});
