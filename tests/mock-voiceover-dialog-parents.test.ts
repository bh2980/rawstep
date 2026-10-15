import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-dialog-parent-context-2026-10-15.json',import.meta.url),'utf8')) as {
 profiles:{browser:'safari'|'chrome';summary:{eligible:number;mainSpeechExact:{matched:number};fullSpeechExact:{matched:number}};rows:{caseId:string;input:VoiceOverSpeechInput;utterances:{text:string}[];evaluation:{eligible:boolean}}[]}[];
};
it.each(fixture.profiles)('reproduces $browser dialog parent contrasts without losing standalone wording',profile=>{
 expect(profile.summary).toMatchObject({eligible:24,mainSpeechExact:{matched:18},fullSpeechExact:{matched:12}});
 const contexts=new Map<string,VoiceOverSpeechContext>();let matched=0;
 for(const row of profile.rows){expect(row.evaluation.eligible).toBe(true);
  const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},contexts.get(row.caseId));contexts.set(row.caseId,result.context);
  expect([result.speech,...result.usageHint?[result.usageHint]:[]],row.caseId).toEqual(row.utterances.map(u=>u.text));matched++;
 }
 expect(matched).toBe(24);
});
