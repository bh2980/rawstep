import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
import {normalize,splitSpeech} from '../packages/vo-corpus/src/compare.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-button-state-speech-2026-10-15.json',import.meta.url),'utf8')) as {
 plan:{speechInputsSha256:string};profiles:{browser:'safari'|'chrome';predictedAt:string;nativeStartedAt:string;
 summary:{planned:number;eligible:number;mainSpeechExact:{matched:number}};
 rows:{caseId:string;step:number;chord:string;input:VoiceOverSpeechInput;utterances:{text:string}[];evaluation:{eligible:boolean}}[]}[];
};
it.each(fixture.profiles)('separates $browser button reading from unresolved activation receipts',profile=>{
 expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
 expect(profile.summary).toMatchObject({planned:25,eligible:profile.browser==='safari'?20:25,mainSpeechExact:{matched:profile.browser==='safari'?12:15}});
 const contexts=new Map<string,VoiceOverSpeechContext>(),inputs:Record<string,VoiceOverSpeechInput[]>={};let main=0,full=0,read=0;
 for(const row of profile.rows){
  (inputs[row.caseId]??=[]).push(row.input);
  const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},contexts.get(row.caseId));contexts.set(row.caseId,result.context);
  const actual=splitSpeech(row.utterances);
  if(row.chord!=='Space'){
   expect(result.speech,`${row.caseId} ${row.step} reading`).toBe(actual.main);read++;
  }
  if(row.evaluation.eligible){
   if(normalize(result.speech)===normalize(actual.main))main++;
   if(JSON.stringify([result.speech,...result.usageHint?[result.usageHint]:[]])===JSON.stringify(row.utterances.map(u=>u.text)))full++;
  }
 }
 // Keep unresolved silence, state-event order, repeated receipts and Safari missing expanded evidence visible.
 expect({read,main,full}).toEqual(profile.browser==='safari'?{read:15,main:12,full:12}:{read:15,main:17,full:15});
 expect(createHash('sha256').update(JSON.stringify(inputs,null,2)+'\n').digest('hex')).toBe(fixture.plan.speechInputsSha256);
});
