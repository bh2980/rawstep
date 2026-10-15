import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {generateCheckboxSpeech,generateCheckboxEntryTiming} from '../src/generate/checkbox-speech.js';

test('entry/timing controls reuse Native checkbox markup and preserve the original calibration group',()=>{
 const original=generateCheckboxSpeech(),followup=generateCheckboxEntryTiming();assert.equal(followup.cases.length,4);
 for(const c of followup.cases){
  const mode=c.axes.description==='inline'?'description':'plain',vo=c.axes.command==='VO+Right',inputs=followup.speechInputs[c.id]!;
  assert.equal(followup.pages[c.page.slice(6,-5)],original.pages[`native-${mode}-physical`]);
  assert.equal(c.axes.templateGroup,'checkbox-speech-v1');assert.equal(c.axes.exposure,'calibration');assert.equal(c.listen?.minWaitMs,5000);
  assert.deepEqual(c.chords,[vo?'VO+Right':'Tab','Space',vo?'VO+Left':'Shift+Tab',vo?'VO+Right':'Tab','Space']);
  assert.equal(inputs[2]!.target.identity,'before');assert.equal(inputs[2]!.target.semantic.name,'Before marker');
  assert.equal(inputs[1]!.target.semantic.checked,true);assert.equal(inputs[4]!.target.semantic.checked,false);
 }
});

test('timing reproduction keeps the captured HTML, commands, horizon and caller inputs',()=>{
 const generated=generateCheckboxEntryTiming();
 const captured=JSON.parse(readFileSync(new URL('../../../tests/fixtures/voiceover-evidence/native-checkbox-entry-timing-2026-10-15.json',import.meta.url),'utf8'));
 for(const page of captured.pages){
  const {html,htmlSha256,...scenario}=page;
  assert.equal(generated.pages[page.page.slice(6,-5)],html);
  assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);
  assert.deepEqual(generated.cases.find(c=>c.id===page.id),scenario);
 }
 assert.equal(createHash('sha256').update(JSON.stringify(generated.speechInputs,null,2)+'\n').digest('hex'),captured.plan.speechInputsSha256);
});
