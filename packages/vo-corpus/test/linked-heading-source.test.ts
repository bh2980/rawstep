import assert from 'node:assert/strict';
import test from 'node:test';
import {generateLinkedHeadingSource} from '../src/generate/linked-heading-source.js';
import {generateLinkedHeadingTransfer} from '../src/generate/linked-heading-transfer.js';
import {actionSequenceGroup} from '../src/dataset-split.js';

test('linked-heading calibration preserves controls, one name and a nonempty health oracle',()=>{
 const generated=generateLinkedHeadingSource();assert.equal(generated.cases.length,4);
 assert.equal(generated.cases.reduce((n,c)=>n+c.chords.length,0),12);
 for(const c of generated.cases){
  assert.deepEqual(c.chords,['VO+Right','VO+Left','VO+Right']);assert.deepEqual(generated.targetIds[c.id],['first','before','first']);
  assert.equal(c.axes.exposure,'calibration');assert.ok(c.taskOutcome!.controls.length||c.taskOutcome!.texts.length);
  const html=generated.pages[c.page.slice(6,-5)]!;assert.equal((html.match(/Harbor itinerary/g)??[]).length,1);
 }
 assert.ok(generated.pages['link-outside']!.includes('<a id=first href="#after"><h2 id=heading>'));
 assert.ok(generated.pages['heading-outside']!.includes('<h2 id=heading><a id=first href="#after">'));
});

test('reserved wrapper compositions retain reverse entry and whole histories outside calibration',()=>{
 const train=generateLinkedHeadingSource(),transfer=generateLinkedHeadingTransfer();
 const histories=new Set(train.cases.map(c=>actionSequenceGroup(c.chords)));
 assert.equal(transfer.cases.length,2);
 for(const c of transfer.cases){assert.equal(histories.has(actionSequenceGroup(c.chords)),false);assert.equal(c.axes.exposure,'unseen');assert.equal(c.axes.oraclePurpose,'fixture-health');assert.deepEqual(transfer.targetIds[c.id],['first','after','first','before','first','after','first']);}
});
