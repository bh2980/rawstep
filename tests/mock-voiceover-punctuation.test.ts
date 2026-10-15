import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,formatSimulatedSpeech,type SimulatedSemanticNode} from 'rawstep/mock-voiceover';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-2026-10-14.json',import.meta.url),'utf8')) as {
  observations:{observationId:string;semanticInput:SimulatedSemanticNode;checkedStateChanged:boolean;sourceCommand?:string;rawMainReceipts:string[]}[];
};
const whitespace=(text:string)=>text.replace(/\s+/g,' ').trim();
it.each(fixture.observations)('preserves native punctuation/case/order after whitespace folding for $observationId',observation=>{
  const result=formatVoiceOverSpeech({target:{identity:observation.observationId,semantic:observation.semanticInput},command:observation.sourceCommand??'next_item',checkedStateChanged:observation.checkedStateChanged});
  expect(whitespace(result.speech)).toBe(whitespace(observation.rawMainReceipts.join(' ')));
});
it('distinguishes generated separators from punctuation inside caller text',()=>{
  const semantic:SimulatedSemanticNode={role:'button',name:'Save, review, and close.',description:'Copies, not originals.',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false};
  expect(formatVoiceOverSpeech({target:{identity:'save',semantic},command:'next_item'}).speech).toBe('Save, review, and close. Copies, not originals. button');
  // Keep the existing low-level formatter's default punctuation for its callers.
  expect(formatSimulatedSpeech(semantic)).toBe('Save, review, and close., Copies, not originals., button');
});
it('preserves literal commas in field values and native table-dimension grammar',()=>{
  const semantic:SimulatedSemanticNode={role:'textbox',name:'Budget, current',value:'1,234.50',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false};
  expect(formatVoiceOverSpeech({target:{identity:'budget',semantic},command:'read_current'}).speech).toBe('Budget, current 1,234.50 edit text');
  expect(formatVoiceOverSpeech({target:{identity:'table',semantic:{...semantic,role:'table',name:'Drafts, current',value:undefined,rows:3,columns:2}},command:'next_item'}).speech).toBe('Drafts, current table 2 columns, 3 rows');
});

const content=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-speech-content-2026-10-15.json',import.meta.url),'utf8')) as {
  html:string;htmlSha256:string;attemptSummary:{planned:number;observed:number;startupFailures:number};
  profiles:{browser:'safari'|'chrome';predictedAt:string;nativeStartedAt:string;sourceRecordsSha256:string;
    rows:{input:Parameters<typeof formatVoiceOverSpeech>[0];utterances:{text:string}[];eligible:boolean;descriptionVerified:boolean;issues:string[];nativeAxSha256:string}[]}[];
};
it.each(content.profiles)('preserves native punctuation on verified $browser targets and retains unmeasured descriptions',profile=>{
  expect(createHash('sha256').update(content.html).digest('hex')).toBe(content.htmlSha256);
  expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
  expect(profile.sourceRecordsSha256).toMatch(/^[a-f0-9]{64}$/);
  let context:Parameters<typeof formatVoiceOverSpeech>[1],eligible=0,unknown=0;
  for(const row of profile.rows){
    expect(row.nativeAxSha256).toMatch(/^[a-f0-9]{64}$/);
    const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},context);context=result.context;
    if(row.eligible){eligible++;expect([result.speech,...(result.usageHint?[result.usageHint]:[])]).toEqual(row.utterances.map(u=>u.text));}
    else{unknown++;expect(row.descriptionVerified).toBe(false);expect(row.issues).toContain('description-unmeasured');}
  }
  expect({eligible,unknown}).toEqual({eligible:4,unknown:2});
  // Historical capture failures remain in the attempt-expanded denominator.
  expect(content.attemptSummary).toEqual({planned:42,observed:12,startupFailures:5});
});
