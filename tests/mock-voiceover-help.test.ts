import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechContext} from 'rawstep/mock-voiceover';
const evidence=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-additional-content-2026-10-15.json',import.meta.url),'utf8')) as {
  pages:{html:string;htmlSha256:string}[];attemptSummary:{planned:number;observed:number;startupFailures:number};
  profiles:{browser:'safari'|'chrome';predictedAt:string;nativeStartedAt:string;
    rows:{caseId:string;mode:string;step:number;input:VoiceOverSpeechInput;utterances:{text:string}[];
      inputVerified:boolean;originalInputEquivalent:boolean;customContent:{status:string;hasMoreContent:boolean;entries:{value:string}[]};observedHelp:string;}[]}[];
};
it.each(evidence.profiles)('reproduces observed description/help placement on first entry and return for $browser',profile=>{
  expect(Date.parse(profile.predictedAt)).toBeLessThan(Date.parse(profile.nativeStartedAt));
  let literalFull=0;const contexts=new Map<string,VoiceOverSpeechContext>();
  for(const row of profile.rows){
    expect(row.inputVerified).toBe(true);expect(row.customContent.status).toBe('observed');
    const semantic=row.input.target.semantic;
    expect(semantic.hasMoreContent).toBe(row.customContent.hasMoreContent);
    expect(semantic.description??'').toBe(row.customContent.entries.map(e=>e.value).join(' '));
    expect(semantic.help??'').toBe(row.observedHelp);
    const result=formatVoiceOverSpeech({...row.input,referenceBrowser:profile.browser},contexts.get(row.caseId));
    contexts.set(row.caseId,result.context);
    expect(result.speech).toBe(row.utterances[0]!.text);
    const generated=[result.speech,result.usageHint],native=row.utterances.map(u=>u.text);
    expect(generated).toEqual(native);literalFull++;
    if(row.observedHelp)expect(row.originalInputEquivalent).toBe(false);
  }
  expect(profile.rows).toHaveLength(12);expect(literalFull).toBe(12);
});
it('keeps shared HTML and all planned observations intact',()=>{
  expect(evidence.attemptSummary).toEqual({planned:24,observed:24,startupFailures:0});
  for(const page of evidence.pages)expect(createHash('sha256').update(page.html).digest('hex')).toBe(page.htmlSha256);
});
it('does not infer more content from an arbitrary description and withholds protected hints',()=>{
  const semantic={role:'button',name:'Print',description:'A caller-provided note',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false};
  const input={target:{identity:'print',semantic},command:'read_current'};
  expect(formatVoiceOverSpeech(input).usageHint).not.toContain('more content menu');
  expect(formatVoiceOverSpeech({...input,target:{...input.target,semantic:{...semantic,protected:true,help:'Private help',hasMoreContent:true}}}).usageHint).toBeUndefined();
});
