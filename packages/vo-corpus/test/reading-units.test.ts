import assert from 'node:assert/strict';
import test from 'node:test';
import {generateReadingUnits,generateReadingReturns,generateReadingState,generateFocusContext,generateListboxInteraction} from '../src/generate/reading-units.js';
import {planDatasetSplit} from '../src/dataset-split.js';

test('reading-unit contrasts stay grouped and reserved compositions contain no variant titles',()=>{
  const train=generateReadingUnits('train'),heldout=generateReadingUnits('test');
  assert.equal(train.cases.length,20);assert.equal(heldout.cases.length,8);
  const all=[...train.cases,...heldout.cases],split=planDatasetSplit(all.map(c=>({id:c.id,templateGroup:c.axes.templateGroup!,contrastGroup:c.axes.contrastGroup,exposure:c.axes.exposure as 'calibration'|'unseen',fixedSplit:c.axes.partition as 'train'|'test'})),'fixed');
  assert.equal(split.groups.find(g=>g.members.includes('reading-units-v1.wrap-checkbox-before'))!.members.length,2);
  assert.equal(split.groups.find(g=>g.members.includes('reading-units-v1.cell-text'))!.members.length,4);
  for(const set of [train,heldout])for(const c of set.cases){assert.ok(c.captureAxAfterSteps);assert.match(set.pages[c.page.slice(6,-5)]!,/<title>Coastal interface study<\/title>/);assert.ok(c.chords.length>=4);}
  assert.ok(heldout.cases.every(c=>c.axes.partition==='test'&&!c.axes.contrastGroup));
});

test('reverse/action followups share the original input groups and preserve original HTML when unchanged',()=>{
  const parent=generateReadingUnits('train'),followup=generateReadingReturns();
  assert.equal(followup.cases.length,4);
  const c=followup.cases.find(c=>c.id.endsWith('two-buttons-return'))!;
  assert.equal(c.axes.templateGroup,'reading-units-v1.cell-two-buttons');
  assert.equal(followup.pages['two-buttons-return'],parent.pages['cell-two-buttons']);
  assert.ok(followup.cases.every(c=>c.axes.partition==='train'&&c.axes.exposure==='calibration'));
  assert.match(followup.pages['button-activation']!,/role="status"/);
});

test('state contrasts are reproducible and change only the stated input or activation gesture',()=>{
  const a=generateReadingState(),b=generateReadingState();
  assert.deepEqual(a,b);
  assert.equal(a.cases.length,4);
  assert.equal(a.pages['radio-anonymous'],a.pages['radio-named']!.replace(' name="choice"',''));
  assert.equal(a.pages['checkbox-vo'],a.pages['checkbox-physical']);
  const vo=a.cases.find(c=>c.id.endsWith('checkbox-vo'))!,physical=a.cases.find(c=>c.id.endsWith('checkbox-physical'))!;
  assert.deepEqual(vo.chords.map(k=>k==='VO+Space'?'Space':k),physical.chords);
  assert.equal(vo.axes.templateGroup,physical.axes.templateGroup);
  assert.equal(vo.axes.contrastGroup,physical.axes.contrastGroup);
  assert.ok(a.cases.every(c=>c.captureAxAfterSteps&&c.axes.exposure==='calibration'));
});

test('focus-entry experiments share input identity across entry commands and retain calibration groups',()=>{
  const set=generateFocusContext(),units=generateReadingUnits('train');
  assert.equal(set.cases.length,8);
  assert.equal(set.pages['aria-tab'],set.pages['aria-vo']);
  assert.equal(set.pages['external-tab'],set.pages['external-vo']);
  assert.equal(set.pages['prefilled-tab'],set.pages['prefilled-vo']);
  assert.equal(set.pages['typed-return-end'],units.pages['cell-input']);
  assert.ok(set.cases.every(c=>c.axes.partition==='train'&&c.axes.exposure==='calibration'));
});

test('composite interaction contrasts retain identical input bytes and one connected calibration group',()=>{
  const set=generateListboxInteraction();
  for(const variant of ['native','aria-single','aria-none','aria-multiple']){
    assert.equal(set.pages[`${variant}-outer`],set.pages[`${variant}-interact`]);
    const pair=set.cases.filter(c=>c.axes.state===variant);
    assert.equal(pair.length,2);
    assert.equal(pair[0]!.axes.templateGroup,pair[1]!.axes.templateGroup);
  }
  assert.equal(set.pages['aria-none-outer']!.replaceAll('aria-selected="false"','aria-selected="?"'),set.pages['aria-single-outer']!.replaceAll(/aria-selected="(?:true|false)"/g,'aria-selected="?"'));
  const split=planDatasetSplit(set.cases.map(c=>({id:c.id,templateGroup:c.axes.templateGroup!,contrastGroup:c.axes.contrastGroup,exposure:'calibration' as const,fixedSplit:'train' as const})),'fixed');
  assert.equal(split.groups.length,1);
  assert.equal(split.groups[0]!.members.length,8);
  assert.ok(set.cases.every(c=>c.captureAxAfterSteps&&c.axes.partition==='train'));
});
