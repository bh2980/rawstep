import assert from "node:assert/strict";
import test from "node:test";
import { validateRuns } from "../src/validate.js";
import type { CaseRecord, CaseSet } from "../src/cases.js";
import { casesFingerprint, plannedCaseSet } from "../src/cases.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test('matching words from a window that changed front application do not pass native validation',()=>{
  const set:CaseSet={id:'browser-profile',generatedAt:'fixed',cases:[{id:'one',page:'one.html',chords:['VO+Right'],axes:{}}]};
  const native:CaseRecord={caseSet:set.id,caseId:'one',source:'voiceover',start:{aligned:true,speech:[]},steps:[{chord:'VO+Right',reason:'quiet',foregroundError:'Safari is in front of Chrome',utterances:[{t:1,text:'Same words'}]}]};
  const model:CaseRecord={...native,source:'simulator',steps:[{chord:'VO+Right',reason:'quiet',utterances:[{t:1,text:'Same words'}]}]};
  const report=validateRuns(set,new Map([['one',native]]),new Map([['one',model]]));
  assert.equal(report.all.matched,0);assert.equal(report.verdicts.environment,1);assert.equal(report.fullSpeech.matched,0);
});

test("validation includes every planned failure and separates markers, silence and hints", () => {
  const set: CaseSet = { id: "test", generatedAt: "fixed", cases: ["ok", "unsupported", "missing", "unaligned", "short"].map(id => ({ id, page: "test.html", chords: ["Tab", "Enter"], axes: { family: id } })) };
  const record = (id: string, source: CaseRecord["source"]): CaseRecord => ({ caseSet: set.id, caseId: id, source, start: { aligned: true, speech: [] }, steps: [
    { chord: "Tab", reason: "quiet", utterances: [{ t: 0, text: "After marker button" }] },
    { chord: "Enter", reason: "quiet", utterances: [] },
  ] });
  const native = new Map(set.cases.map(c => [c.id, record(c.id, "voiceover")])), simulator = new Map(set.cases.map(c => [c.id, record(c.id, "simulator")]));
  native.get("ok")!.steps[1]!.utterances = [{ t: 0, text: "Saved button" }, { t: 1, text: "You are currently on a button." }];
  simulator.get("ok")!.steps[1]!.utterances = [{ t: 0, text: "Saved, button" }];
  simulator.get("unsupported")!.steps[1]!.reason = "unsupported";
  simulator.delete("missing");
  simulator.get("unaligned")!.start.aligned = false;
  simulator.get("short")!.steps.pop();
  const r = validateRuns(set, native, simulator);
  assert.equal(r.rows.length, 10);
  assert.equal(r.all.matched, 4); // three markers and one content receipt
  assert.equal(r.content.planned, 5);
  assert.equal(r.content.matched, 1);
  assert.equal(r.fullSpeech.matched, 3); // absent hint remains a full-speech failure
  assert.deepEqual(r.contentFullSpeech,{matched:0,planned:5,rate:0}); // repeated harness markers cannot raise this rate
  assert.equal(r.verdicts.missing, 3);
  assert.equal(r.verdicts.unaligned, 2);
  assert.equal(r.verdicts.unsupported, 1);
  assert.deepEqual(r.conditionalSpeech, {matched:4,planned:4,rate:1});
  assert.equal(r.funnel.plannedActions,10);
  assert.equal(r.funnel.nativeRecordedActions,10);
  assert.equal(r.funnel.sameDeclaredActions,7);
  assert.equal(r.funnel.inputEquivalenceVerifiedActions,null);
  assert.equal(r.evaluation.navigationAccuracy.rate,null);
  assert.equal(r.evaluation.stateAccuracy.rate,null);
  assert.equal(r.evaluation.taskSuccess.rate,null);
  assert.equal(r.evaluation.thresholdAchievement,'unproven');
});

test("missing native steps do not become silent matches or disappear from content", () => {
  const set: CaseSet = { id: "x", generatedAt: "fixed", cases: [{ id: "absent", page: "x", chords: ["Tab"], axes: {} }] };
  const r = validateRuns(set, new Map(), new Map());
  assert.deepEqual(r.all, { matched: 0, planned: 1, rate: 0 });
  assert.equal(r.content.planned, 1);
  assert.equal(r.spoken.planned, 1);
  assert.equal(r.silent.planned, 0);
});

