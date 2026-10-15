import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,formatVoiceOverActivation,type VoiceOverSpeechInput,type VoiceOverActivationInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
import {normalize} from '../packages/vo-corpus/src/compare.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-dialog-transfer-2026-10-15.json',import.meta.url),'utf8')) as {
 plan:{priorInputCasesAudited:number;collisions:unknown[];casesSha256:string};pages:{html:string;htmlSha256:string}[];
 profiles:{browser:'safari'|'chrome';predictedAt:string;nativeStartedAt:string;summary:{planned:number;eligible:number;inputEquivalent:number;mainSpeechExact:{matched:number};fullSpeechExact:{matched:number};readingTargets:{matched:number};declaredStateFields:{matched:number;planned:number};tasks:{success:number;planned:number}};
 rows:{caseId:string;rendererDOMId:string;originalIdentity:string;verificationInput:VoiceOverSpeechInput&{beforeTarget?:VoiceOverSpeechInput['target']};diagnostic:{events:({kind:'reading';input:VoiceOverSpeechInput;previousContext:VoiceOverSpeechContext;emitted:boolean}|{kind:'activation';input:VoiceOverActivationInput;previousContext:VoiceOverSpeechContext;status:string})[]};evaluation:{eligible:boolean;nativeMain:string}}[]}[];
};
const quality=JSON.parse(readFileSync(new URL('../packages/vo-corpus/test/dialog-transfer-state-quality.json',import.meta.url),'utf8')) as {fixtureSha256:string;planned:number;verified:number;rows:{nativeObjectErrors:unknown[];modelObjectErrors:unknown[]}[]};

it.each(fixture.profiles)('preserves first $browser task measurements and unmodified actual Rawstep inputs',profile=>{
 expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));expect(fixture.plan.priorInputCasesAudited).toBe(859);expect(fixture.plan.collisions).toEqual([]);
 expect(quality.fixtureSha256).toBe(createHash('sha256').update(readFileSync(new URL('./fixtures/voiceover-evidence/native-dialog-transfer-2026-10-15.json',import.meta.url))).digest('hex'));
 expect([quality.planned,quality.verified,quality.rows.length]).toEqual([80,80,80]);expect(quality.rows.every(r=>!r.nativeObjectErrors.length&&!r.modelObjectErrors.length)).toBe(true);
 for(const p of fixture.pages)expect(createHash('sha256').update(p.html).digest('hex')).toBe(p.htmlSha256);
 expect(profile.summary).toMatchObject({planned:40,eligible:40,inputEquivalent:40,mainSpeechExact:{matched:34},fullSpeechExact:{matched:31},readingTargets:{matched:40},declaredStateFields:{matched:82,planned:82},tasks:{success:2,planned:2}});
 for(const row of profile.rows){
  expect(row.diagnostic.events).toHaveLength(1);const actual=row.diagnostic.events[0]!.input,view=structuredClone(actual);
  expect(actual.target.identity).toBe(row.originalIdentity);view.target.identity=row.rendererDOMId;
  if('beforeTarget' in view&&view.beforeTarget)view.beforeTarget.identity=row.rendererDOMId;
  expect(view).toEqual(row.verificationInput);expect(row.evaluation.eligible).toBe(true);
 }
});

it.each(fixture.profiles)('replays $browser Native speech from the fixed actual inputs with current history rules',profile=>{
 const contexts=new Map<string,VoiceOverSpeechContext>();let matched=0;
 for(const row of profile.rows){const event=row.diagnostic.events[0]!,previous=contexts.get(row.caseId);let speech:string,context:VoiceOverSpeechContext;
  if(event.kind==='reading'){const result=formatVoiceOverSpeech(event.input,previous);speech=result.speech;context=result.context;}
  else{const result=formatVoiceOverActivation(event.input,previous);expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);speech=result.utterances.join(' ');context=result.context;}
  contexts.set(row.caseId,context);expect(normalize(speech),`${row.caseId}: ${row.rendererDOMId}`).toBe(normalize(row.evaluation.nativeMain));matched++;
 }
 expect(matched).toBe(40);
});
