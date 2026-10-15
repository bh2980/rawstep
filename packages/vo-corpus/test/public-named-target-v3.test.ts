import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {samplePublicPages} from '../src/real-pages.js';
const audit=JSON.parse(readFileSync(new URL('./public-named-target-v3-audit.json',import.meta.url),'utf8'));
const geometry=JSON.parse(readFileSync(new URL('./public-named-target-v3-reading-quality.json',import.meta.url),'utf8'));
test('new-site audit retains first scores, missing set inputs and all unmeasured/preparation slots',()=>{
 assert.deepEqual(samplePublicPages(audit.seed,2,audit.pool),audit.selected);
 const excluded=new Set(audit.excludedPreviouslyPlannedSiteGroups);
 for(const page of audit.selected)assert.equal(excluded.has(new URL(page.url).hostname.replace(/^www\./,'')),false);
 assert.ok(excluded.has('nasa.gov')&&excluded.has('npr.org'));
 assert.equal(audit.modelBuildSha256,'8b86cf97886e5332846611e5bf6b264e86c3e8d06063427273cae752dd920ece');
 for(const [i,p]of audit.profiles.entries()){
  const matched=[3,5][i],claimed=[5,6][i];
  assert.equal(p.originalWrapperSummary.mainSpeechExact.matched,matched);assert.equal(p.originalWrapperSummary.eligible,claimed);
  assert.equal(p.auditedOriginal.planned,8);assert.equal(p.auditedOriginal.nativeObserved,7);assert.equal(p.auditedOriginal.eligible,matched);assert.equal(p.auditedOriginal.inputMismatch,[2,1][i]);
  assert.equal(p.auditedOriginal.mainSpeechExact.allPlannedRate,matched/8);
  assert.equal(p.observedInputRegression.planned,8);assert.equal(p.observedInputRegression.eligible,claimed);assert.equal(p.observedInputRegression.mainSpeechExact.matched,claimed);assert.equal(p.observedInputRegression.fullSpeechExact.matched,claimed);assert.equal(p.observedInputRegression.mainSpeechExact.allPlannedRate,claimed/8);
  assert.equal(p.rows.length,8);assert.equal(p.predictionsSealedBeforeRequest,7);assert.equal(p.preRequestSourceTreesVerified,7);
  assert.equal(p.observedSetupKeys,14);assert.equal(p.plannedSetupKeys,16);assert.equal(p.observedSuccessfulFocusPreparations,7);
  const failures=p.rows.filter(r=>r.failure);assert.equal(failures.length,1);assert.equal(failures[0].nativeObserved,false);
  assert.equal(p.rows.filter(r=>r.nativeObserved&&!r.observedInputRegression.eligible).length,[2,1][i]);
  for(const row of p.rows.filter(r=>r.auditedOriginal.inputStatus==='mismatch')){assert.ok(row.auditedOriginal.inputReasons.includes('link set metrics missing in input'));assert.ok(row.setMetrics.position>0&&row.setMetrics.setSize>=row.setMetrics.position);assert.equal(row.observedInputRegression.eligible,true);}
 }
 assert.equal(geometry.rows.length,3);
 for(const row of geometry.rows.filter(r=>r.url.includes('uniqlo.com'))){assert.equal(row.views.after.targetStatus,'ambiguous');assert.deepEqual(row.views.after.candidateRoles,['AXGroup','AXLink','AXImage']);}
 const privateFields=new Set(['utterances','AXTitle','AXDescription','nativeMain','predictedMain','input','context']);
 function publicOnly(value:unknown){if(Array.isArray(value))for(const row of value)publicOnly(row);else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){assert.equal(privateFields.has(key),false,`raw website field published: ${key}`);publicOnly(child);}}
 publicOnly(audit);publicOnly(geometry);
});
