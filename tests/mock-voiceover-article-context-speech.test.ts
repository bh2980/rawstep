import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const first=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-article-context-speech-2026-10-15.json',import.meta.url),'utf8'));
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-article-entry-child-v2-2026-10-15.json',import.meta.url),'utf8')) as {
 sources:{path:string;sha256:string}[];pages:{html:string;htmlSha256:string}[];
 profiles:{browser:'safari'|'chrome';summary:{planned:number;nativeObserved:number;eligible:number;mainSpeechExact:{matched:number};fullSpeechExact:{matched:number}};
 rows:{caseId:string;step:number;input:VoiceOverSpeechInput;entryObservations:{name:string}[];beforeAxSha256:string;utterances:{text:string}[];evaluation:{eligible:boolean;attribution:{completionVerified:boolean}}}[]}[];
};
it.each(fixture.profiles)('replays $browser article regression using observed child names and preserves the first failures',profile=>{
 const initial=first.profiles.find((p:{browser:string})=>p.browser===profile.browser);
 expect(initial.summary).toMatchObject({planned:35,nativeObserved:35,eligible:35,mainSpeechExact:{matched:profile.browser==='safari'?32:24},fullSpeechExact:{matched:profile.browser==='safari'?32:24}});
 expect(Date.parse(initial.predictedAt)).toBeLessThan(Date.parse(initial.nativeStartedAt));
 for(const source of fixture.sources)expect(createHash('sha256').update(readFileSync(new URL(source.path,new URL('../packages/vo-corpus/',import.meta.url)))).digest('hex')).toBe(source.sha256);
 for(const page of fixture.pages)expect(createHash('sha256').update(page.html).digest('hex')).toBe(page.htmlSha256);
 expect(profile.summary).toMatchObject({planned:74,nativeObserved:74,eligible:74,mainSpeechExact:{matched:74},fullSpeechExact:{matched:74}});
 const contexts=new Map<string,VoiceOverSpeechContext>();
 for(const row of profile.rows){
  expect(row.evaluation.eligible).toBe(true);expect(row.evaluation.attribution.completionVerified).toBe(false);expect(row.beforeAxSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(row.input.target.containers?.filter(c=>c.role==='article').map(c=>c.entryChildName)??[]).toEqual(row.entryObservations.map(e=>e.name));
  const previous=contexts.get(row.caseId),saved=structuredClone(previous),result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},previous);
  expect(previous).toEqual(saved);
  expect([result.speech,...result.usageHint?[result.usageHint]:[]],`${row.caseId} step ${row.step}`).toEqual(row.utterances.map(u=>u.text));
  contexts.set(row.caseId,result.context);
 }
});
