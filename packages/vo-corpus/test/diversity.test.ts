import assert from "node:assert/strict";
import test from "node:test";
import { generateDiversity } from "../src/generate/diversity.js";

test("diversity questions keep ten controlled pairs together and distinguish defects from measured outcomes",()=>{
  const {pages,cases}=generateDiversity();
  assert.equal(cases.length,20);assert.equal(Object.keys(pages).length,20);
  const groups=new Map<string,typeof cases>();
  for(const c of cases){const key=c.axes.contrastGroup!,members=groups.get(key)??[];members.push(c);groups.set(key,members);assert.ok(c.captureAxAfterSteps);}
  assert.equal(groups.size,10);
  for(const pair of groups.values()){
    assert.equal(pair.length,2);assert.equal(new Set(pair.map(c=>c.axes.partition)).size,1);
    assert.equal(new Set(pair.map(c=>c.axes.contrastFactor)).size,1);assert.equal(new Set(pair.map(c=>c.axes.contrastValue)).size,2);
  }
  assert.ok(cases.some(c=>c.axes.partition==='test'));assert.ok(cases.some(c=>c.axes.partition==='validation'));
  assert.equal(cases.filter(c=>c.axes.defect!=='none').length,5);
  for(const c of cases.filter(c=>c.axes.family.endsWith('live')))assert.equal(c.listen?.minWaitMs,1100);
  assert.deepEqual(generateDiversity(),{pages,cases});
});
