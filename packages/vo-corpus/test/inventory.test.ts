import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventory } from "../src/inventory.js";

test("native inventory separates repeats, hints, markers, model outputs and actually saved AX files",async()=>{
  const root=await mkdtemp(join(tmpdir(),"vo-inventory-"));
  try {
    const record={caseSet:"questions",caseId:"link",source:"voiceover",start:{aligned:true,speech:["Ignored startup"]},steps:[
      {chord:"VO+Right",axPath:"ax.json",utterances:[{text:"link, Harbor."},{text:"You are currently on a link."}]},
      {chord:"VO+Right",axPath:"missing.json",utterances:[{text:"After marker button"},{text:"After marker 버튼"},{text:" "}]},
    ]};
    for (const id of ["a","b","model"]) {
      const dir=join(root,id);await mkdir(dir);
      await writeFile(join(dir,"records.jsonl"),JSON.stringify({...record,...(id==='model'?{source:"simulator"}:{})})+'\n'+(id==='b'?'partial':''));
      await writeFile(join(dir,"ax.json"),'{}');
    }
    assert.deepEqual(await inventory(root),{nativeRuns:2,caseRecords:2,alignedCaseRecords:2,distinctCaseKeys:1,
      steps:4,utteranceEvents:8,hintEvents:2,markerEvents:4,contentEvents:2,distinctNormalizedContentTexts:1,
      stepsWithAx:2,missingAxFiles:2,incompleteLines:1});
  } finally {await rm(root,{recursive:true,force:true});}
});
