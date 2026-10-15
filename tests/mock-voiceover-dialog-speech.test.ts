import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const firstBytes=readFileSync(new URL('./fixtures/voiceover-evidence/native-dialog-speech-2026-10-15.json',import.meta.url)),first=JSON.parse(firstBytes.toString());
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-dialog-observed-inputs-2026-10-15.json',import.meta.url),'utf8')) as {
 firstEvaluationSha256:string;profiles:{browser:'safari'|'chrome';summary:{planned:number;eligible:number;mainSpeechExact:{matched:number};fullSpeechExact:{matched:number}};
 rows:{caseId:string;step:number;input:VoiceOverSpeechInput;keyboardFocus:{role:string;id:string};changedFromAuthoredTarget:boolean;utterances:{text:string}[];baselineEvaluation:{nativeMain:string;nativeHint:string;attribution:{completionVerified:boolean}}}[]}[];
};
const whitespace=(s:string)=>s.replace(/\s+/g,' ').trim();
it.each(fixture.profiles)('models $browser dialog words from independently observed targets and retains the original measurement gap',profile=>{
 expect(createHash('sha256').update(firstBytes).digest('hex')).toBe(fixture.firstEvaluationSha256);
 const correction=JSON.parse(readFileSync(new URL('../packages/vo-corpus/test/dialog-speech-correction.json',import.meta.url),'utf8'));
 expect(correction.observedInputsSha256).toBe(createHash('sha256').update(readFileSync(new URL('./fixtures/voiceover-evidence/native-dialog-observed-inputs-2026-10-15.json',import.meta.url))).digest('hex'));
 expect(correction.profiles.find((p:{browser:string})=>p.browser===profile.browser).summary).toMatchObject({planned:29,eligible:29,mainSpeechExact:{matched:29},fullSpeechExact:{matched:profile.browser==='safari'?27:29}});
 const initial=first.profiles.find((p:{browser:string})=>p.browser===profile.browser);
 expect(initial.summary).toMatchObject({planned:29,nativeObserved:29,eligible:0,mainSpeechExact:{conditionalRate:null}});
 expect(profile.summary).toMatchObject({planned:29,eligible:29,mainSpeechExact:{matched:profile.browser==='safari'?26:18},fullSpeechExact:{matched:profile.browser==='safari'?24:10}});
 const contexts=new Map<string,VoiceOverSpeechContext>();let literalFull=0;
 for(const row of profile.rows){
  const previous=contexts.get(row.caseId),saved=structuredClone(previous),result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},previous);
  expect(previous).toEqual(saved);expect(result.speech,`${row.caseId} ${row.step}`).toBe(row.baselineEvaluation.nativeMain);
  expect(whitespace(result.usageHint??''),`${row.caseId} ${row.step} hint`).toBe(whitespace(row.baselineEvaluation.nativeHint));
  if(JSON.stringify([result.speech,...result.usageHint?[result.usageHint]:[]])===JSON.stringify(row.utterances.map(u=>u.text)))literalFull++;
  expect(row.baselineEvaluation.attribution.completionVerified).toBe(false);contexts.set(row.caseId,result.context);
 }
 expect(literalFull).toBeGreaterThanOrEqual(profile.browser==='safari'?27:29);
 if(profile.browser==='safari'){
  expect(profile.rows.filter(r=>r.changedFromAuthoredTarget)).toHaveLength(5);
  const entry=profile.rows.find(r=>r.caseId.endsWith('native-open')&&r.step===0)!;
  expect(entry.input.target.semantic.role).toBe('heading');expect(entry.keyboardFocus).toMatchObject({role:'AXGroup',id:'panel'});
 }
});
