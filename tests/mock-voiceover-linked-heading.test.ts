import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-linked-heading-source-2026-10-16.json',import.meta.url),'utf8')) as {profiles:{browser:'safari'|'chrome';rows:any[]}[]};

it.each(fixture.profiles)('$browser preserves literal measured link/heading hint roles and heading spacing',p=>{
 let compared=0;
 for(const r of p.rows){
  // Old Chrome inner-link snapshots omit disclosure level; keep their input unknown.
  if(p.browser==='chrome'&&r.caseId.endsWith('.heading-outside')&&r.step!==1)continue;
  const input=r.verificationInput as VoiceOverSpeechInput,snapshot=structuredClone(input);
  const result=formatVoiceOverSpeech(input,r.diagnostic.events[0].previousContext);
  expect([result.speech,...(result.usageHint?[result.usageHint]:[])],`${r.caseId} step ${r.step}`).toEqual(r.utterances.map((u:{text:string})=>u.text));
  expect(input).toEqual(snapshot);compared++;
 }
 expect(compared).toBe(p.browser==='safari'?12:10);
});

it('keeps independently supplied disclosure level separate from heading level and Safari wording',()=>{
 const row=fixture.profiles[1]!.rows.find(r=>r.caseId.endsWith('.heading-outside'));
 const input:VoiceOverSpeechInput=structuredClone(row.verificationInput);input.target.semantic.nativeDisclosureLevel=1;
 expect(formatVoiceOverSpeech(input).speech).toBe(row.evaluation.nativeMain);
 input.target.semantic.level=4;input.target.semantic.nativeDisclosureLevel=3;
 expect(formatVoiceOverSpeech(input).speech).toBe('heading level 4 level 3 link Harbor itinerary');
 expect(formatVoiceOverSpeech({...input,referenceBrowser:'safari'}).speech).toBe('heading level 4 link Harbor itinerary');
 delete input.target.semantic.nativeDisclosureLevel;
 expect(formatVoiceOverSpeech(input).speech).toBe('heading level 4 link Harbor itinerary');
});
