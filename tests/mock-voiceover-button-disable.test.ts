import {readFileSync} from 'node:fs';import {expect,it} from 'vitest';
import {formatVoiceOverActivation} from 'rawstep/mock-voiceover';import {checkSpeechInput} from '../packages/vo-corpus/src/speech-input.js';
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
