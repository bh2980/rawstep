import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Backend, BackendAction } from '@rawstep/core/contracts';
import type { BrowserSession } from '@rawstep/browser/browser';
import { runTask } from '@rawstep/browser/runner';
import { TraceRecorder, validateTrace } from '@rawstep/core/trace';

const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function directory(){const value=await mkdtemp(join(tmpdir(),'rawstep-simulation-source-'));dirs.push(value);return value;}
function fixture(){
 const listeners=new Set<(value:unknown)=>void>();let sequence=0;let entered=false;
 const backend:Backend={evidenceProvenance:'simulation',observationKind:'screenreader',capabilities:{intents:['next'],keys:[],textEntry:true,replaceText:false},
  start:async()=>({backend:'mock-voiceover',evidenceProvenance:'simulation',environment:{atName:'Mock VoiceOver',atVersion:'simulation'}}),
  subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
  execute:async(action:BackendAction)=>{if(action.kind==='typeText')entered=true;},
  observe:async()=>{const time=new Date().toISOString();const text=entered?'Echo A z':'Save, button';const output={sequence:++sequence,receivedAt:time,text,raw:{simulated:true,semantic:{name:text,role:'button'}}};for(const listener of listeners)listener({type:'output',output});return{windowId:String(sequence),startedAt:time,endedAt:time,reason:'simulation',outputs:[output],speech:[text]};},close:async()=>{}
 };
 const browser={page:{bringToFront:async()=>{},evaluate:async()=>true},browser:{version:()=> 'fake-test-only'},takeBlockedNavigations:()=>[],takeNavigationGuardWarnings:()=>[],close:async()=>{}} as unknown as BrowserSession;
 return {backend,browserSessionFactory:async()=>browser,verifier:async()=>({passed:true,failures:[]})};
}
describe('explicit simulation provenance',()=>{
 it('keeps simulated speech separate from native evidence while exposing only the text observation contract',async()=>{
  const f=fixture();const observed:unknown[]=[];
  const trace=await runTask({url:'https://example.test',goal:'Activate Save',input:{short:'a'},verify:{all:[{titleIncludes:'Done'}]}},{...f,outDir:await directory(),policy:{decide:input=>{observed.push(input.observation);return{action:{kind:'intent',intent:'next'}};}}});
  expect(trace.schemaVersion).toBe('2.2');expect(trace.environment.observationProvenance).toBe('simulation');
  expect(trace.events.filter(event=>event.source==='screen-reader')).toHaveLength(0);
  expect(trace.events.some(event=>event.source==='simulation'&&event.type==='simulation.observation')).toBe(true);
  expect(observed[0]).toMatchObject({kind:'screenreader',provenance:'simulation',speech:['Save, button']});
  expect(JSON.stringify(observed)).not.toMatch(/semantic|backendDOMNodeId|selector/);
 });
 it('retains simulation identity while redacting later speech fragments after input',async()=>{
  const f=fixture();const out=await directory();
  const trace=await runTask({url:'https://example.test',goal:'Enter provided input',input:{q:'Az'},verify:{all:[{titleIncludes:'Done'}]}},{...f,outDir:out,policy:{decide:()=>({action:{kind:'typeText',input:'q'}})}});
  expect(await readFile(join(out,'trace.json'),'utf8')).not.toContain('Echo A z');
  const events=trace.events.filter(event=>event.type==='simulation.observation');expect(events[1]?.redacted).toBe(true);expect(events[1]?.data).toMatchObject({provenance:'simulation'});
 });
 it('reads old native schema2.0 traces but does not allow simulation to masquerade under the old schema',async()=>{
  const recorder=new TraceRecorder({id:'simulation'},await directory());await recorder.initialize();recorder.append('simulation.output',{text:'Save button'},{source:'simulation'});
  const trace=await recorder.finalize({status:'inconclusive'});expect(()=>validateTrace(trace)).not.toThrow();
  expect(()=>validateTrace({...trace,schemaVersion:'2.0'})).toThrow('Simulation evidence requires');
  expect(()=>validateTrace({...trace,schemaVersion:'2.0',events:trace.events.map(event=>({...event,type:'screen-reader.output',source:'screen-reader'}))})).not.toThrow();
 });
});
