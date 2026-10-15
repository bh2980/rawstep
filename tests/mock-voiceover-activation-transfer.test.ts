import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverActivation,formatVoiceOverSpeech,type VoiceOverActivationInput,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-activation-transfer-2026-10-15.json',import.meta.url),'utf8')) as {
 plan:{speechInputsSha256:string;collisions:unknown[]};profiles:{browser:'safari'|'chrome';predictedAt:string;nativeStartedAt:string;summary:{planned:number;eligible:number;mainSpeechExact:{matched:number};fullSpeechExact:{matched:number}};
 rows:{caseId:string;step:number;input:VoiceOverSpeechInput&Partial<Pick<VoiceOverActivationInput,'beforeTarget'>>;utterances:{text:string}[];beforeInputVerification?:{status:string};evaluation:{eligible:boolean;attribution:{completionVerified:boolean}}}[]}[];
};
it.each(fixture.profiles)('retains frozen first results and replays corrected $browser activation compositions',profile=>{
 expect(fixture.plan.collisions).toEqual([]);
 expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
 expect(profile.summary).toMatchObject({planned:24,eligible:24,mainSpeechExact:{matched:profile.browser==='safari'?22:19},fullSpeechExact:{matched:profile.browser==='safari'?22:19}});
 const inputs:Record<string,unknown[]>={},contexts=new Map<string,VoiceOverSpeechContext>();let activations=0;
 for(const row of profile.rows){
  (inputs[row.caseId]??=[]).push(row.input);expect(row.evaluation.eligible).toBe(true);expect(row.evaluation.attribution.completionVerified).toBe(false);
  const previous=contexts.get(row.caseId);let utterances:string[],context:VoiceOverSpeechContext;
  if(row.input.beforeTarget){
   expect(row.beforeInputVerification?.status).toBe('verified');activations++;
   const result=formatVoiceOverActivation({...row.input,referenceBrowser:profile.browser},previous);
   expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);
   ({utterances,context}=result);
  }else{
   const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},previous);
   utterances=[result.speech,...result.usageHint?[result.usageHint]:[]];context=result.context;
  }
  expect(utterances,`${row.caseId} ${row.step}`).toEqual(row.utterances.map(u=>u.text));contexts.set(row.caseId,context);
 }
 expect(activations).toBe(12);
 expect(createHash('sha256').update(JSON.stringify(inputs,null,2)+'\n').digest('hex')).toBe(fixture.plan.speechInputsSha256);
});
