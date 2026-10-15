import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-checkbox-entry-timing-2026-10-15.json',import.meta.url),'utf8')) as {
 plan:{frozenAt:string;speechInputsSha256:string};profiles:{browser:'safari'|'chrome';predictedAt:string;nativeStartedAt:string;
 summary:{planned:number;nativeObserved:number;inputVerified:number;fullSpeechExact:{matched:number}};
 rows:{caseId:string;step:number;input:VoiceOverSpeechInput;utterances:{text:string;t:number}[];
 timing:{requestedAt:number;observationStartedAt:number;observationEndedAt:number};
 evaluation:{eligible:boolean;attribution:{completionVerified:boolean}};transition?:{status:string}}[]}[];
};

it.each(fixture.profiles)('preserves Tab/VO entry, return and bounded hint ordering for $browser',profile=>{
 expect(Date.parse(fixture.plan.frozenAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
 expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
 expect(profile.summary).toMatchObject({planned:20,nativeObserved:20,inputVerified:20,fullSpeechExact:{matched:20}});
 const contexts=new Map<string,VoiceOverSpeechContext>(),inputs:Record<string,VoiceOverSpeechInput[]>={};let changes=0,entries=0;
 for(const row of profile.rows){
  (inputs[row.caseId]??=[]).push(row.input);
  expect(row.evaluation.eligible).toBe(true);
  expect(row.evaluation.attribution.completionVerified).toBe(false);
  expect(row.timing.observationEndedAt-row.timing.observationStartedAt).toBeGreaterThanOrEqual(5000);
  const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},contexts.get(row.caseId));
  contexts.set(row.caseId,result.context);
  expect([result.speech,...result.usageHint?[result.usageHint]:[]]).toEqual(row.utterances.map(u=>u.text));
  const hints=row.utterances.filter(u=>u.text.startsWith('You are currently'));
  if(row.input.checkedStateChanged){
   changes++;expect(row.transition?.status).toBe('verified');expect(hints).toEqual([]);
  }
  if(row.step===0||row.step===3){
   entries++;expect(hints).toHaveLength(1);
   const next=profile.rows.find(r=>r.caseId===row.caseId&&r.step===row.step+1)!;
   expect(hints[0]!.t).toBeGreaterThan(row.timing.requestedAt);
   expect(hints[0]!.t).toBeLessThan(next.timing.requestedAt);
  }
 }
 expect(changes).toBe(8);expect(entries).toBe(8);
 expect(createHash('sha256').update(JSON.stringify(inputs,null,2)+'\n').digest('hex')).toBe(fixture.plan.speechInputsSha256);
});
