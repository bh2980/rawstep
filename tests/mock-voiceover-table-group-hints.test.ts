import {readFileSync} from 'node:fs';import {expect,it} from 'vitest';import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const f=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-table-group-hints-2026-10-16.json',import.meta.url),'utf8')) as {profiles:{browser:string;summary:{fullSpeechExact:{matched:number}};rows:{caseId:string;step:number;verificationInput:VoiceOverSpeechInput;utterances:{text:string}[];evaluation:{eligible:boolean}}[]}[]};
it.each(f.profiles)('uses $browser nearest named group for checkbox hints while keeping ordinary/unnamed wrapping transparent',p=>{
 const contexts=new Map<string,VoiceOverSpeechContext>();expect(p.summary.fullSpeechExact.matched).toBe(14);let rows=0;
 for(const r of p.rows){expect(r.evaluation.eligible).toBe(true);const result=formatVoiceOverSpeech(r.verificationInput,contexts.get(r.caseId));contexts.set(r.caseId,result.context);expect([result.speech,...result.usageHint?[result.usageHint]:[]],`${r.caseId} ${r.step}`).toEqual(r.utterances.map(u=>u.text));rows++;}expect(rows).toBe(16);
});
