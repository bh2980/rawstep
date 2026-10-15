import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,formatVoiceOverActivation,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
import {normalize} from '../packages/vo-corpus/src/compare.js';
const audit=JSON.parse(readFileSync(new URL('../packages/vo-corpus/test/description-help-input-audit.json',import.meta.url),'utf8'));

for(const cohort of audit.cohorts){
 const fixture=JSON.parse(readFileSync(new URL(`./fixtures/voiceover-evidence/native-${cohort.name}-2026-10-16.json`,import.meta.url),'utf8')) as {profiles:{browser:'safari'|'chrome';rows:any[]}[]};
 it.each(fixture.profiles)(`formats AX-supplied source fields for $browser ${cohort.name} without navigation`,profile=>{
  const contexts=new Map<string,VoiceOverSpeechContext>(),observed=cohort.profiles.find((p:any)=>p.browser===profile.browser);let main=0,full=0;
  for(const row of profile.rows){
   const original=JSON.stringify(row.diagnostic),event=row.diagnostic.events[0],input=structuredClone(event.input),source=observed.rows.find((r:any)=>r.caseId===row.caseId&&r.step===row.step).observedSemantic;
   // AX-source inputs are an inspected formatter regression, separate from actual Rawstep projection tests.
   if(event.kind==='reading')Object.assign(input.target.semantic,{description:source.description||undefined,help:source.help||undefined,hasMoreContent:source.hasMoreContent});
   const previous=contexts.get(row.caseId);let utterances:string[],context:VoiceOverSpeechContext;
   if(event.kind==='reading'){const result=formatVoiceOverSpeech(input,previous);utterances=[result.speech,...(result.usageHint?[result.usageHint]:[])];context=result.context;expect(normalize(result.speech)).toBe(normalize(row.evaluation.nativeMain));}
   else{const result=formatVoiceOverActivation(input,previous);expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);utterances=result.utterances;context=result.context;expect(normalize(utterances.join(' '))).toBe(normalize(row.evaluation.nativeMain));}
   contexts.set(row.caseId,context);main++;
   const native=row.utterances.map((u:any)=>u.text);
   if(JSON.stringify(utterances)===JSON.stringify(native))full++;
   expect(utterances).toEqual(native.map((s:string)=>s.trimEnd()));expect(JSON.stringify(row.diagnostic)).toBe(original);
  }
  expect(main).toBe(cohort.name==='dialog-compositions'?39:15);
  expect(full).toBe(cohort.name==='dialog-compositions'?(profile.browser==='safari'?36:39):(profile.browser==='safari'?7:13));
 });
}
