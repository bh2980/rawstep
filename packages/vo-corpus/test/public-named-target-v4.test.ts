import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {samplePublicPages} from '../src/real-pages.js';

const audit=JSON.parse(readFileSync(new URL('./public-named-target-v4-audit.json',import.meta.url),'utf8'));
const inputAudit=JSON.parse(readFileSync(new URL('./public-named-target-v4-input-audit.json',import.meta.url),'utf8'));
const declaredPool=JSON.parse(readFileSync(new URL('./public-transfer-pool-v2.json',import.meta.url),'utf8'));

test('new-site first evaluation preserves selection and excludes previously planned subdomains',()=>{
 assert.deepEqual(declaredPool,audit.declaredPool);
 const excluded=declaredPool.filter((p:{siteGroup:string})=>audit.excludedPreviouslyPlannedDomains.some((host:string)=>host===p.siteGroup||host.endsWith('.'+p.siteGroup))).map((p:{siteGroup:string})=>p.siteGroup);
 assert.deepEqual([...excluded].sort(),[...audit.excludedPreviouslyPlannedSiteGroups].sort());
 assert.deepEqual(declaredPool.filter((p:{siteGroup:string})=>!excluded.includes(p.siteGroup)),audit.pool);
 assert.deepEqual(samplePublicPages(audit.seed,4,audit.pool),audit.selected);
 assert.equal(new Set(audit.selected.map((p:{siteGroup:string})=>p.siteGroup)).size,4);
 assert.equal(audit.modelBuildSha256,'2276852e5c82fc5528c717074422fe02e31e5967ac42cdaca092cf0be4f14f9e');
 assert.equal(audit.classification,'preserved-first-evaluation-now-inspected-regression');
});

test('new-site accounting retains unavailable inputs and literal Full failures in all-plan denominators',()=>{
 assert.deepEqual(audit.profiles.map((p:{browser:string})=>p.browser),['safari','chrome']);
 for(const p of audit.profiles){
  const rows=p.rows,summary=p.reproducedFirstSummary;
  assert.equal(rows.length,16);assert.equal(summary.planned,16);
  assert.equal(summary.nativeObserved,rows.filter((r:any)=>r.nativeObserved).length);
  assert.equal(summary.eligible,rows.filter((r:any)=>r.eligible).length);
  assert.equal(p.originalWrapperSummary.eligible,summary.eligible);
  for(const [metric,key]of [['mainSpeechExact','mainMatched'],['fullSpeechExact','fullMatched'],['hintCandidateExact','hintMatched']]){
   const matched=rows.filter((r:any)=>r[key]===true).length;
   assert.equal(summary[metric].matched,matched);
   assert.equal(summary[metric].allPlannedRate,matched/16);
   assert.equal(summary[metric].conditionalRate,summary.eligible?matched/summary.eligible:null);
   assert.deepEqual(p.originalWrapperSummary[metric],summary[metric]);
  }
  for(const row of rows){
   if(row.eligible){assert.equal(row.nativeObserved,true);assert.equal(row.inputStatus,'verified');assert.equal(row.previousContextVerified,true);assert.equal(row.beforeTargetStable,true);assert.deepEqual(row.issues,[]);}
   else{assert.equal(row.mainMatched,null);assert.equal(row.fullMatched,null);}
   if(row.failure)assert.equal(row.nativeObserved,false);
  }
  assert.equal(p.plannedSetupKeys,32);assert.ok(p.observedSetupKeys<=32);
  assert.equal(p.plannedFocusPreparations,16);assert.ok(p.observedSuccessfulFocusPreparations<=16);
  assert.equal(p.predictionsSealedBeforeRequest,rows.filter((r:any)=>r.inputConstructed&&r.predictionSha256).length);
  assert.equal(p.preRequestSourceTreesVerified,p.predictionsSealedBeforeRequest);
 }
});

test('page-source metadata correction preserves invalid original digests separately from derived AX-root digests',()=>{
 const empty=createHash('sha256').update('').digest('hex');
 for(const p of audit.profiles)for(const page of p.pageSources){
  assert.equal(page.originalTextSha256,empty);
  assert.equal(page.originalTextDigestStatus,'invalid-envelope-passed-instead-of-root');
  assert.match(page.derivedRootTextSha256,/^[a-f0-9]{64}$/);
  if(page.derivedRootTextLength>0)assert.notEqual(page.derivedRootTextSha256,empty);
  assert.match(page.sourceAxSha256,/^[a-f0-9]{64}$/);
 }
 assert.match(audit.qualityCorrection,/Neither digest establishes HTML\/DOM equality/);
});

test('compound-input audit preserves first scores and does not turn rejected comparisons into successes',()=>{
 assert.equal(inputAudit.originalAuditSha256,createHash('sha256').update(readFileSync(new URL('./public-named-target-v4-audit.json',import.meta.url))).digest('hex'));
 assert.notEqual(inputAudit.currentVerifierSha256,inputAudit.originalVerifierSha256);
 assert.equal(inputAudit.modelBuildSha256,audit.modelBuildSha256);
 for(const [i,p]of inputAudit.profiles.entries()){
  assert.deepEqual(p.originalFirstSummary,audit.profiles[i].reproducedFirstSummary);
  assert.equal(p.auditedOriginal.planned,16);assert.equal(p.auditedOriginal.nativeObserved,16);
  assert.equal(p.auditedOriginal.eligible,[7,9][i]);
  assert.equal(p.originalFirstSummary.eligible,[7,10][i]);
  assert.equal(p.originalFirstSummary.mainSpeechExact.matched,[7,9][i]);
  for(const metric of ['mainSpeechExact','fullSpeechExact']){
   assert.equal(p.auditedOriginal[metric].matched,p.originalFirstSummary[metric].matched);
   assert.equal(p.auditedOriginal[metric].allPlannedRate,p.originalFirstSummary[metric].allPlannedRate);
  }
  const changed=p.rows.filter((r:any)=>r.originallyEligible!==r.eligible);
  assert.equal(changed.length,i);
  for(const row of changed){assert.equal(row.originalInputStatus,'verified');assert.equal(row.auditedInputStatus,'unmeasured');assert.match(row.inputReasons.join(' '),/compound link\/heading/);assert.equal(row.mainMatched,null);assert.equal(row.fullMatched,null);}
 }
});

test('public site audit excludes raw website text, speech, AX nodes and prediction inputs',()=>{
 const privateFields=new Set(['utterances','AXTitle','AXDescription','AXValue','nativeMain','predictedMain','input','context']);
 function inspect(value:unknown){if(Array.isArray(value))value.forEach(inspect);else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){assert.equal(privateFields.has(key),false,`private field: ${key}`);inspect(child);}}
 inspect(audit);inspect(inputAudit);
});
