import assert from "node:assert/strict";
import test from "node:test";
import { validateRuns } from "../src/validate.js";
import type { CaseRecord, CaseSet } from "../src/cases.js";
import { casesFingerprint } from "../src/cases.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  assert.equal(r.verdicts.missing, 3);
  assert.equal(r.verdicts.unaligned, 2);
  assert.equal(r.verdicts.unsupported, 1);
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
