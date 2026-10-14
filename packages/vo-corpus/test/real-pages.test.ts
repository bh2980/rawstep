import assert from "node:assert/strict";
import test from "node:test";
import { publicPagePool, samplePublicPages, realPageContext, prepareRealPageScript, firstUniqueHeading, hearsHeading, nativeAccessibleText, chromiumAccessibleText, accessiblePageContext } from "../src/real-pages.js";
import { chromium } from "playwright";
import type { AxDump } from "../src/axdump.js";
import { validateRuns } from "../src/validate.js";
import type { CaseRecord, CaseSet } from "../src/cases.js";

test("public sampling is seeded, unique, fixed before collection and limited to navigation", () => {
  assert.deepEqual(samplePublicPages("one", 8), samplePublicPages("one", 8));
  assert.notDeepEqual(samplePublicPages("one", 8), samplePublicPages("two", 8));
  assert.equal(new Set(samplePublicPages("one", publicPagePool.length).map(p => p.url)).size, publicPagePool.length);
  assert.throws(() => samplePublicPages("one", 0));
  assert.throws(() => samplePublicPages("one", publicPagePool.length + 1));
});

test("live pages with different content cannot count as speech matches", () => {
  const set: CaseSet = { id: "public", generatedAt: "fixed", cases: [{ id: "page", page: "", url: publicPagePool[0].url, chords: ["VO+Right"], axes: {} }] };
  const context = (text: string) => realPageContext(JSON.stringify({ url: publicPagePool[0].url, title: "Public", width: 1000, height: 700, text: text.repeat(30) }));
  const record = (source: CaseRecord["source"], text: string): CaseRecord => ({ caseSet: set.id, caseId: "page", source, pageContext: context(text), start: { aligned: true, speech: [] }, steps: [{ chord: "VO+Right", utterances: [{ t: 0, text: "Same speech" }], reason: "quiet" }] });
  const native = new Map([["page", record("voiceover", "Original")]]);
  assert.equal(validateRuns(set, native, new Map([["page", record("simulator", "Changed")]])).verdicts.environment, 1);
  assert.equal(validateRuns(set, native, new Map([["page", record("simulator", "Original")]])).all.rate, 1);
});

test("public-page harness preserves original content and handlers, adds stable markers, and records rendered text", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.route("https://example.test/article", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><title>Example article</title><main><h1>Article</h1><p>' + 'Read accessible navigation. '.repeat(10) + '</p><button id="original" onclick="this.textContent=\'Changed\'">Original</button></main>' }));
    await page.goto("https://example.test/article");
    const first = realPageContext(await page.evaluate(prepareRealPageScript));
    assert.equal(first.width, 1000); assert.equal(first.height, 700);
    assert.equal(first.url, "https://example.test/article");
    assert.match(first.contentText!, /Article Read accessible navigation/);
    assert.equal(await page.locator('[data-vo-corpus-marker]').count(), 2);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "vo-corpus-public-before");
    const again = realPageContext(await page.evaluate(prepareRealPageScript));
    assert.equal(again.contentSha256, first.contentSha256);
    assert.equal(await page.locator('[data-vo-corpus-marker]').count(), 2);
    await page.locator("#original").click();
    assert.equal(await page.locator("#original").innerText(), "Changed");
    assert.notEqual(realPageContext(await page.evaluate(prepareRealPageScript)).contentSha256, first.contentSha256);
    await page.locator('#vo-corpus-public-before').evaluate(node => node.removeAttribute('data-vo-corpus-marker'));
    await assert.rejects(page.evaluate(prepareRealPageScript), /marker ID collision/);
  } finally { await browser.close(); }
});

test("natural anchors are unique native headings and alignment uses heard heading speech", () => {
  const dump = { truncated:false, root:{children:[
    {AXRole:"AXHeading",AXARIALevel:2,children:[{AXRole:"AXStaticText",AXValue:"Repeated"}]},
    {AXRole:"AXHeading",AXARIALevel:1,children:[{AXRole:"AXStaticText",AXValue:"Article title"}]},
    {AXRole:"AXHeading",AXARIALevel:2,children:[{AXRole:"AXStaticText",AXValue:"Repeated"}]},
  ]} } as AxDump;
  const anchor = firstUniqueHeading(dump);
  assert.deepEqual(anchor,{name:"Article title",level:1});
  assert.equal(hearsHeading(["heading, level 1, Article title"],anchor),true);
  assert.equal(hearsHeading(["heading level 1 Article title extension"],anchor),false);
  assert.equal(hearsHeading(["heading level 2 Article title"],anchor),false);
  assert.equal(hearsHeading(["Article title"],anchor),false);
  assert.equal(hearsHeading(["You are currently on a heading Article title level 1"],anchor),false);
  assert.throws(()=>firstUniqueHeading({...dump,truncated:true}),/truncated/);
  assert.throws(()=>firstUniqueHeading({...dump,stringTruncations:1}),/truncated/);
});

test("AX-content fingerprints tolerate inline text splitting without dropping words", () => {
  const sentence = "Accessible content with meaningful words. ".repeat(5);
  const native = nativeAccessibleText({AXRole:"AXWebArea",children:[{AXRole:"AXStaticText",AXValue:sentence},{AXRole:"AXLink",AXTitle:"Read more"}]});
  const chrome = chromiumAccessibleText([
    {nodeId:"root",ignored:false,role:{value:"RootWebArea"},childIds:["text1","text2","link"]},
    {nodeId:"text1",parentId:"root",ignored:false,role:{value:"StaticText"},name:{value:sentence.slice(0,20)}},
    {nodeId:"text2",parentId:"root",ignored:false,role:{value:"StaticText"},name:{value:sentence.slice(20)}},
    {nodeId:"link",parentId:"root",ignored:false,role:{value:"link"},name:{value:"Read more"},childIds:["duplicate"]},
    {nodeId:"duplicate",parentId:"link",ignored:false,role:{value:"StaticText"},name:{value:"Read more"}},
  ]);
  const info={url:"https://example.test/page",title:"Article",width:1000,height:700};
  assert.equal(accessiblePageContext(native,info).contentSha256,accessiblePageContext(chrome,info).contentSha256);
  assert.notEqual(accessiblePageContext(native,info).contentSha256,accessiblePageContext(chrome+"another word",info).contentSha256);
});
