import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {generateArticleTransfer} from '../src/generate/article-transfer.js';
test('new article compositions execute the authored focus and activation states in a real page',async()=>{
 const safari=generateArticleTransfer(),chrome=generateArticleTransfer('chrome');
 assert.deepEqual(chrome.pages,safari.pages);assert.deepEqual(chrome.cases,safari.cases);assert.equal(safari.cases.reduce((n,c)=>n+c.chords.length,0),34);
 const browser=await chromium.launch({headless:true});let events=0;
 try{for(const c of safari.cases){const page=await browser.newPage();try{
  await page.setContent(safari.pages[c.page.slice(6,-5)]!);await page.locator('#before').focus();
  for(const [index,chord]of c.chords.entries()){
   const input=safari.speechInputs[c.id]![index]!,target=page.locator('#'+input.target.identity);
   async function state(){return {checked:await target.evaluate(n=>n instanceof HTMLInputElement?n.checked:undefined),pressed:await target.getAttribute('aria-pressed'),expanded:await target.getAttribute('aria-expanded')};}
   if(input.beforeTarget){const before=await state();events++;
    for(const key of ['checked','pressed','expanded'] as const)if(input.beforeTarget.semantic[key]!==undefined)assert.equal(before[key],key==='checked'?input.beforeTarget.semantic[key]:String(input.beforeTarget.semantic[key]));
   }
   await page.keyboard.press(chord);assert.equal(await page.evaluate(()=>document.activeElement?.id),input.target.identity);
   assert.equal(await page.getByRole(input.target.semantic.role as 'button'|'checkbox',{name:input.target.semantic.name,exact:true}).getAttribute('id'),input.target.identity);
   const after=await state();for(const key of ['checked','pressed','expanded'] as const)if(input.target.semantic[key]!==undefined)assert.equal(after[key],key==='checked'?input.target.semantic[key]:String(input.target.semantic[key]));
   if(input.target.semantic.expanded!==undefined)assert.equal(await page.locator('#collection-notes').isVisible(),input.target.semantic.expanded);
  }
  assert.equal(c.axes.exposure,'unseen');
 }finally{await page.close();}}}finally{await browser.close();}
 assert.equal(events,6);
});

test('the frozen new-UI pages, commands and browser-specific inputs remain reproducible',async()=>{
 const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');
 const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-article-transfer-2026-10-15.json',import.meta.url),'utf8'));
 const generated=generateArticleTransfer();
 for(const {html,htmlSha256,...c}of fixture.pages){assert.equal(generated.pages[c.page.slice(6,-5)],html);assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);assert.deepEqual(generated.cases.find(s=>s.id===c.id),c);}
 const inputs={safari:generated.speechInputs,chrome:generateArticleTransfer('chrome').speechInputs};
 assert.equal(createHash('sha256').update(JSON.stringify(inputs,null,2)+'\n').digest('hex'),fixture.plan.speechInputsSha256);
});
