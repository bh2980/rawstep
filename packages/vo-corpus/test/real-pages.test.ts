import assert from "node:assert/strict";
import test from "node:test";
import { publicPagePool, samplePublicPages, realPageContext, prepareRealPageScript, publicPageScript, firstUniqueHeading, hearsHeading, nativeAccessibleText, chromiumAccessibleText, accessiblePageContext } from "../src/real-pages.js";
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

test("DOM fingerprinting preserves semantic attributes, visible state and public control values while excluding passwords", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.route("https://example.test/dom", route => route.fulfill({contentType:"text/html",body:'<!doctype html><title>DOM protocol</title><p>'+"Public content words. ".repeat(10)+'</p><button aria-label="Original">Action</button><input aria-label="Query"><input type="password" value="secret-password"><input type="hidden" value="csrf-secret"><div id="optional">Optional</div>'}));
    await page.goto("https://example.test/dom");
    const capture = async () => realPageContext(await page.evaluate(publicPageScript("visible-dom-v1")),publicPageScript("visible-dom-v1"));
    const first = await capture();
    assert.equal(first.contentSource,"visible-dom-v1");
    assert.equal(await page.locator('#vo-corpus-public-before').evaluate(node=>getComputedStyle(node).position),'fixed');
    assert.ok(first.domSnapshot && !first.domSnapshot.includes("secret-password"));
    assert.ok(!first.domSnapshot.includes("csrf-secret"));
    assert.match(first.harnessSha256!,/^[a-f0-9]{64}$/);
    assert.equal((await capture()).contentSha256,first.contentSha256);
    await page.locator('button[aria-label="Original"]').evaluate(node => node.setAttribute('aria-label','Changed'));
    const label = await capture();
    assert.notEqual(label.contentSha256,first.contentSha256);
    assert.equal(label.renderedTextSha256,first.renderedTextSha256);
    await page.getByRole('textbox',{name:'Query',exact:true}).fill('new query');
    const value = await capture();
    assert.notEqual(value.contentSha256,label.contentSha256);
    assert.equal(value.renderedTextSha256,label.renderedTextSha256);
    await page.addStyleTag({content:'#optional{display:none}'});
    assert.notEqual((await capture()).contentSha256,value.contentSha256);
  } finally {await browser.close();}
});

test("DOM protocol retains rendered-text differences and cannot silently fall back to the old protocol", () => {
  const base={url:"https://example.test/page",title:"Public",width:1000,height:700,contentSource:"visible-dom-v1",domSnapshot:JSON.stringify(['body',[],['text','PrivacyAbout'.repeat(12)]])};
  const a=realPageContext(JSON.stringify({...base,text:"PrivacyAbout ".repeat(12)}),publicPageScript("visible-dom-v1")),b=realPageContext(JSON.stringify({...base,text:"Privacy About ".repeat(12)}),publicPageScript("visible-dom-v1"));
  assert.equal(a.contentSha256,b.contentSha256);
  assert.notEqual(a.renderedTextSha256,b.renderedTextSha256);
  assert.throws(()=>realPageContext(JSON.stringify({...base,domSnapshot:undefined,text:"Public ".repeat(30)})),/fingerprint input/);
  const set:CaseSet={id:"dom",generatedAt:"fixed",cases:[{id:"page",page:"",url:base.url,contentProtocol:"visible-dom-v1",chords:["VO+Right"],axes:{}}]};
  const record=(source:CaseRecord['source'],pageContext:typeof a):CaseRecord=>({caseSet:set.id,caseId:"page",source,pageContext,start:{aligned:true,speech:[]},steps:[{chord:"VO+Right",utterances:[{t:0,text:"Same"}],reason:"quiet"}]});
  const old=realPageContext(JSON.stringify({...base,contentSource:undefined,text:"Public ".repeat(30)}));
  assert.equal(validateRuns(set,new Map([["page",record("voiceover",old)]]),new Map([["page",record("simulator",old)]])).verdicts.environment,1);
  assert.equal(validateRuns(set,new Map([["page",record("voiceover",a)]]),new Map([["page",record("simulator",b)]])).all.rate,1);
  assert.equal(validateRuns(set,new Map([["page",record("voiceover",a)]]),new Map([["page",record("simulator",{...b,harnessSha256:"changed"})]])).verdicts.environment,1);
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
