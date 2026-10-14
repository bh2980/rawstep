import assert from "node:assert/strict";
import test from "node:test";
import { generateArticlePatterns } from "../src/generate/article-patterns.js";

test("linked heading questions distinguish nesting, partial links, articles, jumps and activation",()=>{
  const {pages,cases}=generateArticlePatterns();
  assert.equal(cases.length,12);
  assert.equal(new Set(cases.map(c=>c.id)).size,12);
  assert.match(pages['heading-inside']!,/<h2><a /);
  assert.match(pages['heading-outside']!,/<a [^>]+><h2>/);
  assert.match(pages['heading-partial']!,/<h2>Harbor <a /);
  assert.match(pages['article-labelled']!,/aria-labelledby="card-title"/);
  for(const c of cases){
    assert.equal(c.captureAxAfterSteps,true);
    assert.ok(pages[c.page.slice(6,-5)]);
    if(c.axes.family==='linked-heading-activation') assert.deepEqual(c.chords,["VO+Cmd+H","VO+Space","VO+Right","VO+Left"]);
  }
});
