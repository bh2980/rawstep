import assert from "node:assert/strict";
import test from "node:test";
import { generateListHeuristics } from "../src/generate/list-heuristics.js";

test("list detection questions cross HTML kind, navigation context and explicit role",()=>{
  const {pages,cases}=generateListHeuristics();
  assert.equal(cases.length,8);
  assert.equal(new Set(cases.map(c=>[c.axes.role,c.axes.context,c.axes.explicitRole].join('/'))).size,8);
  for(const c of cases){
    const page=pages[c.page.slice(6,-5)]!;
    assert.match(page,/list-style:none/);
    assert.equal(page.includes('role="list"'),c.axes.explicitRole==='true');
    assert.equal(page.includes('<nav'),c.axes.context==='navigation');
    assert.equal(c.chords.length,8);
    assert.equal(c.captureAxAfterSteps,true);
  }
});
