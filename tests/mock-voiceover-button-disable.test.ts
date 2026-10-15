import {readFileSync} from 'node:fs';import {expect,it} from 'vitest';
import {gunzipSync} from 'node:zlib';
import {formatVoiceOverActivation,formatVoiceOverSpeech} from 'rawstep/mock-voiceover';import {checkSpeechInput} from '../packages/vo-corpus/src/speech-input.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-button-disable-source-v1-2026-10-16.json',import.meta.url),'utf8')) as {profiles:{browser:'safari'|'chrome';rows:any[];summary:any}[]};
it.each(fixture.profiles)('$browser models the independently checked enabled and self-disabled plain-button receipts',p=>{
 let compared=0;
 for(const r of p.rows.filter(r=>r.chord==='Space')){
  const event=r.diagnostic.events.find((e:any)=>e.kind==='activation'),mapped=r.verifiedInputs.find((e:any)=>e.kind==='activation').input;
  expect(checkSpeechInput(mapped,r.nativeInputObservation.dump,{buttonSpaceEvent:true}).status).toBe('verified');
  expect(checkSpeechInput({...mapped,target:mapped.beforeTarget},r.nativeInputObservation.before,{buttonSpaceEvent:true}).status).toBe('verified');
  const original=structuredClone(event),result=formatVoiceOverActivation(event.input,event.previousContext);
  expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);
  expect(result.utterances).toEqual(r.utterances.map((u:{text:string})=>u.text));expect(result.context).toEqual(event.previousContext);expect(event).toEqual(original);compared++;
 }
 expect(compared).toBe(4);expect(p.summary.mainSpeechExact.matched).toBe(6);
});
it('keeps other disabled activations and simultaneous semantic changes unsupported',()=>{
 const sample=fixture.profiles[0]!.rows.find(r=>r.caseId.endsWith('bare-disable')&&r.chord==='Space').diagnostic.events[0].input;
 for(const change of [
  (x:any)=>{x.command='activate_button';},(x:any)=>{x.beforeTarget.semantic.disabled=true;},
  (x:any)=>{x.beforeTarget.semantic.disabled=undefined;},(x:any)=>{x.target.semantic.name='Changed';},
  (x:any)=>{x.beforeTarget.semantic.pressed=false;x.target.semantic.pressed=true;},
  (x:any)=>{x.beforeTarget.semantic.pressed=false;x.target.semantic.pressed=false;},
  (x:any)=>{x.beforeTarget.semantic.tagName='div';x.target.semantic.tagName='div';},
  (x:any)=>{x.beforeTarget.semantic.help='Tooltip';x.target.semantic.help='Tooltip';},
 ]){const input=structuredClone(sample);change(input);const result=formatVoiceOverActivation(input);expect(result.status).toBe('unsupported');expect(result).not.toHaveProperty('utterances');}
});

it('also preserves silence for independently verified original table-button transitions with a different label',()=>{
 const practical=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/voiceover-evidence/native-practical-speech-tasks-2026-10-16.json.gz',import.meta.url))).toString());let compared=0;
 for(const p of practical.profiles)for(const step of p.browser==='safari'?[5]:[5,11]){
  const r=p.rows.find((r:any)=>r.caseId.endsWith('supply-basket')&&r.step===step),event=r.diagnostic.events.find((e:any)=>e.kind==='activation'),mapped=r.verifiedInputs.find((e:any)=>e.kind==='activation').input;
  expect(checkSpeechInput(mapped,r.nativeInputObservation.dump,{buttonSpaceEvent:true}).status).toBe('verified');
  expect(checkSpeechInput({...mapped,target:mapped.beforeTarget},r.nativeInputObservation.before,{buttonSpaceEvent:true}).status).toBe('verified');
  const result=formatVoiceOverActivation(event.input,event.previousContext);expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);
  expect(result.utterances).toEqual(r.utterances.map((u:{text:string})=>u.text));expect(result.context).toEqual(event.previousContext);expect(r.evaluation.eligible).toBe(false);compared++;
 }
 expect(compared).toBe(3);
});

const transfer=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-button-disable-transfer-v1-2026-10-16.json',import.meta.url),'utf8')) as typeof fixture;
it.each(transfer.profiles)('$browser preserves all first reserved reverse-entry windows and modeled silence',p=>{
 expect(p.summary.mainSpeechExact).toMatchObject({matched:14,eligible:14,allPlannedRate:1});expect(p.summary.fullSpeechExact.matched).toBe(14);
 for(const r of p.rows){const event=r.diagnostic.events[0];let utterances:string[];
  if(event.kind==='activation'){const result=formatVoiceOverActivation(event.input,event.previousContext);expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);utterances=result.utterances;}
  else{const result=formatVoiceOverSpeech(event.input,event.previousContext);utterances=[result.speech,...(result.usageHint?[result.usageHint]:[])];}
  expect(utterances,`${r.caseId} ${r.step}`).toEqual(r.utterances.map((u:{text:string})=>u.text));
 }
});
