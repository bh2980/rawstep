import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-speech-transfer-2026-10-15.json',import.meta.url),'utf8')) as {
 plan:{speechInputsSha256:string};pages:{html:string;htmlSha256:string}[];
 profiles:{predictedAt:string;nativeStartedAt:string;browser:'safari'|'chrome';summary:{planned:number;eligible:number;mainSpeechExact:{matched:number}};
 rows:{caseId:string;step:number;input:VoiceOverSpeechInput;utterances:{text:string}[];evaluation:{eligible:boolean;nativeMain:string;nativeHint:string};transition?:{status:string;before:boolean;after:boolean}}[]}[];
};
const fold=(s:string)=>s.replace(/\s+/g,' ').trim();
it.each(fixture.profiles)('matches Native description/state wording in the inspected $browser transfer cohort',profile=>{
 expect(profile.summary.mainSpeechExact.matched).toBe(15); // Frozen first evaluation; never rewrite after calibration.
 expect(profile.summary).toMatchObject({planned:21,eligible:21});
 expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
 const contexts=new Map<string,VoiceOverSpeechContext>();let transitions=0,literalFull=0,foldedFull=0;
 const inputs:Record<string,VoiceOverSpeechInput[]>={};
 for(const row of profile.rows){
  expect(row.evaluation.eligible).toBe(true);
  (inputs[row.caseId]??=[]).push(row.input);
  const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},contexts.get(row.caseId));contexts.set(row.caseId,result.context);
  expect(fold(result.speech)).toBe(fold(row.evaluation.nativeMain));
  expect(fold(result.usageHint??'')).toBe(fold(row.evaluation.nativeHint));
  const candidate=[result.speech,...result.usageHint?[result.usageHint]:[]],native=row.utterances.map(u=>u.text);
  expect(candidate).toEqual(native);
  literalFull+=Number(JSON.stringify(candidate)===JSON.stringify(native));foldedFull+=Number(JSON.stringify(candidate.map(fold))===JSON.stringify(native.map(fold)));
  if(row.input.checkedStateChanged){transitions++;expect(row.transition).toMatchObject({status:'verified',before:!row.input.target.semantic.checked,after:row.input.target.semantic.checked});}
 }
 expect(transitions).toBe(5);expect(literalFull).toBe(21);expect(foldedFull).toBe(21);
 expect(createHash('sha256').update(JSON.stringify(inputs,null,2)+'\n').digest('hex')).toBe(fixture.plan.speechInputsSha256);
 for(const page of fixture.pages)expect(createHash('sha256').update(page.html).digest('hex')).toBe(page.htmlSha256);
});
it('does not turn a state-action hint rule into a rule for reading the same checked control',()=>{
 const row=fixture.profiles[0]!.rows.find(r=>r.input.checkedStateChanged)!;
 expect(formatVoiceOverSpeech({...row.input,command:'read_current',checkedStateChanged:false}).usageHint).toBeTruthy();
});
