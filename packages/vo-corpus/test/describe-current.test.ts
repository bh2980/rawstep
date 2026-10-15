import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {generateDescribeCurrent} from '../src/generate/describe-current.js';

test('current-description calibration preserves the target and records its reused groups',async()=>{
 const {cases,pages,speechInputs}=generateDescribeCurrent();assert.equal(cases.length,8);
 const browser=await chromium.launch({headless:true});
 try{for(const c of cases){
  assert.equal(c.axes.exposure,'calibration');assert.equal(c.axes.partition,'train');
  assert.equal(c.captureAxAfterSteps,true);assert.deepEqual(c.chords.slice(1),['VO+F3']);
  const [entry,current]=speechInputs[c.id]!;assert.equal(current!.command,'read_current');
  assert.deepEqual(entry!.target,current!.target);
  const page=await browser.newPage();
  try{
   await page.setContent(pages[c.page.slice(6,-5)]!);
   const target=page.locator('#target');assert.equal(await page.getByRole(entry!.target.semantic.role as 'button'|'checkbox'|'link'|'heading',{name:entry!.target.semantic.name,exact:true}).getAttribute('id'),'target');
   if(c.chords[0]==='Tab'){await page.locator('#before').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.id),'target');}
   for(const attribute of ['pressed','expanded'] as const)assert.equal(await target.getAttribute('aria-'+attribute),entry!.target.semantic[attribute]===undefined?null:String(entry!.target.semantic[attribute]));
   if(entry!.target.semantic.description)assert.equal(await page.locator('#'+await target.getAttribute('aria-describedby')).textContent(),entry!.target.semantic.description);
  }finally{await page.close();}
 }}finally{await browser.close();}
});

test('the calibration generator reproduces the frozen candidate inputs without relabeling F3 as navigation',()=>{
 const generated=generateDescribeCurrent(),fixture=JSON.parse(readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-describe-current-2026-10-15.json',import.meta.url),'utf8'));
 for(const {html,htmlSha256,...scenario} of fixture.pages){
  assert.equal(generated.pages[scenario.page.slice(6,-5)],html);assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);
  assert.deepEqual(generated.cases.find(c=>c.id===scenario.id),scenario);
 }
 assert.equal(createHash('sha256').update(JSON.stringify(generated.speechInputs,null,2)+'\n').digest('hex'),fixture.plan.speechInputsSha256);
 for(const profile of fixture.profiles){
  assert.equal(profile.summary.planned,16);assert.equal(profile.summary.nativeObserved,16);
  for(const row of profile.rows.filter(r=>r.step===1))assert.match(row.utterances[0].text,/ is in the VoiceOver cursor\s*$/);
 }
});
