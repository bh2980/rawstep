/** Inventory raw native workflow observations, never simulator outputs or page-load/start receipts. */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CaseRecord } from "./cases.js";
import { normalize, splitSpeech } from "./compare.js";

export async function inventory(runsDir: string) {
  const result = { nativeRuns: 0, caseRecords: 0, alignedCaseRecords: 0, distinctCaseKeys: 0,
    steps: 0, utteranceEvents: 0, hintEvents: 0, markerEvents: 0, contentEvents: 0,
    distinctNormalizedContentTexts: 0, stepsWithAx: 0, missingAxFiles: 0, incompleteLines: 0 };
  const cases = new Set<string>(), texts = new Set<string>();
  for (const entry of await readdir(runsDir, {withFileTypes:true})) {
    if (!entry.isDirectory()) continue;
    const dir = join(runsDir,entry.name);
    const lines = await readFile(join(dir,"records.jsonl"),"utf8").catch(error=>{
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    let native = false;
    for (const line of lines.split("\n").filter(Boolean)) {
      let record: CaseRecord;
      try { record = JSON.parse(line) as CaseRecord; }
      catch { result.incompleteLines++; continue; }
      if (record.source !== "voiceover") continue;
      native = true; result.caseRecords++;
      if (record.start.aligned) result.alignedCaseRecords++;
      cases.add(JSON.stringify([record.caseSet,record.caseId]));
      for (const step of record.steps) {
        result.steps++;
        if (step.axPath) {
          const exists = await stat(join(dir,step.axPath)).then(s=>s.isFile(),()=>false);
          if (exists) result.stepsWithAx++; else result.missingAxFiles++;
        }
        for (const utterance of step.utterances) {
          if (!utterance.text.trim()) continue;
          result.utteranceEvents++;
          const {main,hint} = splitSpeech([utterance]);
          if (hint) { result.hintEvents++; continue; }
          const normalized = normalize(main);
          if (/^(before|after) marker (button|버튼)$/.test(normalized)) { result.markerEvents++; continue; }
          result.contentEvents++; texts.add(normalized);
        }
      }
    }
    if (native) result.nativeRuns++;
  }
  result.distinctCaseKeys = cases.size; result.distinctNormalizedContentTexts = texts.size;
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(JSON.stringify({sampledAt:new Date().toISOString(),...await inventory(resolve(process.argv[2] ?? "data/runs")),
    note:"Raw archive counts include repeat runs, languages, calibration/validation sets and failed starts. They are not quality-approved independent training examples. Case keys include collection protocol variants; identical speech may arise from different input states."},null,2));
}
