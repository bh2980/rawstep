import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {generateLandmarkSpeech} from '../src/generate/landmark-speech.js';
test('landmark contrasts preserve role/name, focus order and exit/reentry inputs',async()=>{
 const {pages,cases,speechInputs}=generateLandmarkSpeech();assert.equal(cases.length,6);
 assert.equal(pages['banner-named']!.replace(' aria-label="Site gateway"',''),pages['banner-unnamed']);
 const browser=await chromium.launch({headless:true});
 try{for(const c of cases){const page=await browser.newPage();try{
  await page.setContent(pages[c.page.slice(6,-5)]!);await page.locator('#before').focus();
  for(const [step,chord]of c.chords.entries()){
   await page.keyboard.press(chord);const input=speechInputs[c.id]![step]!;
   assert.equal(await page.evaluate(()=>document.activeElement?.id),input.target.identity);
   assert.equal(input.target.containers!.length,step===2?0:1);
  }
 }finally{await page.close();}}}finally{await browser.close();}
});

test('landmark source pages, scenarios and caller inputs reproduce the immutable Native fixture',()=>{
 const generated=generateLandmarkSpeech(),fixture=JSON.parse(readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-landmark-speech-2026-10-15.json',import.meta.url),'utf8'));
 for(const {html,htmlSha256,...scenario} of fixture.pages){
  assert.equal(generated.pages[scenario.page.slice(6,-5)],html);assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);
  assert.deepEqual(generated.cases.find(c=>c.id===scenario.id),scenario);
 }
 assert.equal(createHash('sha256').update(JSON.stringify(generated.speechInputs,null,2)+'\n').digest('hex'),fixture.plan.speechInputsSha256);
});
