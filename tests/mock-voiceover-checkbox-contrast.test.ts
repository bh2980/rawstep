import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-checkbox-speech-2026-10-15.json',import.meta.url),'utf8')) as {
 plan:{speechInputsSha256:string};profiles:{browser:'safari'|'chrome';predictedAt:string;nativeStartedAt:string;
 summary:{planned:number;eligible:number;mainSpeechExact:{matched:number};fullSpeechExact:{matched:number}};
 rows:{caseId:string;step:number;input:VoiceOverSpeechInput;utterances:{text:string}[];evaluation:{eligible:boolean};transition?:{status:string}}[]}[];
};
it.each(fixture.profiles)('matches controlled checkbox wording and receipt order for $browser',profile=>{
 expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
 expect(profile.summary).toMatchObject({planned:40,eligible:40,mainSpeechExact:{matched:profile.browser==='safari'?40:32},fullSpeechExact:{matched:32}});
 const contexts=new Map<string,VoiceOverSpeechContext>(),inputs:Record<string,VoiceOverSpeechInput[]>={};let changed=0;
 for(const row of profile.rows){
  expect(row.evaluation.eligible).toBe(true);(inputs[row.caseId]??=[]).push(row.input);
  const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},contexts.get(row.caseId));contexts.set(row.caseId,result.context);
  expect([result.speech,...result.usageHint?[result.usageHint]:[]]).toEqual(row.utterances.map(u=>u.text));
  if(row.input.checkedStateChanged){changed++;expect(row.transition?.status).toBe('verified');}
 }
 expect(changed).toBe(16);expect(createHash('sha256').update(JSON.stringify(inputs,null,2)+'\n').digest('hex')).toBe(fixture.plan.speechInputsSha256);
});
it('a Chrome value-change announcement leaves the supplied structural speech history intact',()=>{
 const input=fixture.profiles[1]!.rows.find(r=>r.input.command==='activate_button')!.input;
 const previous:VoiceOverSpeechContext={containers:['region','table'],focusContext:'table',cell:{table:'table',row:1,column:1,rows:3,columns:2,header:'Preference',rowSpan:1,columnSpan:1},column:{table:'table',column:1}};
 const result=formatVoiceOverSpeech({...input,referenceBrowser:'chrome'},previous);
 expect(result.speech).toBe('checked');expect(result.context).toEqual(previous);expect(result.context).not.toBe(previous);expect(result.usageHint).toBeUndefined();
});
