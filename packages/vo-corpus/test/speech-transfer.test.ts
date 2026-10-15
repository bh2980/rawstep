import assert from 'node:assert/strict';
import test from 'node:test';
import {generateSpeechTransfer} from '../src/generate/speech-transfer.js';
import {actionSequenceGroup,planDatasetSplit} from '../src/dataset-split.js';
test('transfer inputs keep state changes, return histories and independent groups explicit',()=>{
 const {cases,speechInputs,pages}=generateSpeechTransfer();
 const sequences=new Set(cases.map(c=>actionSequenceGroup(c.chords)));assert.equal(sequences.size,2);
 for(const c of cases){
  assert.equal(c.axes.exposure,'unseen');assert.equal(c.axes.partition,'test');assert.equal(c.chords.length,speechInputs[c.id]!.length);
  const rows=speechInputs[c.id]!;assert.ok(rows.some(r=>r.target.semantic.help));assert.ok(rows.some(r=>r.target.semantic.description));assert.ok(rows.some(r=>r.target.containers!.length>=3));
  for(const [i,r]of rows.entries())if(r.checkedStateChanged){assert.ok(i>0);assert.equal(rows[i-1]!.target.identity,r.target.identity);assert.equal(rows[i-1]!.target.semantic.checked,!r.target.semantic.checked);assert.equal(c.chords[i],'Space');}
  assert.ok(Object.values(pages).every(p=>!p.includes(c.id)));
 }
 const split=planDatasetSplit(cases.map(c=>({id:c.id,templateGroup:c.axes.templateGroup!,siteGroup:c.axes.siteGroup,actionSequenceGroup:actionSequenceGroup(c.chords),exposure:'unseen' as const,fixedSplit:'test' as const})),'transfer');
 assert.ok(split.groups.every(g=>g.split==='test'));
});

test('regenerated HTML, commands and caller inputs stay identical to the archived Native experiment',async()=>{
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-speech-transfer-2026-10-15.json',import.meta.url),'utf8')) as {pages:{id:string;chords:string[];html:string}[];profiles:{rows:{caseId:string;input:unknown}[]}[]};
 const generated=generateSpeechTransfer();
 for(const c of generated.cases){
  const archived=fixture.pages.find(p=>p.id===c.id)!;assert.deepEqual(c.chords,archived.chords);assert.equal(generated.pages[c.page.slice(6,-5)],archived.html);
  assert.deepEqual(generated.speechInputs[c.id],fixture.profiles[0]!.rows.filter(r=>r.caseId===c.id).map(r=>r.input));
 }
});
