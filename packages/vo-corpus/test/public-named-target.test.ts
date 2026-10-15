import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {samplePublicPages} from '../src/real-pages.js';
const audit=JSON.parse(readFileSync(new URL('./public-named-target-audit.json',import.meta.url),'utf8'));
test('new-domain evaluation keeps the model/acquisition freeze and every missing or unmeasured slot',()=>{
 const ready=audit.attempts[2],fresh=audit.attempts[3];
 assert.deepEqual(samplePublicPages(fresh.seed,2,fresh.pool),fresh.selected);
 assert.equal(fresh.modelBuildSha256,ready.modelBuildSha256);
 for(const [file,hash]of Object.entries(fresh.sourceHashes))if(!file.startsWith('data/probes/'))assert.equal(hash,ready.sourceHashes[file]);
 const inspected=new Set(audit.attempts.slice(0,3).flatMap(a=>a.selected.map(p=>new URL(p.url).hostname)));
 for(const page of fresh.selected)assert.ok(!inspected.has(new URL(page.url).hostname));
 for(const profile of fresh.profiles){
  assert.equal(profile.summary.planned,8);assert.equal(profile.summary.inputVerified,0);assert.equal(profile.summary.eligible,0);
  assert.equal(profile.summary.mainSpeechExact.conditionalRate,null);assert.equal(profile.summary.mainSpeechExact.allPlannedRate,0);
 }
 assert.deepEqual(fresh.profiles.map(p=>p.summary.nativeObserved),[7,5]);
 assert.deepEqual(ready.profiles.map(p=>p.summary.mainSpeechExact.matched),[5,4]);
 assert.ok(ready.profiles[0].readiness.some(r=>r.attempts>1&&r.elapsedMs>10000));
});
