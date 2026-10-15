import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {formatVoiceOverActivation,formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext,type VoiceOverActivationInput} from 'rawstep/mock-voiceover';
type Row={caseId:string;step:number;chord:string;diagnostic:{events:{kind:string}[]};verificationInput:VoiceOverSpeechInput&Pick<VoiceOverActivationInput,'beforeTarget'>;utterances:{text:string}[];evaluation:{eligible:boolean};readingTarget:{status:string}};
for(const cohort of ['calibration','transfer']){
const fixture=JSON.parse(readFileSync(new URL(`./fixtures/voiceover-evidence/native-table-state-${cohort}-2026-10-16.json`,import.meta.url),'utf8')) as {profiles:{browser:'safari'|'chrome';summary:{mainSpeechExact:{matched:number};declaredStateTransitions:{matched:number}};rows:Row[]}[]};
it.each(fixture.profiles)(`reproduces $browser Native ${cohort} checkbox events with evolving history`,p=>{
 const contexts=new Map<string,VoiceOverSpeechContext>();let count=0;
 expect(p.summary.mainSpeechExact.matched).toBe(cohort==='calibration'?(p.browser==='safari'?20:22):30);expect(p.summary.declaredStateTransitions.matched).toBe(cohort==='calibration'?12:9);
 for(const row of p.rows){
  expect(row.evaluation.eligible).toBe(true);expect(row.readingTarget.status).toBe('matched');const input=row.verificationInput,previous=contexts.get(row.caseId),snapshot=structuredClone({input,previous});let utterances:string[],context:VoiceOverSpeechContext;
  if(row.diagnostic.events[0]!.kind==='activation'){
   const result=formatVoiceOverActivation(input,previous);expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);({utterances,context}=result);
  }else{const result=formatVoiceOverSpeech(input,previous);utterances=[result.speech,...result.usageHint?[result.usageHint]:[]];context=result.context;}
  expect(utterances,`${row.caseId} ${row.step}`).toEqual(row.utterances.map(u=>u.text));expect({input,previous}).toEqual(snapshot);contexts.set(row.caseId,context);count++;
 }expect(count).toBe(cohort==='calibration'?24:30);
});
}
it.each(['safari','chrome'] as const)('%s keeps ordinary cell reading distinct from an isolated checkbox transition',referenceBrowser=>{
 const target={identity:'warning',semantic:{role:'checkbox',name:'Storm warning',checked:true,protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false},cell:{table:'schedule',row:1,column:1,rows:2,columns:2,header:'Alert',rowSpan:1,columnSpan:1},containers:[{id:'schedule',role:'table',name:'Sample schedule',items:2,rows:2,columns:2}]};
 const entry=formatVoiceOverSpeech({target,referenceBrowser,command:'next_focusable_item'});
 expect(formatVoiceOverSpeech({target,referenceBrowser,command:'activate_form_control',checkedStateChanged:true},entry.context).speech).toBe('checked Storm warning checkbox');
 expect(formatVoiceOverSpeech({target,referenceBrowser,command:'next_item'}).speech).toContain('row 2 of 2 Alert Storm warning checked checkbox column 2 of 2');
});
