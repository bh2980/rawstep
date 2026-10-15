/** Native Safari/Chrome contrasts. Neither side is simulator output or a fidelity score. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {casesFingerprint,type CaseRecord,type CaseSet} from './cases.js';
import {focusedAxNode,nativeNodeName,type AxDump,type AxNode} from './axdump.js';
import {nativePageState} from './state.js';
import {validateRuns} from './validate.js';
import {captureWarnings,firstDivergences} from './analyze.js';

const controlRoles=new Set(['AXButton','AXCheckBox','AXRadioButton','AXSwitch','AXTextField','AXTextArea','AXSlider','AXComboBox','AXIncrementor','AXDisclosureTriangle','AXPopUpButton']);
/** Compare logical control identities across browser wrapper trees, not raw child-index paths. */
export function nativeBehavior(dump:AxDump){
  if(dump.truncated||dump.stringTruncations)return undefined;
  const counts=new Map<string,number>(),controls:Record<string,unknown>={};
  const identity=(n:AxNode)=>({role:n.AXRole??'',name:nativeNodeName(n),id:typeof n.AXDOMIdentifier==='string'?n.AXDOMIdentifier:''});
  const visit=(n:AxNode)=>{
    if(controlRoles.has(n.AXRole??'')){
      const target=identity(n),base=target.id?'id:'+target.id:JSON.stringify([target.role,target.name]),ordinal=(counts.get(base)??0)+1;counts.set(base,ordinal);
      const key=base+':'+ordinal;
      const state=nativePageState({...dump,focusedPath:[],root:{...n,AXDOMIdentifier:key,children:[]}})?.controls[key]??{};
      controls[key]={...state,...(typeof n.AXEnabled==='boolean'?{enabled:n.AXEnabled}:{})};
    }
    for(const child of n.children??[])visit(child);
  };
  visit(dump.root);
  const focus=focusedAxNode(dump);
  return {focus:focus?identity(focus):null,controls:Object.fromEntries(Object.entries(controls).sort(([a],[b])=>a.localeCompare(b)))};
}

