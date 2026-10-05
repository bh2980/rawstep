import {afterEach,describe,expect,it} from 'vitest';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {exportScreenshotReplay,runScreenshotReplay,runScreenshotTask,ScreenshotDecisionPolicy,ScreenshotReplayPolicy,validateScreenshotReplay} from 'rawstep/screenshot';import type {Task} from '@rawstep/core/contracts';import {hydrateScreenshots,type RunTrace} from '@rawstep/core/trace';import {createTestBrowserSession} from './helpers/browser.js';
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f()});
async function dir(){const p=await mkdtemp(join(tmpdir(),'rawstep-replay-'));cleanup.push(()=>rm(p,{recursive:true,force:true}));return p}
const task:Task={mode:'keyboard',url:pathToFileURL(resolve('fixtures/screenshot-keyboard.html')).href,goal:'Activate Finish task',maxSteps:6,verify:{all:[{textVisibleExact:'Task completed successfully'}]}};
async function source(outDir?:string){let n=0;return runScreenshotTask(task,{outDir:outDir??await dir(),browserSessionFactory:createTestBrowserSession,policy:new ScreenshotDecisionPolicy({model:{choose:async()=>({choiceId:['key:Tab','key:Tab','key:Enter'][n++]!,model:{id:'test-double',runtime:'unit-only'}})}})})}
describe('exact-pixel replay/export primitive, fixture adapters only',()=>{
 it('exports a witnessed successful model path and re-verifies it in fresh Chromium',async()=>{const trace=await source();const replay=exportScreenshotReplay(trace,task);expect(replay.steps.map(s=>s.key)).toEqual(['Tab','Tab','Enter']);expect(JSON.stringify(replay)).not.toMatch(/pngBase64|test-double/);const run=await runScreenshotReplay(task,replay,{outDir:await dir(),browserSessionFactory:createTestBrowserSession});expect(run.outcome?.status).toBe('success');expect(run.events.some(e=>e.type==='verifier.evidence')).toBe(true);expect(run.events.filter(e=>e.type==='policy.evidence').every(e=>JSON.stringify(e.data).includes('deterministic-replay'))).toBe(true)});
 it('rejects failed, unwitnessed, redacted, scripted or task-mismatched exports',async()=>{const original=await source();const mutate=(fn:(t:RunTrace)=>void)=>{const t=structuredClone(original);fn(t);return t};for(const t of [mutate(t=>{t.outcome!.status='failure'}),mutate(t=>{t.events=t.events.filter(e=>e.type!=='verifier.evidence')}),mutate(t=>{t.events[0]!.redacted=true}),mutate(t=>{t.events=t.events.filter(e=>e.type!=='policy.evidence')})])expect(()=>exportScreenshotReplay(t,task)).toThrow();expect(()=>exportScreenshotReplay(original,{...task,goal:'Different'})).toThrow(/contract/);expect(()=>exportScreenshotReplay(original,{...task,input:{secret:'PRIVATE'}})).toThrow(/inputs/)});
 it('rejects a changed task verifier before browser launch',async()=>{const replay=exportScreenshotReplay(await source(),task);let launches=0;await expect(runScreenshotReplay({...task,verify:{all:[{titleIncludes:'Wrong'}]}},replay,{outDir:await dir(),browserSessionFactory:async()=>{launches++;throw Error('should not launch')}})).rejects.toThrow(/contract/);expect(launches).toBe(0)});
 it('invalidates visibly changed page before dispatch',async()=>{const replay=exportScreenshotReplay(await source(),task);const run=await runScreenshotReplay(task,replay,{outDir:await dir(),browserSessionFactory:async(url,opts)=>{const s=await createTestBrowserSession(url,opts);await s.page.addStyleTag({content:'body{background:#000!important}'});return s}});expect(run.outcome?.status).not.toBe('success');expect(run.events.filter(e=>e.type==='action.result')).toHaveLength(0);expect(JSON.stringify(run.events)).toContain('replay-invalidated')});
 it('never claims success merely because a path is exhausted',async()=>{const trace=await source(),replay=exportScreenshotReplay(trace,task);replay.steps=replay.steps.slice(0,1);const run=await runScreenshotReplay(task,replay,{outDir:await dir(),browserSessionFactory:createTestBrowserSession});expect(run.outcome?.status).toBe('inconclusive');expect(run.outcome?.reason).toBe('policy-uncertain')});
 it('validates keys and clones the supplied manifest',async()=>{const replay=exportScreenshotReplay(await source(),task);const invalid=structuredClone(replay);invalid.steps[0]!.key='MouseClick';expect(()=>validateScreenshotReplay(invalid)).toThrow(/step/);const p=new ScreenshotReplayPolicy(replay);replay.steps[0]!.key='Enter';const saved=await dir();const first=(await hydrateScreenshots(await source(saved),saved)).events.find(e=>e.type==='keyboard.observation')!.data as Parameters<ScreenshotReplayPolicy['decide']>[0]['observation'];expect(p.decide({goal:task.goal,observation:first,history:[],inputs:{},allowedActions:{keys:['Tab'],intents:[],inputKeys:[],replaceText:false},signal:new AbortController().signal})).toEqual({action:{kind:'key',key:'Tab'}})});
});

