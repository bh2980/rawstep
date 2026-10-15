import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {generateActivationTransfer} from '../src/generate/activation-transfer.js';
test('new compositions preserve authored before/after state, input history and actual no-op activations',async()=>{
 const generated=generateActivationTransfer();assert.equal(generated.cases.length,2);
 const browser=await chromium.launch({headless:true});
 try{for(const c of generated.cases){
  const page=await browser.newPage();
  try{
   await page.setContent(generated.pages[c.page.slice(6,-5)]!);await page.locator('#before').focus();
   for(const [step,key]of c.chords.entries()){
    const input=generated.speechInputs[c.id]![step]!,target=page.locator('#'+input.target.identity);
    if(key==='Space')for(const state of ['pressed','expanded'] as const){
     assert.equal(await target.getAttribute('aria-'+state),input.beforeTarget!.semantic[state]===undefined?null:String(input.beforeTarget!.semantic[state]));
    }
    await page.keyboard.press(key);
    assert.equal(await page.evaluate(()=>document.activeElement?.id),input.target.identity);
    for(const state of ['pressed','expanded'] as const)assert.equal(await target.getAttribute('aria-'+state),input.target.semantic[state]===undefined?null:String(input.target.semantic[state]));
   }
   assert.equal(await page.locator('#third').getAttribute('data-activations'),'1');
   assert.equal(c.axes.exposure,'unseen');assert.equal(c.chords.length,12);
  }finally{await page.close();}
 }}finally{await browser.close();}
});
test('shared source pages and authored before/after inputs reproduce the frozen Native cohort',()=>{
 const generated=generateActivationTransfer(),fixture=JSON.parse(readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-activation-transfer-2026-10-15.json',import.meta.url),'utf8'));
 for(const {html,htmlSha256,...scenario} of fixture.pages){
  assert.equal(generated.pages[scenario.page.slice(6,-5)],html);
  assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);
  assert.deepEqual(generated.cases.find(c=>c.id===scenario.id),scenario);
 }
 assert.equal(createHash('sha256').update(JSON.stringify(generated.speechInputs,null,2)+'\n').digest('hex'),fixture.plan.speechInputsSha256);
});
