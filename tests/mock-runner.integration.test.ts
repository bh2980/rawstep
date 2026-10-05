import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMockVoiceOverTask } from '@rawstep/screenreaders/mock-voiceover';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import type { Observation } from '@rawstep/core/contracts';
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function setup(html:string){const dir=await mkdtemp(join(tmpdir(),'rawstep-mock-runner-'));dirs.push(dir);const path=join(dir,'page.html');await writeFile(path,html);return {dir,path};}
describe('actual browser mock runner integration',()=>{
 it('supports an actually focused open-shadow input through the shared runner guard and redacts persisted output',async()=>{
  const {dir,path}=await setup('<title>Before</title><div id="host"></div><script>const root=document.querySelector("#host").attachShadow({mode:"open"});root.innerHTML=`<input aria-label="Name">`;const field=root.querySelector("input");field.addEventListener("input",()=>document.title=field.value==="Az"?"Done":"Partial");</script>');
  const out=join(dir,'run');const observations:Observation[]=[];const policy=new ScriptedPolicy([{action:{kind:'intent',intent:'activate'}},{action:{kind:'typeText',input:'name'}}]);
  const trace=await runMockVoiceOverTask({url:path,goal:'Enter provided Name',input:{name:'Az'},verify:{all:[{titleIncludes:'Done'}]}},{outDir:out,headless:true,browserExecutablePath:process.env.RAWSTEP_TEST_BROWSER_PATH,warn:()=>{},policy:{decide:input=>{observations.push(input.observation);return policy.decide();}}});
  expect(trace.outcome?.status).toBe('success');expect(trace.environment.observationProvenance).toBe('simulation');
  expect(trace.events.filter(event=>event.type==='browser.input-gate').map(event=>(event.data as any).editable)).toEqual([true]);
  expect(observations.every(observation=>observation.kind==='screenreader'&&observation.provenance==='simulation')).toBe(true);
  expect(JSON.stringify(observations)).not.toMatch(/backendDOMNodeId|selector|semanticSource/);
  expect(await readFile(join(out,'trace.json'),'utf8')).not.toContain('Az');
  expect(trace.events.filter(event=>event.type==='simulation.observation').at(-1)?.redacted).toBe(true);
 });
});
