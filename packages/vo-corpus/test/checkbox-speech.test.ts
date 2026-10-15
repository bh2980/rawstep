import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {generateCheckboxSpeech} from '../src/generate/checkbox-speech.js';

test('checkbox contrasts keep gesture HTML identical and description as a single changed attribute',()=>{
 const {pages,cases,speechInputs}=generateCheckboxSpeech();assert.equal(cases.length,8);
 for(const implementation of ['native','aria']){
  for(const mode of ['plain','description'])assert.equal(pages[`${implementation}-${mode}-physical`],pages[`${implementation}-${mode}-vo`]);
  assert.equal(pages[`${implementation}-description-physical`]!.replace(' aria-describedby="detail"',''),pages[`${implementation}-plain-physical`]);
 }
 for(const c of cases){assert.equal(c.axes.exposure,'calibration');assert.equal(c.axes.partition,'train');assert.equal(speechInputs[c.id]!.length,c.chords.length);assert.equal(speechInputs[c.id]![1]!.target.semantic.checked,true);assert.equal(speechInputs[c.id]![4]!.target.semantic.checked,false);}
});
test('native and ARIA fixtures independently implement both physical-key and click state changes',async()=>{
 const {pages}=generateCheckboxSpeech(),browser=await chromium.launch({headless:true});
 try{
  for(const implementation of ['native','aria']){
   const page=await browser.newPage();
   try{
    await page.setContent(pages[`${implementation}-description-physical`]!);const target=page.locator('#target');
    const checked=()=>target.evaluate((n:HTMLElement)=>n instanceof HTMLInputElement?n.checked:n.getAttribute('aria-checked')==='true');
    assert.equal(await checked(),false);await target.press('Space');assert.equal(await checked(),true);await target.click();assert.equal(await checked(),false);
   }finally{await page.close();}
  }
 }finally{await browser.close();}
});

test('the reusable generator preserves the archived Native contrast inputs',async()=>{
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-checkbox-speech-2026-10-15.json',import.meta.url),'utf8')) as {pages:{id:string;html:string;chords:string[]}[];profiles:{rows:{caseId:string;input:unknown}[]}[]};
 const {pages,cases,speechInputs}=generateCheckboxSpeech();
 for(const c of cases){
  const archived=fixture.pages.find(p=>p.id===c.id)!;assert.equal(pages[c.page.slice(6,-5)],archived.html);assert.deepEqual(c.chords,archived.chords);
  assert.deepEqual(speechInputs[c.id],fixture.profiles[0]!.rows.filter(r=>r.caseId===c.id).map(r=>r.input));
 }
});