describe('replay provenance and remote guard regressions',()=>{
 it('rejects mismatched dispatches, spoofed sources, witness payloads and model identities',async()=>{
  const original=await source();const mutations:((t:RunTrace)=>void)[]=[
   t=>{(t.events.find(e=>e.type==='action.result')!.data as any).action.key='Delete'},
   t=>{t.events.find(e=>e.type==='action.result')!.source='simulation'},
   t=>{delete (t.events.find(e=>e.type==='verifier.evidence')!.data as any).witness},
   t=>{(t.events.find(e=>e.type==='verifier.evidence')!.data as any).witness.text='unrelated'},
   t=>{(t.events.find(e=>e.type==='verifier.evidence')!.data as any).witness={kind:'activation-speech',provenance:'simulation',speech:['Task completed successfully']}},
   t=>{for(const e of t.events)if(e.type==='policy.evidence')delete (e.data as any).evidence.model},
   t=>{(t.events.find(e=>e.type==='verifier.result'&&(e.data as any).passed)!.data as any).rules[0].ruleType='titleIncludes'},
   t=>{const result=t.events.find(e=>e.type==='action.result')!;result.seq=t.events.find(e=>e.type==='policy.decision')!.seq-1},
  ];for(const mutate of mutations){const t=structuredClone(original);mutate(t);expect(()=>exportScreenshotReplay(t,task)).toThrow()}
 });
 it('requires explicit remote read-only navigation before launch or export',async()=>{const original=await source();const remote={...task,url:'https://example.test/',navigation:{strategy:'same-origin' as const}};original.task={...original.task,url:remote.url};expect(()=>exportScreenshotReplay(original,remote)).toThrow(/readOnly/);const replay=exportScreenshotReplay(await source(),task);await expect(runScreenshotReplay(remote,replay,{outDir:await dir()})).rejects.toThrow(/readOnly/)});
 it('blocks a hidden changed POST handler despite identical pre-action pixels',async()=>{
  const {createServer}=await import('node:http');let hiddenMutation=false;const methods:string[]=[];
  const server=createServer((req,res)=>{methods.push(req.method??'');res.setHeader('content-type','text/html');res.end(`<!doctype html><title>Replay fixture</title><button onclick="document.querySelector('p').textContent='Done';${hiddenMutation?"fetch('/mutate',{method:'POST'}).catch(()=>{})":''}">Finish</button><p></p>`)});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanup.push(()=>new Promise<void>(r=>server.close(()=>r())));
  const remote:Task={mode:'keyboard',url:`http://127.0.0.1:${(server.address() as {port:number}).port}/`,goal:'Activate Finish',maxSteps:4,navigation:{strategy:'same-origin',readOnly:true},verify:{all:[{textVisibleExact:'Done'}]}};let n=0;
  const trace=await runScreenshotTask(remote,{outDir:await dir(),browserSessionFactory:createTestBrowserSession,policy:new ScreenshotDecisionPolicy({model:{choose:async()=>({choiceId:['key:Tab','key:Enter'][n++]!,model:{id:'test-double',runtime:'unit'}})}})});
  const replay=exportScreenshotReplay(trace,remote);hiddenMutation=true;const run=await runScreenshotReplay(remote,replay,{outDir:await dir(),browserSessionFactory:createTestBrowserSession});
  expect(methods).not.toContain('POST');expect(run.events.some(e=>JSON.stringify(e.data).includes('Read-only'))).toBe(true);
 });
});

it('rejects verifier and profile overrides rather than weakening the saved contract',async()=>{const replay=exportScreenshotReplay(await source(),task);for(const override of [{verifier:async()=>({passed:true,failures:[]})},{profile:'dark'}])await expect(runScreenshotReplay(task,replay,{outDir:await dir(),...override} as any)).rejects.toThrow(/overrides/)});

