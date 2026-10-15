import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-landmark-speech-2026-10-15.json',import.meta.url),'utf8')) as {
 plan:{speechInputsSha256:string};profiles:{browser:'safari'|'chrome';predictedAt:string;nativeStartedAt:string;summary:{planned:number;nativeObserved:number;eligible:number;mainSpeechExact:{matched:number}};
 rows:{caseId:string;step:number;input:VoiceOverSpeechInput;utterances:{text:string}[];afterEvidence:{candidates:{ancestors:{AXDOMIdentifier?:string;AXRole?:string;AXSubrole?:string}[]}[]};evaluation:{attribution:{completionVerified:boolean}}}[]}[];
};
it.each(fixture.profiles)('replays $browser landmark entry, within, exit and reverse reentry with caller-owned history',profile=>{
 expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
 expect(profile.summary).toMatchObject({planned:30,nativeObserved:30,eligible:25,mainSpeechExact:{matched:17}});
 const contexts=new Map<string,VoiceOverSpeechContext>(),inputs:Record<string,VoiceOverSpeechInput[]>={};
 for(const row of profile.rows){
  (inputs[row.caseId]??=[]).push(row.input);
  const raw=row.afterEvidence.candidates[0]!.ancestors.find(n=>n.AXDOMIdentifier==='landmark');
  expect(!!raw).toBe((row.input.target.containers?.length??0)>0);
  if(row.caseId.includes('contentinfo')&&raw)expect(raw.AXSubrole).toBe('AXLandmarkContentInfo');
  const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},contexts.get(row.caseId));
  expect([result.speech,...result.usageHint?[result.usageHint]:[]],`${row.caseId} ${row.step}`).toEqual(row.utterances.map(u=>u.text));
  expect(row.evaluation.attribution.completionVerified).toBe(false);contexts.set(row.caseId,result.context);
 }
 expect(createHash('sha256').update(JSON.stringify(inputs,null,2)+'\n').digest('hex')).toBe(fixture.plan.speechInputsSha256);
});
