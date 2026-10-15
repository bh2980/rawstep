import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {generateLandmarkTransfer} from '../src/generate/landmark-transfer.js';
test('new compositions implement the authored focus paths, checkbox/button states and disclosure panel',async()=>{
 const {pages,cases,speechInputs}=generateLandmarkTransfer();assert.equal(cases.length,2);assert.equal(cases.reduce((n,c)=>n+c.chords.length,0),32);
 const browser=await chromium.launch({headless:true});
 try{for(const c of cases){const page=await browser.newPage();try{
  await page.setContent(pages[c.page.slice(6,-5)]!);await page.locator('#before').focus();
  for(const [step,chord]of c.chords.entries()){
   const input=speechInputs[c.id]![step]!,target=page.locator('#'+input.target.identity);
   const state=async()=>({checked:await target.evaluate(n=>n instanceof HTMLInputElement?n.checked:undefined),pressed:await target.getAttribute('aria-pressed'),expanded:await target.getAttribute('aria-expanded')});
   if(chord==='Space'){
    const before=await state();for(const key of ['checked','pressed','expanded'] as const)assert.equal(before[key],key==='checked'?input.beforeTarget!.semantic[key]:input.beforeTarget!.semantic[key]===undefined?null:String(input.beforeTarget!.semantic[key]));
   }
   await page.keyboard.press(chord);assert.equal(await page.evaluate(()=>document.activeElement?.id),input.target.identity);
   assert.equal(await page.getByRole(input.target.semantic.role as 'button'|'checkbox',{name:input.target.semantic.name,exact:true}).getAttribute('id'),input.target.identity);
   const after=await state();for(const key of ['checked','pressed','expanded'] as const)assert.equal(after[key],key==='checked'?input.target.semantic[key]:input.target.semantic[key]===undefined?null:String(input.target.semantic[key]));
   if(input.target.semantic.expanded!==undefined)assert.equal(await page.locator('#pickup-panel').isVisible(),input.target.semantic.expanded);
  }
  assert.equal(c.axes.exposure,'unseen');
 }finally{await page.close();}}}finally{await browser.close();}
});

test('the independent cohort keeps the original HTML, commands and pre-Native caller inputs',()=>{
 const generated=generateLandmarkTransfer(),fixture=JSON.parse(readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-landmark-transfer-2026-10-15.json',import.meta.url),'utf8'));
 for(const {html,htmlSha256,...scenario} of fixture.pages){
  assert.equal(generated.pages[scenario.page.slice(6,-5)],html);assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);
  assert.deepEqual(generated.cases.find(c=>c.id===scenario.id),scenario);
 }
 assert.equal(createHash('sha256').update(JSON.stringify(generated.speechInputs,null,2)+'\n').digest('hex'),fixture.plan.speechInputsSha256);
});
