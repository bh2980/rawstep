import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-list-profiles-calibration-2026-10-16.json',import.meta.url),'utf8')) as {profiles:{browser:'safari'|'chrome';rows:{caseId:string;verificationInput:VoiceOverSpeechInput;utterances:{text:string}[];evaluation:{eligible:boolean}}[]}[]};

it('reproduces independently observed Safari list entry/return receipts from the retained actual inputs',()=>{
 const profile=fixture.profiles.find(p=>p.browser==='safari')!,contexts=new Map<string,VoiceOverSpeechContext>();let actions=0;
 for(const row of profile.rows.filter(r=>r.caseId.endsWith('.ul-none-role')||r.caseId.endsWith('.ul-none-nav'))){
  expect(row.evaluation.eligible).toBe(true);
  const result=formatVoiceOverSpeech(row.verificationInput,contexts.get(row.caseId));contexts.set(row.caseId,result.context);
  expect([result.speech,...result.usageHint?[result.usageHint]:[]]).toEqual(row.utterances.map(u=>u.text));actions++;
 }
 expect(actions).toBe(12);
});

it.each(['safari','chrome'] as const)('%s keeps object ordinals separate from nearest-list focus entry and suppresses repeated focus context',referenceBrowser=>{
 const target={identity:'reference',semantic:{role:'link',name:'Reference',position:1,setSize:2,protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false},containers:[{id:'routes',role:'navigation',name:'Resource routes',items:1},{id:'resources',role:'list',name:'',items:2}]};
 const format=(command:string,previous?:VoiceOverSpeechContext)=>formatVoiceOverSpeech({target,command,referenceBrowser},previous);
 expect(format('next_item').speech).toContain('link Reference 1 of 2');
 const entry=format('next_focusable_item');
 expect(entry.speech).toBe('link Reference list 2 items');
 expect(format('next_focusable_item',entry.context).speech).toBe('link Reference');
 const outside=formatVoiceOverSpeech({target:{...target,identity:'outside',containers:[]},command:'next_focusable_item',referenceBrowser},entry.context);
 expect(format('previous_focusable_item',outside.context).speech).toBe(entry.speech);
 expect(target.semantic.position).toBe(1);
 expect(format('next_item').speech).toContain('link Reference 1 of 2');
});
