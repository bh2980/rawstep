import { resolveTask } from '@rawstep/core/contracts';
import { describe, expect, it } from 'vitest';
import { resolveEnvironmentProfile, BUILTIN_PROFILES } from '@rawstep/browser/profiles';

describe('reproducible environment contracts',()=>{
  it.each(Object.keys(BUILTIN_PROFILES))('resolves built-in %s without shared mutable state',name=>{const a=resolveEnvironmentProfile(name),b=resolveEnvironmentProfile(name);a.viewport.width=600;expect(b.viewport.width).not.toBe(600);expect(b.id).toBe(name)});
  it.each([{id:'../escape'},{browserZoom:0},{textScale:Infinity},{viewport:{width:1,height:800}},{forcedColors:'native'},{contrast:'less'},{requireApplied:'false'},{unknown:true},{textSpacing:{lineHeight:1.5}},{at:{name:'Orca',version:48}}])('rejects invalid profile %j',profile=>expect(()=>resolveEnvironmentProfile(profile)).toThrow());
});

describe('reviewed privacy and comparison regressions',()=>{
 it('accepts explicit read-only navigation exclusions but rejects nonboolean opt-ins',()=>{
   const task={url:'https://example.com',goal:'Read',verify:{all:[{titleIncludes:'Example'}]}};
   expect(resolveTask({...task,navigation:{strategy:'same-origin',readOnly:true,denyUrlIncludes:['/login']}}).navigation).toMatchObject({readOnly:true,denyUrlIncludes:['/login']});
   expect(()=>resolveTask({...task,navigation:{strategy:'same-origin',readOnly:'false'}})).toThrow();
 });
});
