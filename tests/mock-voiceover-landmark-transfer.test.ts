import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,formatVoiceOverActivation,type VoiceOverSpeechInput,type VoiceOverActivationInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-landmark-transfer-2026-10-15.json',import.meta.url),'utf8')) as {
 plan:{speechInputsSha256:string;collisions:unknown[];priorInputCasesAudited:number};profiles:{browser:'safari'|'chrome';predictedAt:string;nativeStartedAt:string;summary:{planned:number;nativeObserved:number;eligible:number;mainSpeechExact:{matched:number};fullSpeechExact:{matched:number};nativeStateTransitions:{planned:number;verified:number}};
 rows:{caseId:string;step:number;input:VoiceOverSpeechInput&Partial<Pick<VoiceOverActivationInput,'beforeTarget'>>;utterances:{text:string}[];beforeInputVerification?:{status:string};panelObservation?:{expectedShown:boolean;observedShown:boolean};evaluation:{eligible:boolean;mainSpeechExact:boolean;attribution:{completionVerified:boolean}}}[]}[];
};
it.each(fixture.profiles)('retains first independent $browser results and replays caller inputs without hiding receipt whitespace',profile=>{
 expect(fixture.plan.collisions).toEqual([]);expect(fixture.plan.priorInputCasesAudited).toBe(828);
 expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
 expect(profile.summary).toMatchObject({planned:32,nativeObserved:32,eligible:32,mainSpeechExact:{matched:32},fullSpeechExact:{matched:28},nativeStateTransitions:{planned:9,verified:9}});
 const contexts=new Map<string,VoiceOverSpeechContext>(),inputs:Record<string,unknown[]>={};let events=0,literalMatches=0;
 for(const row of profile.rows){
  (inputs[row.caseId]??=[]).push(row.input);expect(row.evaluation.eligible).toBe(true);expect(row.evaluation.mainSpeechExact).toBe(true);
  expect(row.evaluation.attribution.completionVerified).toBe(false);
  if(row.panelObservation)expect(row.panelObservation.observedShown).toBe(row.panelObservation.expectedShown);
  let utterances:readonly string[],context:VoiceOverSpeechContext;
  if(row.input.beforeTarget){
   events++;expect(row.beforeInputVerification?.status).toBe('verified');
   const result=formatVoiceOverActivation({...row.input,referenceBrowser:profile.browser},contexts.get(row.caseId));
   expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);
   ({utterances,context}=result);
  }else{
   const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},contexts.get(row.caseId));
   utterances=[result.speech,...result.usageHint?[result.usageHint]:[]];context=result.context;
  }
  const actual=row.utterances.map(u=>u.text);if(JSON.stringify(actual)===JSON.stringify(utterances))literalMatches++;
  expect(utterances.map(s=>s.trimEnd()),`${row.caseId} ${row.step}`).toEqual(actual.map(s=>s.trimEnd()));
  contexts.set(row.caseId,context);
 }
 expect(events).toBe(9);expect(literalMatches).toBeGreaterThanOrEqual(28);
 expect(createHash('sha256').update(JSON.stringify(inputs,null,2)+'\n').digest('hex')).toBe(fixture.plan.speechInputsSha256);
});