export function nativeSpeechComparison(set:CaseSet,safari:Map<string,CaseRecord>,chrome:Map<string,CaseRecord>){
  for(const records of [safari,chrome])for(const r of records.values())if(r.source!=='voiceover')throw new Error('Both browser comparison sources must be native VoiceOver');
  const report=validateRuns(set,safari,chrome);
  return {cases:report.plannedCases,aligned:report.alignedCases,allMain:report.all,contentMain:report.content,fullSpeech:report.fullSpeech,contentFullSpeech:report.contentFullSpeech,
    firstDifferences:firstDivergences(report),verdicts:report.verdicts,rows:report.rows.map(r=>({caseId:r.caseId,step:r.step,chord:r.chord,axes:r.axes,verdict:r.verdict,markerOnly:r.markerOnly,fullSpeechMatched:r.fullSpeechMatched,safariMain:r.voiceover,chromeMain:r.simulator,safariHint:r.voiceoverHint,chromeHint:r.simulatorHint}))};
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
  const args=process.argv.slice(2);
  if(args.length!==4)throw new Error('Usage: native-compare.ts <cases dir> <native Safari run> <native Chrome run> <new output dir>');
  const [casesDir,safariDir,chromeDir,out]=args.map(p=>resolve(p)) as [string,string,string,string];
  const set=JSON.parse(await readFile(join(casesDir,'cases.json'),'utf8')) as CaseSet,hash=await casesFingerprint(casesDir,set);
  if(set.cases.some(c=>c.url))throw new Error('Controlled native comparison requires archived local inputs; live URLs need a separate authored-input protocol');
  const sources:{browser:string;run:string;recordsSha256:string;metaSha256:string;environment:unknown}[]=[];
  async function readRun(dir:string,browser:'safari'|'chrome'){
    const bytes=await readFile(join(dir,'records.jsonl')),metaBytes=await readFile(join(dir,'meta.json')),meta=JSON.parse(metaBytes.toString());
    const archived=JSON.parse(await readFile(join(dir,'inputs/cases.json'),'utf8')) as CaseSet;
    if(meta.machine?.browser?.name!==browser||meta.caseSet!==set.id||meta.casesGeneratedAt!==set.generatedAt||meta.casesSha256!==hash||await casesFingerprint(join(dir,'inputs'),archived)!==hash)throw new Error('Native browser or archived input identity differs');
    const records=new Map<string,CaseRecord>();
    for(const line of bytes.toString().split('\n').filter(Boolean)){
      const r=JSON.parse(line) as CaseRecord;
      if(r.source!=='voiceover'||r.caseSet!==set.id||records.has(r.caseId)||!set.cases.some(c=>c.id===r.caseId))throw new Error('Wrong native source, duplicate or unknown case');
      records.set(r.caseId,r);
    }
    const environment={reader:meta.atDriver.capabilities,macos:meta.machine.macos,build:meta.machine.build,locale:meta.machine.locale,languages:meta.machine.languages,settings:meta.settings,workflowStartProtocol:meta.workflowStartProtocol};
    sources.push({browser,run:dir,recordsSha256:createHash('sha256').update(bytes).digest('hex'),metaSha256:createHash('sha256').update(metaBytes).digest('hex'),environment:{...environment,browser:meta.machine.browser}});
    return {records,environment};
  }
  const safari=await readRun(safariDir,'safari'),chrome=await readRun(chromeDir,'chrome');
  if(JSON.stringify(safari.environment)!==JSON.stringify(chrome.environment))throw new Error('Reader, OS, language, settings label or start protocol differs; collect a controlled pair instead of attributing these differences to the browser');
  const speech=nativeSpeechComparison(set,safari.records,chrome.records),states=[];
  const roles:{browser:string;caseId:string;counts:Record<string,number>}[]=[];
  for(const [browser,dir,records]of [['safari',safariDir,safari.records],['chrome',chromeDir,chrome.records]] as const){
    for(const c of set.cases){
      const r=records.get(c.id),counts:Record<string,number>={};
      if(r?.start.axPath){
        const d=JSON.parse(await readFile(join(dir,r.start.axPath),'utf8')) as AxDump;
        const visit=(n:AxNode)=>{const role=n.AXRole??'unknown';counts[role]=(counts[role]??0)+1;for(const child of n.children??[])visit(child);};visit(d.root);
      }
      roles.push({browser,caseId:c.id,counts});
    }
  }
  for(const c of set.cases)for(const [step,chord]of c.chords.entries()){
    const records=[safari.records.get(c.id),chrome.records.get(c.id)],snapshots=[];
    for(const [i,r]of records.entries()){
      const s=r?.steps[step],dir=i===0?safariDir:chromeDir;
      snapshots.push(r?.start.aligned&&s?.chord===chord&&!s.foregroundError&&s.axPath?await readFile(join(dir,s.axPath),'utf8').then(text=>nativeBehavior(JSON.parse(text) as AxDump)).catch(()=>undefined):undefined);
    }
    const [a,b]=snapshots,available=!!a&&!!b;
    states.push({caseId:c.id,step,chord,available,keyboardFocusMatched:available&&!!a.focus&&!!b.focus&&JSON.stringify(a.focus)===JSON.stringify(b.focus),controlsMatched:available&&JSON.stringify(a.controls)===JSON.stringify(b.controls),safari:a??null,chrome:b??null});
  }
  const result={schemaVersion:1,comparedAt:new Date().toISOString(),casesSha256:hash,sources,speech,
    stateMetrics:{planned:states.length,available:states.filter(r=>r.available).length,keyboardFocusMatched:states.filter(r=>r.keyboardFocusMatched).length,controlsMatched:states.filter(r=>r.controlsMatched).length},states,initialAxRoleCounts:roles,
    qualityWarnings:[...safari.records.values(),...chrome.records.values()].flatMap(captureWarnings),
    note:'Native-vs-native agreement measures browser differences, not simulator accuracy. Same recorded settings label and observed environment do not prove unknown protected preferences. Keyboard focus is not the VoiceOver cursor. Control fallback identities use role/name/ordinal and need ambiguity review. First speech differences are root-cause candidates; later divergence can cascade. These legacy cases have no declared task-success oracle; no task-success rate is asserted.'};
  await mkdir(dirname(out),{recursive:true});await mkdir(out);await writeFile(join(out,'comparison.json'),JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({cases:speech.cases,aligned:speech.aligned,contentMain:speech.contentMain,fullSpeech:speech.fullSpeech,state:result.stateMetrics,qualityWarnings:result.qualityWarnings.length},null,2));
}
