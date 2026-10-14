import assert from 'node:assert/strict';
import test from 'node:test';
import {generateHints} from '../src/generate/hints.js';

test('hint experiments preserve observation time, histories and separately authored transfer compositions',()=>{
  const train=generateHints('train'),heldout=generateHints('test');
  assert.equal(train.cases.length,20);assert.equal(heldout.cases.length,8);
  const groups=new Set(train.cases.map(c=>c.axes.templateGroup));
  for(const c of heldout.cases)assert.ok(!groups.has(c.axes.templateGroup)&&c.axes.partition==='test');
  for(const set of [train,heldout])for(const c of set.cases){
    assert.ok(c.captureAxAfterSteps&&c.listen!.minWaitMs!>=1000);
    assert.ok(c.chords.length>=5);
    const html=set.pages[c.page.slice(6,-5)]!;
    assert.match(html,/<title>Harbor interaction study<\/title>/);assert.ok(!html.includes(c.id));
  }
});
