import assert from 'node:assert/strict';import test from 'node:test';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {generateTableGroupHints} from '../src/generate/table-group-hints.js';
test('one-factor grouping pages and first Native hint differences remain immutable and fully accounted',async()=>{
 const f=JSON.parse(await readFile(new URL('../../../tests/fixtures/voiceover-evidence/native-table-group-hints-2026-10-16.json',import.meta.url),'utf8')),g=generateTableGroupHints();assert.equal(g.cases.length,4);assert.ok(f.acquisition.protocolClarification.includes('Tab/Shift+Tab'));
 assert.equal(createHash('sha256').update(await readFile(new URL('../src/generate/table-group-hints.ts',import.meta.url))).digest('hex'),f.plan.sourceHashes['src/generate/table-group-hints.ts']);
 for(const page of f.pages){assert.equal(g.pages[page.page.slice(6,-5)],page.html);const{html,htmlSha256,...c}=page;assert.deepEqual(g.cases.find(s=>s.id===c.id),c);assert.equal(createHash('sha256').update(html).digest('hex'),htmlSha256);assert.deepEqual(c.chords,['Tab','Tab','Shift+Tab','Tab']);}
 for(const p of f.profiles){assert.ok(Date.parse(f.ready.readyAt)<Date.parse(p.nativeStartedAt));assert.equal(p.summary.mainSpeechExact.matched,16);assert.equal(p.summary.fullSpeechExact.matched,14);assert.equal(p.summary.eligible,16);assert.equal(p.summary.tasks.planned,0);assert.equal(p.summary.fixtureHealth.passed,4);
  for(const r of p.rows){assert.equal(r.evaluation.inputVerification.status,'verified');assert.equal(r.readingTarget.status,'matched');if([0,2].includes(r.step)){assert.equal(r.evaluation.nativeHint.includes('inside of a cell'),!r.caseId.endsWith('.named-group'));}}
 }
});
