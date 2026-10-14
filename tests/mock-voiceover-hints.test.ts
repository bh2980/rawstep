import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {formatUsageHint,type HintContext} from '../packages/screenreaders/src/mock-voiceover/usage-hints.js';
import type {SimulatedSemanticNode} from '../packages/screenreaders/src/mock-voiceover/semantics.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-hints-2026-10-15.json',import.meta.url),'utf8')) as {
  observations:{sourceCaseId:string;semanticInput:Partial<SimulatedSemanticNode>;context:HintContext;rawHintReceipt:string;sourceRecordsSha256:string}[];
};
const node=(value:Partial<SimulatedSemanticNode>):SimulatedSemanticNode=>({role:'button',name:'',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,...value});
const whitespace=(s:string)=>s.replace(/\s+/g,' ').trim();
describe('native role, context and direction hint observations',()=>{
  it.each(fixture.observations)('preserves the observed words for $sourceCaseId',observation=>{
    expect(whitespace(formatUsageHint(node(observation.semanticInput),observation.context)!)).toBe(whitespace(observation.rawHintReceipt));
    expect(observation.sourceRecordsSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('does not invent instructions for unsupported or protected semantic inputs',()=>{
    expect(formatUsageHint(node({role:'unobserved-role'}))).toBeUndefined();
    expect(formatUsageHint(node({role:'textbox',protected:true,value:'do-not-use'}))).toBeUndefined();
  });
});
