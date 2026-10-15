import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {generateButtonStateSpeech} from '../src/generate/button-state-speech.js';

test('button conditions differ only in pressed and expanded attributes',()=>{
 const {pages,cases,speechInputs}=generateButtonStateSpeech();assert.equal(cases.length,5);
 for(const c of cases){
  assert.equal(pages[c.page.slice(6,-5)]!.replace(/ aria-(pressed|expanded)="(true|false|mixed)"/g,''),pages.plain);
  assert.equal(c.axes.exposure,'calibration');assert.equal(speechInputs[c.id]!.length,5);
 }
 assert.equal(speechInputs['button-state-speech-v1.mixed-toggle']![0]!.target.semantic.pressed,'mixed');
 assert.equal(speechInputs['button-state-speech-v1.mixed-toggle']![1]!.target.semantic.pressed,true);
 assert.equal(speechInputs['button-state-speech-v1.mixed-toggle']![4]!.target.semantic.pressed,false);
});
test('reproduction preserves the captured HTML, commands and caller inputs',()=>{
 const generated=generateButtonStateSpeech(),fixture=JSON.parse(readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-button-state-speech-2026-10-15.json',import.meta.url),'utf8'));
 for(const {html,htmlSha256,...scenario} of fixture.pages){
  assert.equal(generated.pages[scenario.page.slice(6,-5)],html);
  assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);
  assert.deepEqual(generated.cases.find(c=>c.id===scenario.id),scenario);
 }
 assert.equal(createHash('sha256').update(JSON.stringify(generated.speechInputs,null,2)+'\n').digest('hex'),fixture.plan.speechInputsSha256);
});
test('real page activation and return match the authored caller states',async()=>{
 const generated=generateButtonStateSpeech(),browser=await chromium.launch({headless:true});
 try{for(const c of generated.cases){
  const page=await browser.newPage();
  try{
   await page.setContent(generated.pages[c.page.slice(6,-5)]!);await page.locator('#before').focus();
   for(const [step,chord]of c.chords.entries()){
    await page.keyboard.press(chord==='Shift+Tab'?'Shift+Tab':chord);
    const input=generated.speechInputs[c.id]![step]!;
    assert.equal(await page.evaluate(()=>document.activeElement?.id),input.target.identity);
    if(input.target.identity==='target')for(const key of ['pressed','expanded'] as const){
     const observed=await page.locator('#target').getAttribute('aria-'+key);
     assert.equal(observed,input.target.semantic[key]===undefined?null:String(input.target.semantic[key]));
    }
   }
   assert.equal(await page.locator('#target').getAttribute('data-activations'),'2');
  }finally{await page.close();}
 }}finally{await browser.close();}
});
