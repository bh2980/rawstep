import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,formatVoiceOverActivation} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/voiceover-evidence/native-practical-speech-tasks-2026-10-16.json.gz',import.meta.url))).toString()) as {profiles:{browser:'safari'|'chrome';rows:any[]}[]};
it.each(fixture.profiles)('$browser preserves every first input-verified practical-task receipt',p=>{
 let compared=0;
 for(const row of p.rows){
  if(!row.evaluation.eligible)continue;const event=row.diagnostic.events[0];let actual:string[];
  if(event.kind==='activation'){const result=formatVoiceOverActivation(row.verificationInput,event.previousContext);expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);actual=result.utterances;}
  else{const result=formatVoiceOverSpeech(row.verificationInput,event.previousContext);actual=[result.speech,...(result.usageHint?[result.usageHint]:[])];}
  expect(actual,`${row.caseId} ${row.step}`).toEqual(row.utterances.map((u:{text:string})=>u.text));compared++;
 }
 expect(compared).toBe(p.browser==='safari'?29:35);
});
