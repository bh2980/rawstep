import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,formatVoiceOverActivation,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-hint-source-context-2026-10-16.json',import.meta.url),'utf8')) as {profiles:{browser:'safari'|'chrome';rows:any[]}[];pages:{id:string;html:string}[]};

it.each(fixture.profiles)('$browser replays every independently verified predeclared authored-help candidate',p=>{
 let compared=0;
 for(const r of p.rows){
  if(!r.authoredSourceEvaluation.eligible)continue;
  const result=formatVoiceOverSpeech(r.authoredSourceInput,r.diagnostic.events[0].previousContext);
  expect([result.speech,...(result.usageHint?[result.usageHint]:[])]).toEqual(r.utterances.map((u:{text:string})=>u.text));compared++;
 }
 expect(compared).toBe(p.browser==='safari'?27:23);
});

it('keeps an unnamed form transparent for focus moves without removing named outer context or caller data',()=>{
 const input:VoiceOverSpeechInput={command:'next_focusable_item',target:{identity:'save',semantic:{role:'button',name:'Save itinerary',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false},containers:[{id:'form',role:'form',name:'',items:2}]}},snapshot=structuredClone(input);
 const result=formatVoiceOverSpeech(input);expect(result.speech).toBe('Save itinerary button');expect(result.usageHint).toContain('inside of web content');expect(result.context.containers).toEqual([]);expect(input).toEqual(snapshot);
 const outer={id:'region',role:'region',name:'Travel tools',items:2};input.target.containers=[outer,...input.target.containers!];
 const nested=formatVoiceOverSpeech(input);expect(nested.speech).toBe('Save itinerary button Travel tools region');expect(nested.usageHint).not.toContain('inside of web content');expect(nested.context.containers).toEqual(['region']);
 input.target.containers=[{id:'form',role:'form',name:'Travel choices',items:2}];expect(formatVoiceOverSpeech(input).speech).toBe('Save itinerary button Travel choices form');
});

const transfer=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-hint-context-transfer-2026-10-16.json',import.meta.url),'utf8')) as {profiles:{browser:'safari'|'chrome';rows:any[]}[]};
it.each(transfer.profiles)('$browser replays the reserved task and link sequence with actual pre-Native inputs',p=>{
 const contexts=new Map<string,VoiceOverSpeechContext>();let compared=0;
 for(const r of p.rows){
  const event=r.diagnostic.events[0],previous=contexts.get(r.caseId);let utterances:string[],context:VoiceOverSpeechContext;
  if(event.kind==='reading'){const result=formatVoiceOverSpeech(r.verificationInput,previous);utterances=[result.speech,...(result.usageHint?[result.usageHint]:[])];context=result.context;}
  else{const result=formatVoiceOverActivation(r.verificationInput,previous);expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);utterances=result.utterances;context=result.context;}
  expect(utterances,`${r.caseId} step ${r.step}`).toEqual(r.utterances.map((u:{text:string})=>u.text));contexts.set(r.caseId,context);compared++;
 }
 expect(compared).toBe(24);
});
