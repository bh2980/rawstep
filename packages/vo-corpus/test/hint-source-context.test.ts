import assert from 'node:assert/strict';
import test from 'node:test';
import {generateHintSourceContext} from '../src/generate/hint-source-context.js';
import {generateHintContextTransfer} from '../src/generate/hint-context-transfer.js';
import {actionSequenceGroup} from '../src/dataset-split.js';
import {chromium} from 'playwright';
import {fixturePageState} from '../src/state.js';
import {evaluateTaskOutcome} from '../src/task-outcomes.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test('hint source contrasts change only title and retain separate button/link command histories',()=>{
 const generated=generateHintSourceContext();assert.equal(generated.cases.length,10);
 assert.equal(generated.cases.reduce((n,c)=>n+c.chords.length,0),30);
 for(const role of ['button','link']){
  const pages=new Set<string>();
  for(const condition of ['none','equal','different']){
   const variant=role+'-title-'+condition,c=generated.cases.find(c=>c.id.endsWith('.'+variant))!;
   pages.add(generated.pages[variant]!.replace(/ title="[^"]*"/g,''));
   assert.deepEqual(c.chords,role==='button'?['Tab','Shift+Tab','Tab']:['VO+Right','VO+Left','VO+Right']);
   assert.deepEqual(generated.targetIds[c.id],['first','before','first']);
   assert.equal(generated.authoredHelp[c.id],condition==='none'?undefined:condition==='equal'?'Inspect forecast':'Review forecast details');
  }
  assert.equal(pages.size,1);
 }
 const controls='<button id=first type=button>Inspect forecast</button><button id=second type=button>Keep forecast</button>';
 for(const variant of ['form-div','form-unnamed','form-named','form-region']){
  assert.ok(generated.pages[variant]!.includes(controls));
  const c=generated.cases.find(c=>c.id.endsWith('.'+variant))!;
  assert.deepEqual(c.chords,['Tab','Tab','Shift+Tab']);assert.deepEqual(generated.targetIds[c.id],['first','second','first']);
 }
});

test('reserved hint transfer separates task outcomes from read-only health and keeps whole histories outside calibration',()=>{
 const train=generateHintSourceContext(),transfer=generateHintContextTransfer();
 assert.equal(transfer.cases.length,2);assert.equal(transfer.cases.reduce((n,c)=>n+c.chords.length,0),24);
 const histories=new Set(train.cases.map(c=>actionSequenceGroup(c.chords)));
 for(const c of transfer.cases){assert.equal(histories.has(actionSequenceGroup(c.chords)),false);assert.equal(c.axes.exposure,'unseen');assert.equal(c.axes.partition,'test');assert.equal(c.chords.length,transfer.targetIds[c.id]!.length);}
 assert.deepEqual(transfer.cases.map(c=>c.axes.oraclePurpose),['task-outcome','fixture-health']);
 assert.deepEqual(transfer.cases[0]!.taskOutcome?.texts,['Journey preferences stored']);
 assert.deepEqual(transfer.cases[1]!.taskOutcome?.texts,[]);
});

test('reserved preferences task changes real control state and saves through the declared keyboard sequence',async()=>{
 const generated=generateHintContextTransfer(),c=generated.cases[0]!,browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent(generated.pages['delivery-preferences']!);await page.locator('#before').focus();
  for(const [step,chord]of c.chords.entries()){
   await page.keyboard.press(chord);
   assert.equal(await page.evaluate(()=>document.activeElement?.id),generated.targetIds[c.id]![step]);
  }
  assert.equal(evaluateTaskOutcome(c.taskOutcome!,await fixturePageState(page)).status,'success');
 }finally{await browser.close();}
});

test('Native hint fixtures reproduce shared sources and retain first scores, event-scope audit and the failed start',()=>{
 const calibration=JSON.parse(readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-hint-source-context-2026-10-16.json',import.meta.url),'utf8'));
 const bytes=readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-hint-context-transfer-2026-10-16.json',import.meta.url)),transfer=JSON.parse(bytes.toString()),audit=JSON.parse(readFileSync(new URL('./hint-transfer-input-audit.json',import.meta.url),'utf8')),acquisition=JSON.parse(readFileSync(new URL('./hint-acquisition-audit.json',import.meta.url),'utf8'));
 assert.equal(audit.fixtureSha256,createHash('sha256').update(bytes).digest('hex'));
 for(const [fixture,generated]of [[calibration,generateHintSourceContext()],[transfer,generateHintContextTransfer()]] as const)for(const page of fixture.pages){
  assert.equal(generated.pages[page.page.slice(6,-5)],page.html);assert.equal(createHash('sha256').update(page.html).digest('hex'),page.htmlSha256);
  const {html,htmlSha256,...scenario}=page;assert.deepEqual(generated.cases.find(c=>c.id===page.id),scenario);
 }
 for(const [i,p]of calibration.profiles.entries()){
  assert.equal(p.summary.planned,30);assert.equal(p.summary.nativeObserved,30);assert.equal(p.summary.eligible,[23,27][i]);
  assert.equal(p.summary.fullSpeechExact.matched,[19,23][i]);assert.equal(p.summary.tasks.planned,0);assert.equal(p.summary.fixtureHealth.passed,10);
 }
 for(const p of transfer.profiles){
  assert.equal(p.summary.planned,24);assert.equal(p.summary.eligible,19);assert.equal(p.summary.fullSpeechExact.allPlannedRate,19/24);
  assert.equal(p.summary.readingTargets.matched,24);assert.equal(p.summary.keyboardFocus.matched,24);assert.equal(p.summary.declaredStateTransitions.matched,6);assert.equal(p.summary.tasks.planned,1);assert.equal(p.summary.tasks.success,1);assert.equal(p.summary.fixtureHealth.planned,1);
  const checked=audit.profiles.find((a:any)=>a.browser===p.browser);assert.deepEqual(checked.originalSummary,p.summary);assert.equal(checked.auditedOriginal.eligible,24);assert.equal(checked.auditedOriginal.fullSpeechExact.matched,24);
  const added=checked.rows.filter((r:any)=>!r.originallyEligible&&r.eligible);assert.equal(added.length,5);
  for(const row of added){assert.equal(row.chord,'Space');assert.equal(row.verificationMode,'guarded-native-button-space-event');assert.equal(row.beforeStatus,'verified');assert.equal(row.previousContextVerified,true);}
 }
 assert.equal(acquisition.attempts.length,5);assert.deepEqual(acquisition.total,{plannedActions:138,recordedActions:108,caseRecords:25});
 const failed=acquisition.attempts.filter((a:any)=>a.errors.length);assert.equal(failed.length,1);assert.equal(failed[0].plannedActions,30);assert.equal(failed[0].recordedActions,0);
});