it('normalizes a relative task URL consistently with the screenshot runner',async()=>{const trace=await source();expect(exportScreenshotReplay(trace,{...task,url:'fixtures/screenshot-keyboard.html'}).steps).toHaveLength(3)});
it.each([{rule:{textVisibleExact:'Done now'},content:'Done\n   now'},{rule:{textVisible:'done now'},content:'DONE NOW'}])('accepts genuine verifier-normalized visible text $rule',async({rule,content})=>{const d=await dir(),file=join(d,'normalized.html');await writeFile(file,`<!doctype html><button onclick="document.querySelector('p').textContent=${JSON.stringify(content).replaceAll('"','&quot;')}">Finish</button><p></p>`);const t:Task={mode:'keyboard',url:pathToFileURL(file).href,goal:'Finish',verify:{all:[rule]},maxSteps:4};let n=0;const trace=await runScreenshotTask(t,{outDir:join(d,'run'),browserSessionFactory:createTestBrowserSession,policy:new ScreenshotDecisionPolicy({model:{choose:async()=>({choiceId:['key:Tab','key:Enter'][n++]!,model:{id:'fixture-model',runtime:'test'}})}})});expect(trace.outcome?.status).toBe('success');expect(exportScreenshotReplay(trace,t).steps).toHaveLength(2)});

it('matches verifier request method casing without accepting unrelated methods',async()=>{const original=await source();const trace=structuredClone(original),t={...task,verify:{all:[{requestSeen:{urlIncludes:'/read',method:'get'}}]}};Object.assign(trace.task,t);for(const e of trace.events){const d=e.data as any;if(e.type==='verifier.result'&&d.passed)d.rules[0].ruleType='requestSeen';if(e.type==='verifier.evidence'){d.ruleType='requestSeen';d.witness={kind:'request',url:'https://example.test/read',method:'GET',timestamp:'2026-01-01T00:00:00Z'}}}expect(exportScreenshotReplay(trace,t).steps).toHaveLength(3);(trace.events.find(e=>e.type==='verifier.evidence')!.data as any).witness.method='POST';expect(()=>exportScreenshotReplay(trace,t)).toThrow(/witnesses/)});

it('accepts empty input records but rejects unknown or nonempty input metadata',async()=>{const trace=await source();trace.task.input={};expect(exportScreenshotReplay(trace,{...task,input:{}}).steps).toHaveLength(3);for(const value of ['unknown',{private:'value'}]){trace.task.input=value;expect(()=>exportScreenshotReplay(trace,task)).toThrow(/inputs/)}});

describe('timeline goal rules and replay export',()=>{
 const live={kind:'observer-event',event:{kind:'live-region',step:3,role:'status',text:'Added to cart'}};
 async function retargeted(rule:Task['verify']['all'][number],witness:unknown){
  const trace=structuredClone(await source()),t:Task={...task,verify:{all:[rule]}},type=Object.keys(rule)[0]!;
  Object.assign(trace.task,t);
  for(const e of trace.events){const d=e.data as any;if(e.type==='verifier.result'&&d.passed)d.rules[0].ruleType=type;if(e.type==='verifier.evidence'){d.ruleType=type;d.witness=witness}}
  return {trace,t};
 }
 it('accepts a final observer-event witness that matches an event rule',async()=>{
  for(const rule of [{event:{kind:'live-region'}},{event:{kind:'live-region',role:'status',text:{regex:'^added',flags:'i'}}},{event:{kind:'live-region',text:'Added to cart'},after:'lastActivation'}] as Task['verify']['all']){
   const {trace,t}=await retargeted(rule,live);expect(exportScreenshotReplay(trace,t).steps).toHaveLength(3);
  }
 });
 it('rejects observer-event witnesses that do not match the event rule',async()=>{
  for(const rule of [{event:{kind:'appeared'}},{event:{kind:'live-region',role:'alert'}},{event:{kind:'live-region',text:{equals:'Added'}}},{event:{kind:'live-region',name:'x'}},{event:{kind:'state',attr:'checked'}}] as Task['verify']['all']){
   const {trace,t}=await retargeted(rule,live);expect(()=>exportScreenshotReplay(trace,t)).toThrow(/witnesses/);
  }
  const {trace,t}=await retargeted({event:{kind:'live-region'}},{kind:'title',title:'Added to cart'});expect(()=>exportScreenshotReplay(trace,t)).toThrow(/witnesses/);
 });
 it('does not accept focused, not or any rules for a replay export, even with an observer-event witness',async()=>{
  const focus={kind:'observer-event',event:{kind:'focus',step:2,role:'button',name:'Add'}};
  for(const rule of [{focused:{role:'button'}},{not:{event:{kind:'focus-lost'}}},{any:[{event:{kind:'focus'}}]}] as Task['verify']['all']){
   const {trace,t}=await retargeted(rule,focus);expect(()=>exportScreenshotReplay(trace,t)).toThrow(/witnesses/);
  }
 });
});
