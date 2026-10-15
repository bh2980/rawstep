/** Derived, partition-scoped analysis; raw observations and previous reports are never replaced. */
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {casesFingerprint,type CaseRecord,type CaseSet} from "./cases.js";
import {validateRuns} from "./validate.js";
import {comparePageState,nativePageState,summarizeState} from "./state.js";
import type {AxDump} from "./axdump.js";
import {normalize} from "./compare.js";
import {speechAttribution} from "./session.js";
import {verifyArchivedInputs} from "./archive.js";

export function hintComparison(report:ReturnType<typeof validateRuns>){
  const rows=report.rows.map(r=>({caseId:r.caseId,step:r.step,chord:r.chord,axes:r.axes,
    native:r.voiceoverHint,model:r.simulatorHint,
    matched:['exact','normalized','mismatch'].includes(r.verdict)&&normalize(r.voiceoverHint)===normalize(r.simulatorHint)}));
  const first=new Map<string,typeof rows[number]>();
  for(const r of rows)if(!r.matched&&!first.has(r.caseId))first.set(r.caseId,r);
  return {matched:rows.filter(r=>r.matched).length,planned:rows.length,nativeHintSteps:rows.filter(r=>r.native).length,
    modelHintSteps:rows.filter(r=>r.model).length,firstDifferences:[...first.values()]};
}

/** Candidates for curation, not permission to remove observations from the score. */
export function captureWarnings(record:CaseRecord){
  return [...(!record.start.aligned?[{caseId:record.caseId,step:-1,flag:'native-start-unaligned'}]:[]),...(record.error?[{caseId:record.caseId,step:record.steps.length,flag:'native-workflow-error'}]:[]),...record.steps.flatMap((step,i)=>[
    ...(step.reason==='deadline'?[{caseId:record.caseId,step:i,flag:'native-speech-window-deadline'}]:[]),
    ...(step.utterances.some(u=>/^Safari(?: is)? not responding$/i.test(u.text.trim()))?[{caseId:record.caseId,step:i,flag:'possible-native-browser-unresponsive-receipt'}]:[]),
    ...(step.axError?[{caseId:record.caseId,step:i,flag:'native-AX-capture-failed'}]:[]),
    ...(step.foregroundError?[{caseId:record.caseId,step:i,flag:'native-foreground-changed'}]:[]),
    ...(speechAttribution(step).beforeRequest?[{caseId:record.caseId,step:i,flag:'native-receipt-before-command'}]:[]),
    ...(speechAttribution(step).afterWindow?[{caseId:record.caseId,step:i,flag:'native-receipt-outside-listen-window'}]:[]),
  ])];
}

