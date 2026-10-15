import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {generateDialogTransfer} from '../src/generate/dialog-transfer.js';
import {fixturePageState} from '../src/state.js';
import {evaluateTaskOutcome} from '../src/task-outcomes.js';

test('new nonmodal dialog tasks execute real focus/state changes and satisfy frozen submission outcomes',async()=>{
 const generated=generateDialogTransfer(),browser=await chromium.launch({headless:true});let actions=0;
 try{for(const c of generated.cases){const page=await browser.newPage();try{
  await page.setContent(generated.pages[c.page.slice(6,-5)]!);await page.bringToFront();await page.locator('#before').focus();
  for(const [i,chord]of c.chords.entries()){await page.keyboard.press(chord);assert.equal(await page.evaluate(()=>document.activeElement?.id),generated.focusTargets[c.id]![i]);actions++;}
  assert.equal(evaluateTaskOutcome(c.taskOutcome!,await fixturePageState(page)).status,'success');
  assert.equal(c.axes.exposure,'unseen');assert.equal(c.axes.partition,'test');
 }finally{await page.close();}}}finally{await browser.close();}
 assert.equal(actions,40);
});

test('dialog task pages, commands and outcome oracles reproduce the original fixed cohort',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
 const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-dialog-transfer-2026-10-15.json',import.meta.url),'utf8')),generated=generateDialogTransfer();
 for(const {html,htmlSha256,...c}of fixture.pages){assert.equal(generated.pages[c.page.slice(6,-5)],html);assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);assert.deepEqual(generated.cases.find(s=>s.id===c.id),c);}
});
