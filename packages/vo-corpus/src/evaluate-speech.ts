/** Evaluate a frozen caller-input speech experiment; never opens a browser or changes native observations. */
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {VoiceOverSpeechInput,VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
import {casesFingerprint,type CaseSet,type CaseRecord} from './cases.js';
import type {AxDump} from './axdump.js';
import {checkSpeechInput} from './speech-input.js';
import {evaluateSpeechCandidate,summarizeSpeechCandidates} from './speech-evaluation.js';

const [planArg,nativeArg,outArg,...extra]=process.argv.slice(2);
if(!planArg||!nativeArg||!outArg||extra.length)throw new Error('Usage: evaluate-speech.ts <frozen plan directory> <native run directory> <new output directory>');
const planDir=resolve(planArg),nativeDir=resolve(nativeArg),out=resolve(outArg);
const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const plan=await json(join(planDir,'plan.json')),meta=await json(join(nativeDir,'meta.json'));
const browser=meta.machine?.browser?.name as 'safari'|'chrome';
assert.ok(['safari','chrome'].includes(browser)&&plan.browsers.includes(browser),'native browser profile not in frozen plan');
assert.equal(meta.collectionProfile,`native-voiceover-${browser}`);
assert.equal(meta.settings,plan.settings);
const set:CaseSet=await json(join(nativeDir,'inputs/cases.json'));
assert.equal(await casesFingerprint(join(nativeDir,'inputs'),set),plan.casesSha256);
assert.equal(meta.casesSha256,plan.casesSha256);
const inputBytes=await readFile(join(planDir,'speech-inputs.json'));
assert.equal(createHash('sha256').update(inputBytes).digest('hex'),plan.speechInputsSha256);
const inputs=JSON.parse(inputBytes.toString()) as Record<string,VoiceOverSpeechInput[]>;
const predictions=await json(join(planDir,`predictions-${browser}.json`));
assert.equal(predictions.modelBuildSha256,plan.modelBuildSha256);
assert.ok(Date.parse(predictions.predictedAt)<Date.parse(meta.startedAt),'predictions must predate native collection');
const build=createHash('sha256'),dist=join(planDir,'model-js');
for(const path of (await readdir(dist,{recursive:true})).filter(p=>p.endsWith('.js')).sort())build.update(path).update(await readFile(join(dist,path)));
assert.equal(build.digest('hex'),plan.modelBuildSha256);
const {formatVoiceOverSpeech}=await import(pathToFileURL(join(dist,'mock-voiceover/index.js')).href);
const rawRecords=await readFile(join(nativeDir,'records.jsonl'));
const records=rawRecords.toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as CaseRecord);
assert.equal(new Set(records.map(r=>r.caseId)).size,records.length,'multiple attempts require explicit attempt selection; do not silently replace observations');
assert.ok(records.every(r=>r.source==='voiceover'&&set.cases.some(c=>c.id===r.caseId)));
const rows=[];
for(const c of set.cases){
  const record=records.find(r=>r.caseId===c.id);let context:VoiceOverSpeechContext={containers:[]};
  const dump=async(path:string|undefined):Promise<AxDump|undefined>=>path?json(join(nativeDir,path)):undefined;
  const startDump=await dump(record?.start.axPath);
  const before=generateStartInput();
  let previousContextVerified=!!record?.start.aligned&&checkSpeechInput(before,startDump).status==='verified';
  assert.equal(inputs[c.id]?.length,c.chords.length);
  for(const [step,chord]of c.chords.entries()){
    const input=inputs[c.id]![step]!,saved=predictions.rows.find((r:{caseId:string;step:number})=>r.caseId===c.id&&r.step===step);
    assert.deepEqual(saved?.input,input,'saved prediction input differs from frozen input');
    const prediction=formatVoiceOverSpeech({...input,referenceBrowser:browser},context);
    assert.deepEqual(saved.prediction,JSON.parse(JSON.stringify(prediction)),'saved prediction differs from frozen model replay');context=prediction.context;
    const native=record?.steps[step],tree=await dump(native?.axPath);
    const quality=evaluateSpeechCandidate(input,prediction,native,tree,{chord,startAligned:!!record?.start.aligned,previousContextVerified});
    rows.push({caseId:c.id,step,chord,input,prediction,...quality,nativeUtterances:native?.utterances??[],nativeAxPath:native?.axPath,nativeAxSha256:native?.axPath?createHash('sha256').update(await readFile(join(nativeDir,native.axPath))).digest('hex'):undefined});
    previousContextVerified=quality.inputVerification.status==='verified';
  }
}
assert.equal(rows.length,plan.plannedActionsPerBrowser);
const result={evaluatedAt:new Date().toISOString(),browser,sourceRecordsSha256:createHash('sha256').update(rawRecords).digest('hex'),sourceCasesSha256:plan.casesSha256,sourceModelBuildSha256:plan.modelBuildSha256,predictedAt:predictions.predictedAt,nativeStartedAt:meta.startedAt,summary:summarizeSpeechCandidates(rows),rows};
await mkdir(out);await writeFile(join(out,'speech-evaluation.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({browser,...result.summary},null,2));
function generateStartInput():VoiceOverSpeechInput{return {command:'read_current',target:{identity:'before',semantic:{role:'button',name:'Before marker',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false},containers:[]}};}
