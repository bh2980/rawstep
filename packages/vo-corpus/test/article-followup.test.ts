import assert from 'node:assert/strict';
import test from 'node:test';
import {generateArticleFollowup} from '../src/generate/article-followup.js';

test('article followups and transfer scenarios have constant titles and disjoint frozen input groups',()=>{
  const train=generateArticleFollowup('train'),heldout=generateArticleFollowup('test');
  assert.equal(train.cases.length,12);assert.equal(heldout.cases.length,8);
  const groups=new Set(train.cases.map(c=>c.axes.templateGroup));
  assert.ok(heldout.cases.every(c=>!groups.has(c.axes.templateGroup)&&c.axes.partition==='test'));
  for(const set of [train,heldout])for(const c of set.cases){
    const html=set.pages[c.page.slice(6,-5)]!;
    assert.match(html,/<title>Coastal reading experiment<\/title>/);
    assert.ok(c.captureAxAfterSteps);
    assert.ok(!html.includes(c.id));
  }
});
