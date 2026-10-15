import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {generateDialogSpeech} from '../src/generate/dialog-speech.js';
test('dialog contrasts use nonmodal page focus and leave the dialog without a focus trap',async()=>{
 const {pages,cases,speechInputs}=generateDialogSpeech();assert.equal(cases.length,5);assert.equal(cases.reduce((n,c)=>n+c.chords.length,0),29);
 const browser=await chromium.launch({headless:true});
 try{for(const c of cases){const page=await browser.newPage();try{
  await page.setContent(pages[c.page.slice(6,-5)]!);await page.locator('#before').focus();
  for(const [step,chord]of c.chords.entries()){
   await page.keyboard.press(chord);const input=speechInputs[c.id]![step]!;assert.equal(await page.evaluate(()=>document.activeElement?.id),input.target.identity);
   assert.equal(await page.locator('#'+input.target.identity).innerText(),input.target.semantic.name);
  }
 }finally{await page.close();}}}finally{await browser.close();}
});

test('the original dialog calibration pages, commands and authored inputs remain reproducible',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
 const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-dialog-speech-2026-10-15.json',import.meta.url),'utf8')),generated=generateDialogSpeech();
 for(const {html,htmlSha256,...c}of fixture.pages){assert.equal(generated.pages[c.page.slice(6,-5)],html);assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);assert.deepEqual(generated.cases.find(s=>s.id===c.id),c);}
 for(const p of fixture.profiles){const rows:Record<string,unknown[]>={};for(const row of p.rows)(rows[row.caseId]??=[]).push(row.input);
  assert.deepEqual(rows,generated.speechInputs);assert.equal(createHash('sha256').update(JSON.stringify(rows,null,2)+'\n').digest('hex'),p.inputsSha256);
 }
});
