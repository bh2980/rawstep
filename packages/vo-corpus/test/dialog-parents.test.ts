import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {generateDialogParents} from '../src/generate/dialog-parents.js';
test('parent contrasts preserve the inner dialog and actual keyboard targets',async()=>{
 const generated=generateDialogParents(),browser=await chromium.launch({headless:true});const inner:string[]=[];
 try{for(const c of generated.cases){const page=await browser.newPage();try{
  await page.setContent(generated.pages[c.page.slice(6,-5)]!);inner.push(await page.locator('#panel').evaluate(n=>n.outerHTML));await page.locator('#before').focus();
  for(const [i,key]of c.chords.entries()){await page.keyboard.press(key);assert.equal(await page.evaluate(()=>document.activeElement?.id),generated.speechInputs[c.id]![i]!.target.identity);}
  assert.equal(c.axes.exposure,'calibration');
 }finally{await page.close();}}}finally{await browser.close();}
 assert.equal(new Set(inner).size,1);
});
test('parent contrasts reproduce the original Native calibration bytes and inputs',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-dialog-parent-context-2026-10-15.json',import.meta.url),'utf8')),generated=generateDialogParents();
 for(const {html,htmlSha256,...c}of fixture.pages){assert.equal(generated.pages[c.page.slice(6,-5)],html);assert.deepEqual(generated.cases.find(s=>s.id===c.id),c);}
 for(const profile of fixture.profiles)for(const row of profile.rows)assert.deepEqual(generated.speechInputs[row.caseId]![row.step],row.input);
});
