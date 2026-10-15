import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {formatVoiceOverActivation,formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
type Row={caseId:string;step:number;chord:string;input:VoiceOverSpeechInput;utterances:{text:string}[];evaluation:{eligible:boolean}};
type Profile={browser:'safari'|'chrome';rows:Row[]};
for(const name of ['button-state-speech','checkbox-speech']){
 const fixture=JSON.parse(readFileSync(new URL(`./fixtures/voiceover-evidence/native-${name}-2026-10-15.json`,import.meta.url),'utf8')) as {profiles:Profile[]};
 it.each(fixture.profiles)(`replays ${name} ordered Native receipt candidates for $browser`,profile=>{
  const contexts=new Map<string,VoiceOverSpeechContext>(),prior=new Map<string,VoiceOverSpeechInput['target']>();let eligible=0,diagnostic=0;
  for(const row of profile.rows){
   let utterances:string[],context:VoiceOverSpeechContext;
   if(['Space','VO+Space'].includes(row.chord)){
    const result=formatVoiceOverActivation({...row.input,referenceBrowser:profile.browser,beforeTarget:prior.get(row.caseId)},contexts.get(row.caseId));
    expect(result.status).toBe('modeled');if(result.status!=='modeled')throw new Error(result.reason);
    ({utterances,context}=result);
   }else{
    const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},contexts.get(row.caseId));
    utterances=[result.speech,...result.usageHint?[result.usageHint]:[]];context=result.context;
   }
   expect(utterances,`${row.caseId} ${row.step}`).toEqual(row.utterances.map(u=>u.text));diagnostic++;
   if(row.evaluation.eligible)eligible++;
   contexts.set(row.caseId,context);prior.set(row.caseId,row.input.target);
  }
  expect({diagnostic,eligible}).toEqual(name==='checkbox-speech'?{diagnostic:40,eligible:40}:{diagnostic:25,eligible:profile.browser==='safari'?20:25});
 });
}
const semantic={role:'button',tagName:'button',name:'Options',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false};
it('keeps activation receipts separate from structural reading history and caller-owned state',()=>{
 const beforeTarget={identity:'options',semantic:{...semantic,pressed:false,expanded:false}},target={...beforeTarget,semantic:{...semantic,pressed:true,expanded:true}};
 const previous:VoiceOverSpeechContext={containers:['outer','table'],focusContext:'table',column:{table:'table',column:1}};
 const snapshot=structuredClone({beforeTarget,target,previous});
 const result=formatVoiceOverActivation({beforeTarget,target,command:'activate_form_control',referenceBrowser:'chrome'},previous);
 expect(result).toMatchObject({status:'modeled',utterances:['selected Options toggle button','Options selected toggle button','Options selected toggle button'],context:previous});
 expect({beforeTarget,target,previous}).toEqual(snapshot);expect(result.context).not.toBe(previous);expect(result.context.column).not.toBe(previous.column);
});
it('reports unsupported activation evidence explicitly instead of guessing an object announcement',()=>{
 const beforeTarget={identity:'options',semantic},base={beforeTarget,target:beforeTarget,command:'activate_form_control'};
 for(const input of [{...base,beforeTarget:undefined},{...base,command:'activate_button'},{...base,command:'read_current'},
  {...base,target:{...beforeTarget,identity:'another'}},{...base,target:{...beforeTarget,semantic:{...semantic,name:'Renamed'}}},
  {...base,target:{...beforeTarget,semantic:{...semantic,disabled:true}}},
  {...base,beforeTarget:{...beforeTarget,semantic:{...semantic,pressed:false}},target:{...beforeTarget,semantic:{...semantic,pressed:'mixed' as const}}},
 ]){
  const result=formatVoiceOverActivation(input);expect(result.status).toBe('unsupported');expect(result).not.toHaveProperty('utterances');
 }
 expect(formatVoiceOverActivation(base)).toMatchObject({status:'modeled',utterances:[]});
});