test("fixture fingerprints change when page bytes change without regenerating metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(),"vo-case-integrity-"));
  try {
    const set: CaseSet={id:"fixed",generatedAt:"fixed",cases:[{id:"one",page:"one.html",chords:["Tab"],axes:{}}]};
    await writeFile(join(directory,"cases.json"),JSON.stringify(set));
    await writeFile(join(directory,"one.html"),"<button>One</button>");
    const before=await casesFingerprint(directory,set);
    assert.equal(await casesFingerprint(directory,set),before);
    await writeFile(join(directory,"one.html"),"<button>Two</button>");
    assert.notEqual(await casesFingerprint(directory,set),before);
  } finally {await rm(directory,{recursive:true,force:true});}
});


test('a matching late hint is retained raw but cannot pass as certain command speech',()=>{
  const set:CaseSet={id:'late',generatedAt:'fixed',cases:[{id:'a',page:'a.html',chords:['VO+Right'],axes:{}}]};
  const step:CaseRecord['steps'][number]={chord:'VO+Right',reason:'quiet',timing:{requestedAt:100,acknowledgedAt:110,observationStartedAt:110,observationEndedAt:200,requestClock:'wire-request-v1'},utterances:[{t:150,text:'Save button'},{t:250,text:'You are currently on a button.'}]};
  const native:CaseRecord={caseSet:set.id,caseId:'a',source:'voiceover',start:{aligned:true,speech:[]},steps:[step]};
  const model:CaseRecord={...native,source:'simulator'};
  const original=JSON.stringify(native),report=validateRuns(set,new Map([['a',native]]),new Map([['a',model]]));
  assert.equal(report.verdicts.attribution,1);
  assert.equal(report.all.matched,0);
  assert.equal(report.fullSpeech.matched,0);
  assert.equal(report.all.planned,1);
  assert.equal(report.conditionalSpeech.planned,0);
  assert.equal(report.funnel.nativeAttribution.uncertain,1);
  assert.equal(JSON.stringify(native),original);
});


test('a frozen input subset changes the planned scope before execution and retains absent planned cases',()=>{
  const set:CaseSet={id:'subset',generatedAt:'fixed',cases:['a','b','c'].map(id=>({id,page:id+'.html',chords:['Tab'],axes:{}}))};
  const subset=plannedCaseSet(set,['a','b']);
  assert.deepEqual(subset.cases.map(c=>c.id),['a','b']);
  assert.equal(validateRuns(subset,new Map(),new Map()).all.planned,2);
  assert.equal(plannedCaseSet(set),set);
  assert.throws(()=>plannedCaseSet(set,['a','unknown']),/frozen capture/);
  assert.throws(()=>plannedCaseSet(set,['a','a']),/frozen capture/);
  assert.throws(()=>plannedCaseSet(set,'a'),/frozen capture/);
});


test('Full Speech Exact retains punctuation, case, repetitions and hint order independently of normalized speech',()=>{
  const set:CaseSet={id:'full',generatedAt:'fixed',cases:[{id:'a',page:'a.html',chords:['Tab','Tab'],axes:{}}]};
  const native:CaseRecord={caseSet:set.id,caseId:'a',source:'voiceover',start:{aligned:true,speech:[]},steps:[{chord:'Tab',reason:'quiet',utterances:[{t:1,text:'Save, button'}]},{chord:'Tab',reason:'quiet',utterances:[{t:2,text:'Save button'},{t:3,text:'Save button'},{t:4,text:'You are currently on a button.'}]}]};
  const model=structuredClone(native);model.source='simulator';model.steps[0]!.utterances[0]!.text='save button';
  const report=validateRuns(set,new Map([['a',native]]),new Map([['a',model]]));
  assert.equal(report.all.matched,2);
  assert.equal(report.fullSpeech.matched,2);
  assert.equal(report.fullSpeechExact.matched,1);
  model.steps[1]!.utterances.reverse();
  assert.equal(validateRuns(set,new Map([['a',native]]),new Map([['a',model]])).fullSpeechExact.matched,0);
  model.steps[1]!.utterances.pop();
  assert.equal(validateRuns(set,new Map([['a',native]]),new Map([['a',model]])).all.matched,1);
});
