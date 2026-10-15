import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
import {normalize,splitSpeech} from '../packages/vo-corpus/src/compare.js';
import type {Case} from '../packages/vo-corpus/src/cases.js';

type Fixture={
  caseSetMetadata:{id:string;generatedAt:string;syntheticInputs:boolean};
  plan:{casesSha256:string;speechInputsSha256:string;modelBuildSha256:string;frozenAt:string};
  inputs:{case:Case;html:string;htmlSha256:string}[];callerInputs:Record<string,VoiceOverSpeechInput[]>;
  nativeProfiles:{browser:'safari'|'chrome';predictedAt:string;nativeStartedAt:string;sourceRecordsSha256:string;
    summary:{planned:number;eligible:number;mainSpeechExact:{matched:number};fullSpeechExact:{matched:number}};
    rows:{caseId:string;step:number;eligible:boolean;nativeAxSha256:string;nativeUtterances:{t:number;text:string}[];issues:string[];inputVerification:{status:string;observedTarget:{role:string;name:string}}}[]}[];
};
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-speech-contexts-2026-10-15.json',import.meta.url),'utf8')) as Fixture;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
it('preserves the shared inputs frozen before native browser observation',()=>{
  const cases={...fixture.caseSetMetadata,cases:fixture.inputs.map(i=>i.case)};
  const inputHash=createHash('sha256').update(JSON.stringify(cases,null,2));
  for(const input of [...fixture.inputs].sort((a,b)=>a.case.page.localeCompare(b.case.page))){
    expect(hash(input.html)).toBe(input.htmlSha256);inputHash.update(input.case.page).update(input.html);
  }
  expect(inputHash.digest('hex')).toBe(fixture.plan.casesSha256);
  expect(hash(JSON.stringify(fixture.callerInputs,null,2)+'\n')).toBe(fixture.plan.speechInputsSha256);
});
it.each(fixture.nativeProfiles)('matches native $browser speech for the observed target/state/context inputs',profile=>{
  const contexts=new Map<string,VoiceOverSpeechContext>();
  expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
  expect(profile.sourceRecordsSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(profile.rows).toHaveLength(60);
  for(const row of profile.rows){
    expect(row.eligible).toBe(true);expect(row.issues).toEqual([]);expect(row.inputVerification.status).toBe('verified');
    const input=fixture.callerInputs[row.caseId]![row.step]!;
    expect(row.inputVerification.observedTarget.name).toBe(input.target.semantic.name);
    expect(row.inputVerification.observedTarget.role).toBe(input.target.semantic.role);
    expect(row.nativeAxSha256).toMatch(/^[a-f0-9]{64}$/);
    const result=formatVoiceOverSpeech({...input,referenceBrowser:profile.browser},contexts.get(row.caseId));
    const native=splitSpeech(row.nativeUtterances);
    expect(normalize(result.speech),`${row.caseId} ${row.step} main`).toBe(normalize(native.main));
    expect(normalize(result.usageHint??''),`${row.caseId} ${row.step} hint`).toBe(normalize(native.hint));
    contexts.set(row.caseId,result.context);
  }
  // Historical first-evaluation metrics remain distinct from any later calibrated engine build.
  expect(profile.summary.eligible).toBe(60);expect(profile.summary.mainSpeechExact.matched).toBe(60);
  expect(profile.summary.fullSpeechExact.matched).toBe(0);
});