export function firstDivergences(report:ReturnType<typeof validateRuns>){
  const first=new Map<string,typeof report.rows[number]>();
  for(const row of report.rows)if(!row.markerOnly&&!['exact','normalized'].includes(row.verdict)&&!first.has(row.caseId))first.set(row.caseId,row);
  const groups=new Map<string,{family:string;verdict:string;chord:string;cases:{caseId:string;step:number}[]}>();
  for(const row of first.values()){
    const family=row.axes.family??row.axes.role??'unknown',key=JSON.stringify([family,row.verdict,row.chord]);
    const group=groups.get(key)??{family,verdict:row.verdict,chord:row.chord,cases:[]};
    group.cases.push({caseId:row.caseId,step:row.step});groups.set(key,group);
  }
  return [...groups.values()].sort((a,b)=>b.cases.length-a.cases.length||a.family.localeCompare(b.family));
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  const [casesArg,nativeArg,modelArg,outArg,partition='train']=process.argv.slice(2);
  if(!casesArg||!nativeArg||!modelArg||!outArg||!['train','validation','test','all'].includes(partition))throw new Error('Usage: analyze.ts <cases> <native run> <model run> <new output directory> [train|validation|test|all]');
  const [casesDir,nativeDir,modelDir,out]=[casesArg,nativeArg,modelArg,outArg].map(p=>resolve(p)) as [string,string,string,string];
  const set=JSON.parse(await readFile(join(casesDir,'cases.json'),'utf8')) as CaseSet,hash=await casesFingerprint(casesDir,set);
  const sourceHashes:{source:string;recordsSha256:string;metaSha256:string}[]=[],referenceBrowsers:Partial<Record<CaseRecord['source'],string>>={};
  async function readRun(dir:string,source:CaseRecord['source']){
    const bytes=await readFile(join(dir,'records.jsonl')),metaBytes=await readFile(join(dir,'meta.json')),meta=JSON.parse(metaBytes.toString());
    if(meta.caseSet!==set.id||meta.casesGeneratedAt!==set.generatedAt||meta.casesSha256!==hash)throw new Error('Analysis requires verified case identity and fixture bytes');
    await verifyArchivedInputs(dir,hash);
    referenceBrowsers[source]=source==='voiceover'?meta.machine?.browser?.name:meta.referenceBrowser??'safari';
    const records=new Map<string,CaseRecord>();
    for(const line of bytes.toString().split('\n').filter(Boolean)){
      const r=JSON.parse(line) as CaseRecord;
      if(r.source!==source||r.caseSet!==set.id||records.has(r.caseId)||!set.cases.some(c=>c.id===r.caseId))throw new Error('Wrong source, set, duplicate or unknown case in analysis');
      records.set(r.caseId,r);
    }
    sourceHashes.push({source,recordsSha256:createHash('sha256').update(bytes).digest('hex'),metaSha256:createHash('sha256').update(metaBytes).digest('hex')});
    return records;
  }
  const native=await readRun(nativeDir,'voiceover'),model=await readRun(modelDir,'simulator');
  if(!['safari','chrome'].includes(referenceBrowsers.voiceover??'')||referenceBrowsers.voiceover!==referenceBrowsers.simulator)throw new Error('Native browser differs from simulator reference browser; score each profile independently');
  const selected={...set,cases:set.cases.filter(c=>partition==='all'||c.axes.partition===partition)};
  if(!selected.cases.length)throw new Error('No cases in requested partition');
  const report=validateRuns(selected,native,model),states=[];
  const qualityWarnings=selected.cases.flatMap(c=>native.has(c.id)?captureWarnings(native.get(c.id)!):[]);
  for(const c of selected.cases)for(const [i,chord]of c.chords.entries()){
    const a=native.get(c.id),b=model.get(c.id),x=a?.steps[i],y=b?.steps[i];
    const ax=x?.axPath?await readFile(join(nativeDir,x.axPath),'utf8').then(s=>JSON.parse(s) as AxDump).catch(()=>undefined):undefined;
    if(ax?.truncated||ax?.stringTruncations)qualityWarnings.push({caseId:c.id,step:i,flag:'native-AX-truncated'});
    const state=comparePageState(ax?nativePageState(ax):undefined,y?.state);
    if(!a?.start.aligned||!b?.start.aligned||x?.foregroundError||y?.foregroundError||x?.chord!==chord||y?.chord!==chord||y?.reason==='unsupported'){state.matched=false;state.differences.push('workflow missing, unsupported or unaligned');}
    states.push({caseId:c.id,step:i,chord,...state});
  }
  await mkdir(dirname(out),{recursive:true});await mkdir(out);
  const summary={schemaVersion:2,evaluationProtocol:report.evaluationProtocol,analyzedAt:new Date().toISOString(),partition,casesSha256:hash,sourceHashes,referenceBrowser:referenceBrowsers.voiceover,
    nativeRun:nativeDir,modelRun:modelDir,metrics:{cases:report.plannedCases,aligned:report.alignedCases,all:report.all,content:report.content,spoken:report.spoken,fullSpeech:report.fullSpeech,contentFullSpeech:report.contentFullSpeech,verdicts:report.verdicts,state:summarizeState(states),funnel:report.funnel,conditionalSpeech:report.conditionalSpeech,conditionalFullSpeech:report.conditionalFullSpeech,evaluation:report.evaluation},
    queue:firstDivergences(report),hints:hintComparison(report),qualityWarnings,note:'Queue groups only the first divergence per case to limit cascading-order inflation. Quality warnings require curation and do not remove original failures from metrics. Setup, language, unsupported commands and behavioral mismatches stay distinct. Post-action state is a target, not a model input. Hints have a separate comparison; full-speech metrics retain their ordering with other receipts.'};
  await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2),{flag:'wx'});
  await writeFile(join(out,'speech.json'),JSON.stringify(report,null,2),{flag:'wx'});
  await writeFile(join(out,'state.json'),JSON.stringify(states,null,2),{flag:'wx'});
  console.log(JSON.stringify(summary,null,2));
}
