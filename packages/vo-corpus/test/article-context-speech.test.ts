import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {generateArticleContextSpeech} from '../src/generate/article-context-speech.js';
test('article contrasts share commands and real focus targets, with browser-specific caller inputs',async()=>{
 const safari=generateArticleContextSpeech(),chrome=generateArticleContextSpeech('chrome');
 assert.deepEqual(chrome.pages,safari.pages);assert.deepEqual(chrome.cases,safari.cases);assert.equal(safari.cases.length,5);
 const browser=await chromium.launch({headless:true});
 try{for(const c of safari.cases){const page=await browser.newPage();try{
  await page.setContent(safari.pages[c.page.slice(6,-5)]!);await page.locator('#before').focus();
  for(const [index,chord]of c.chords.entries()){
   await page.keyboard.press(chord);const input=safari.speechInputs[c.id]![index]!;
   assert.equal(await page.evaluate(()=>document.activeElement?.id),input.target.identity);
   assert.equal(await page.locator('#'+input.target.identity).innerText(),input.target.semantic.name);
   if(input.target.containers?.length){
    const article=chrome.speechInputs[c.id]![index]!.target.containers![0]!;
    assert.equal(article.name,c.id.endsWith('explicit-name')?'Workshop actions':'');
    assert.equal(article.inferredName,!c.id.endsWith('explicit-name'));
   }
  }
 }finally{await page.close();}}}finally{await browser.close();}
});

test('the representative update suite preserves every inspected page and command sequence',async()=>{
 const {readFile}=await import('node:fs/promises'),{generateArticleEntryUpdate}=await import('../src/generate/article-context-speech.js');
 const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-article-entry-child-v2-2026-10-15.json',import.meta.url),'utf8'));
 const {planDatasetSplit,actionSequenceGroup}=await import('../src/dataset-split.js');
 const update=generateArticleEntryUpdate();
 const split=planDatasetSplit(update.cases.map(c=>({id:c.id,templateGroup:c.axes.templateGroup!,contrastGroup:c.axes.contrastGroup,actionSequenceGroup:actionSequenceGroup(c.chords),exposure:c.axes.exposure as 'calibration'})),'article-update-regression');
 assert.ok(split.groups.every(g=>g.split==='train'&&g.calibrationForced));
 assert.equal(update.cases.length,11);assert.equal(update.cases.reduce((n,c)=>n+c.chords.length,0),74);
 for(const c of update.cases){const original=fixture.pages.find((p:{id:string})=>p.id===c.axes.sourceCaseId);
  assert.ok(original);assert.equal(update.pages[c.page.slice(6,-5)],original.html);assert.deepEqual(c.chords,original.chords);assert.equal(c.axes.exposure,'calibration');assert.equal(c.axes.evaluationUse,'inspected-regression');
 }
});
