import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,formatVoiceOverActivation,type VoiceOverSpeechInput,type VoiceOverActivationInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-article-transfer-2026-10-15.json',import.meta.url),'utf8')) as {
 plan:{speechInputsSha256:string;collisions:unknown[];priorInputCasesAudited:number};attemptSummary:{attempts:number;uniquePlannedActions:number;plannedExecutions:number;observed:number};startupFailures:{nativeObserved:number;planned:number}[];
 profiles:{browser:'safari'|'chrome';attemptRole:string;predictedAt:string;nativeStartedAt:string;errors:{error:string}[];
 summary:{planned:number;nativeObserved:number;eligible:number;mainSpeechExact:{matched:number;conditionalRate:number|null;allPlannedRate:number};fullSpeechExact:{matched:number};nativeStateTransitions:{planned:number;verified:number}};
 rows:{caseId:string;step:number;input:VoiceOverSpeechInput&Partial<Pick<VoiceOverActivationInput,'beforeTarget'>>;prediction:{speech:string};utterances:{text:string}[];beforeInputVerification?:{status:string};transition?:{status:string};panelObservation?:{expectedShown:boolean;observedShown:boolean};evaluation:{eligible:boolean;mainSpeechExact:boolean;attribution:{completionVerified:boolean}}}[]}[];
};
const completed=fixture.profiles.filter(p=>p.attemptRole==='fixed-input-recovery');
it('keeps interrupted and blocked attempts separate from recovered speech accuracy',()=>{
 expect(fixture.attemptSummary).toMatchObject({attempts:5,uniquePlannedActions:68,plannedExecutions:170,observed:73});
 expect(fixture.startupFailures).toMatchObject([{planned:34,nativeObserved:0}]);
 const audit=JSON.parse(readFileSync(new URL('../packages/vo-corpus/test/article-transfer-attempt-audit.json',import.meta.url),'utf8'));
 expect(audit.firstEvaluationSha256).toBe(createHash('sha256').update(readFileSync(new URL('./fixtures/voiceover-evidence/native-article-transfer-2026-10-15.json',import.meta.url))).digest('hex'));
 expect(audit.attempts).toHaveLength(5);expect(audit.attempts.every((a:{inputsVerified:boolean})=>a.inputsVerified)).toBe(true);
 expect(audit.totals).toMatchObject({plannedExecutions:170,nativeObservations:73,environmentFailureAttempts:3,completeAttempts:2});
 const partial=fixture.profiles.find(p=>p.attemptRole==='primary-partial')!,blocked=fixture.profiles.find(p=>p.attemptRole==='primary-environment-blocked')!;
 expect(partial.summary).toMatchObject({planned:34,nativeObserved:5,eligible:5,mainSpeechExact:{matched:5,allPlannedRate:5/34}});
 expect(partial.errors[0]!.error).toContain('WebSocket');
 expect(blocked.summary).toMatchObject({planned:34,nativeObserved:0,eligible:0,mainSpeechExact:{matched:0,conditionalRate:null}});
 expect(blocked.errors[0]!.error).toContain('Restore pages?');
 for(const p of [partial,blocked])expect(p.rows).toHaveLength(34);
 expect(completed.map(p=>p.browser)).toEqual(['safari','chrome']);
});
it.each(completed)('replays the fixed $browser model on the new article compositions',profile=>{
 expect(fixture.plan.collisions).toEqual([]);expect(fixture.plan.priorInputCasesAudited).toBe(852);
 expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
 expect(profile.summary).toMatchObject({planned:34,nativeObserved:34,eligible:34,mainSpeechExact:{matched:34},fullSpeechExact:{matched:34},nativeStateTransitions:{planned:6,verified:6}});
 const contexts=new Map<string,VoiceOverSpeechContext>();let events=0;
 for(const row of profile.rows){
  expect(row.evaluation.eligible).toBe(true);expect(row.evaluation.mainSpeechExact).toBe(true);expect(row.evaluation.attribution.completionVerified).toBe(false);
  if(row.panelObservation)expect(row.panelObservation.observedShown).toBe(row.panelObservation.expectedShown);
  let utterances:readonly string[],context:VoiceOverSpeechContext;
  const previous=contexts.get(row.caseId),saved=structuredClone(previous);
  if(row.input.beforeTarget){
   events++;expect(row.beforeInputVerification?.status).toBe('verified');expect(row.transition?.status).toBe('verified');
   const result=formatVoiceOverActivation({...row.input,referenceBrowser:profile.browser},previous);expect(result.status).toBe('modeled');
   if(result.status!=='modeled')throw new Error(result.reason);({utterances,context}=result);
  }else{const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},previous);utterances=[result.speech,...result.usageHint?[result.usageHint]:[]];context=result.context;}
  expect(previous).toEqual(saved);expect(utterances,`${row.caseId} ${row.step}`).toEqual(row.utterances.map(u=>u.text));
  contexts.set(row.caseId,context);
 }
 expect(events).toBe(6);
 const inputs=Object.fromEntries(completed.map(p=>{const rows:Record<string,unknown[]>={};for(const r of p.rows)(rows[r.caseId]??=[]).push(r.input);return [p.browser,rows];}));
 expect(createHash('sha256').update(JSON.stringify(inputs,null,2)+'\n').digest('hex')).toBe(fixture.plan.speechInputsSha256);
});
