import { resolveTask } from '@rawstep/core/contracts';
import { describe, expect, it } from 'vitest';
import { resolveEnvironmentProfile, BUILTIN_PROFILES } from '@rawstep/browser/profiles';
import { parseCliArguments } from '@rawstep/cli/cli/args';
import { validateHumanEvidence, taskFingerprint, classifyRun } from '@rawstep/cli/matrix';
import type { RunTrace } from '@rawstep/core/trace';

describe('reproducible environment and user-test contracts',()=>{
  it.each(Object.keys(BUILTIN_PROFILES))('resolves built-in %s without shared mutable state',name=>{const a=resolveEnvironmentProfile(name),b=resolveEnvironmentProfile(name);a.viewport.width=600;expect(b.viewport.width).not.toBe(600);expect(b.id).toBe(name)});
  it.each([{id:'../escape'},{browserZoom:0},{textScale:Infinity},{viewport:{width:1,height:800}},{forcedColors:'native'},{contrast:'less'},{requireApplied:'false'},{unknown:true},{textSpacing:{lineHeight:1.5}},{at:{name:'Orca',version:48}}])('rejects invalid profile %j',profile=>expect(()=>resolveEnvironmentProfile(profile)).toThrow());
  it('loads profile/matrix CLI flags and rejects ambiguous factories',()=>{
    expect(parseCliArguments(['profiles']).command).toBe('profiles');
    expect(parseCliArguments(['matrix','task.json','--profiles','default,forced-colors','--model-endpoint','http://127.0.0.1:8766/choose','--out','run']).command).toBe('matrix');
    expect(()=>parseCliArguments(['matrix','task.json','--profiles','default','--script','script.json'])).toThrow(/out/);
    expect(()=>parseCliArguments(['run','task.json','--backend','orca','--policy','policy.mjs'])).toThrow(/browser-factory/);
    expect(()=>parseCliArguments(['doctor','--backend','orca','--endpoint','ws://localhost'])).toThrow(/local speech bridge/);
  });
  it('requires explicit source, consent and exact task identity for imported human findings',()=>{
    const record={id:'human-1',taskId:'task',profileId:'default',observedAt:'2026-10-01T12:00:00Z',sourceUrl:'https://example.com/test/1',consent:'confirmed',summary:'Reviewer reported blocked focus',result:'confirmed-defect',reviewer:'Consenting reviewer'};
    expect(validateHumanEvidence([record],'task')).toHaveLength(1);
    for(const override of [{consent:'unknown'},{taskId:'another'},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://secret@example.com'},{result:'certified'},{extra:true}])expect(()=>validateHumanEvidence([{...record,...override}],'task')).toThrow();
    expect(()=>validateHumanEvidence([record,record],'task')).toThrow();
  });
  it('compares stable task specs without exposing input values in task digest',()=>{const task={id:'task',url:'https://example.com',goal:'Test',input:{password:'PRIVATE_A_82'},verify:{all:[{titleIncludes:'Done'}]}};expect(taskFingerprint(task)).toBe(taskFingerprint({...task,input:{password:'PRIVATE_B_19'},profile:resolveEnvironmentProfile('dark')}));expect(taskFingerprint(task)).not.toBe(taskFingerprint({...task,goal:'Other'}))});
  it.each([
    [{status:'failure',reason:'error'},'runtime-error'],[{status:'inconclusive',reason:'unsupported-profile'},'unsupported-environment'],[{status:'success',reason:'verified'},'task-completed'],[{status:'failure',reason:'policy-stuck',policyStopSource:'model'},'model-failure'],[{status:'failure',reason:'policy-stuck',policyStopSource:'exploration-guard'},'inconclusive'],[{status:'inconclusive',reason:'policy-uncertain'},'inconclusive']
  ] as const)('classifies run outcomes without issuing a defect verdict', (outcome,expected)=>expect(classifyRun({outcome} as RunTrace)).toBe(expected));
});

describe('reviewed privacy and comparison regressions',()=>{
 it('does not relabel a scripted stuck stop as model failure',()=>expect(classifyRun({events:[],outcome:{status:'failure',reason:'policy-stuck'}} as unknown as RunTrace)).toBe('inconclusive'));
 it('does not count a task pass with live setting drift as a valid profile result',()=>expect(classifyRun({events:[{type:'browser.profile-check',data:{verified:false},redacted:true}],outcome:{status:'success',reason:'verified'}} as unknown as RunTrace)).toBe('unsupported-environment'));
 it('accepts explicit read-only navigation exclusions but rejects nonboolean opt-ins',()=>{
   const task={url:'https://example.com',goal:'Read',verify:{all:[{titleIncludes:'Example'}]}};
   expect(resolveTask({...task,navigation:{strategy:'same-origin',readOnly:true,denyUrlIncludes:['/login']}}).navigation).toMatchObject({readOnly:true,denyUrlIncludes:['/login']});
   expect(()=>resolveTask({...task,navigation:{strategy:'same-origin',readOnly:'false'}})).toThrow();
 });
});
