import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {generateDialogCompositions} from '../src/generate/dialog-compositions.js';
import {fixturePageState} from '../src/state.js';
import {evaluateTaskOutcome} from '../src/task-outcomes.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('dialog compositions execute real state changes and outcomes in the declared focus order',async()=>{
 const generated=generateDialogCompositions(),browser=await chromium.launch({headless:true});let actions=0,changes=0;
 try{for(const c of generated.cases){const page=await browser.newPage();try{
  await page.setContent(generated.pages[c.page.slice(6,-5)]!);await page.locator('#before').focus();
  assert.notEqual(evaluateTaskOutcome(c.taskOutcome!,await fixturePageState(page)).status,'success');
  for(const [i,chord]of c.chords.entries()){
   const before=await fixturePageState(page);await page.keyboard.press(chord);
   assert.equal(await page.evaluate(()=>document.activeElement?.id),generated.focusTargets[c.id]![i]);
   const after=await fixturePageState(page);assert.deepEqual(after.objectErrors??[],[]);
   if(JSON.stringify(before.controls)!==JSON.stringify(after.controls))changes++;actions++;
  }
  assert.equal(evaluateTaskOutcome(c.taskOutcome!,await fixturePageState(page)).status,'success');
  assert.equal(c.axes.partition,'test');assert.equal(c.axes.exposure,'unseen');
 }finally{await page.close();}}}finally{await browser.close();}
 assert.deepEqual({actions,changes},{actions:39,changes:5});
});

test('dialog composition update fixtures reproduce the fixed HTML, complete command histories and outcomes',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-dialog-compositions-2026-10-16.json',import.meta.url),'utf8')),generated=generateDialogCompositions();
 for(const {html,htmlSha256,...c}of fixture.pages){
  assert.equal(generated.pages[c.page.slice(6,-5)],html);
  assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);
  assert.deepEqual(generated.cases.find(s=>s.id===c.id),c);
 }
 for(const p of fixture.profiles){
  assert.equal(p.rows.length,39);assert.equal(p.summary.planned,39);
  assert.ok(Date.parse(fixture.ready.readyAt)<Date.parse(p.nativeStartedAt));
  const transitions=p.rows.flatMap((r:any)=>r.stateTransitions);
  assert.equal(transitions.length,5);
  for(const c of generated.cases)assert.deepEqual(p.rows.filter((r:any)=>r.caseId===c.id).map((r:any)=>r.chord),c.chords);
 }
});
