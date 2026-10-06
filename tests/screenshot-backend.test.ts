import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrowserSession } from '@rawstep/browser/browser';
import { ScreenshotKeyboardBackend, SCREENSHOT_KEYS, runScreenshotTask } from '@rawstep/browser/screenshot';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import type { DecisionPolicy, VerificationRecord } from '@rawstep/core/contracts';
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function out(){const p=await mkdtemp(join(tmpdir(),'rawstep-screenshot-backend-'));dirs.push(p);return p;}
function browser(){return {
 page:{bringToFront:vi.fn(async()=>{}),evaluate:vi.fn(async()=>true),screenshot:vi.fn(async()=>Buffer.from('fixture-png')),viewportSize:()=>({width:1280,height:800}),keyboard:{press:vi.fn(async()=>{}),type:vi.fn(async()=>{})}},
 browser:{version:()=> 'test'},takeBlockedNavigations:()=>[],takeNavigationGuardWarnings:()=>[],close:vi.fn(async()=>{})
} as unknown as BrowserSession;}
const task={url:'https://example.test',goal:'Activate start',verify:{all:[{titleIncludes:'Done'}]},maxSteps:4,timeoutMs:1000};
describe('screenshot keyboard backend without any screen reader',()=>{
 it('captures screenshots and previous visual observation without synthetic speech',async()=>{
  const page=browser().page;const backend=new ScreenshotKeyboardBackend();
  await backend.start();backend.attachSession({ page: page });const first=await backend.observe(),second=await backend.observe();
  expect(first.kind).toBe('keyboard');expect(first.screenshot.pngBase64).toBe(Buffer.from('fixture-png').toString('base64'));
  expect(second.previousScreenshot).toEqual(first.screenshot);expect(first).not.toHaveProperty('speech');await backend.close();
 });
 it.each(SCREENSHOT_KEYS)('preserves supported key mapping %s',async(key)=>{
  const session=browser();const backend=new ScreenshotKeyboardBackend();await backend.start();backend.attachSession({ page: session.page });
  await backend.execute({kind:'key',key});expect(session.page.keyboard.press).toHaveBeenCalledWith(key.replace('Mod+','ControlOrMeta+'));await backend.close();
 });
 it('runs through the same verifier, budgets and traces while warning',async()=>{
  const session=browser(),warning=vi.fn();const observed:unknown[]=[];
  const policy:DecisionPolicy={decide:input=>{observed.push(input.observation);return {action:{kind:'key',key:'Enter'}};}};
  const trace=await runScreenshotTask(task,{outDir:await out(),policy,warn:warning,browserSessionFactory:async()=>session,verifier:async()=>({passed:true,failures:[]})});
  expect(warning).not.toHaveBeenCalled();expect(trace.outcome?.status).toBe('success');expect(session.close).toHaveBeenCalled();
  expect((observed[0] as any).kind).toBe('keyboard');expect(trace.events.some(e=>e.type==='keyboard.observation')).toBe(true);expect(trace.events.some(e=>e.source==='screen-reader')).toBe(false);
 });
 it('enforces explicit allowed-key restrictions without dispatch',async()=>{
  const session=browser();
  const trace=await runScreenshotTask(task,{outDir:await out(),allowedActions:{keys:['Enter']},policy:new ScriptedPolicy([{action:{kind:'key',key:'Backspace'}}]),browserSessionFactory:async()=>session});
  expect(trace.outcome?.status).toBe('failure');expect(session.page.keyboard.press).not.toHaveBeenCalled();
 });
 it('preserves named-input restrictions, private image suppression and explicit replace behavior',async()=>{
  const session=browser(),dir=await out();let count=0;
  const trace=await runScreenshotTask({...task,input:{name:'Private Name'}},{outDir:dir,policy:new ScriptedPolicy([{action:{kind:'replaceText',input:'name'}},{stop:'stuck'}]),warn:()=>{},browserSessionFactory:async()=>session,verifier:async():Promise<VerificationRecord>=>({passed:++count>1,failures:[]})});
  expect(session.page.keyboard.press).toHaveBeenCalledWith('ControlOrMeta+A');expect(vi.mocked(session.page.keyboard.type).mock.calls.map(call=>call[0]).join('')).toBe('Private Name');
  const observations=trace.events.filter(e=>e.type==='keyboard.observation');expect(observations[0]!.redacted).toBe(false);expect(observations[1]!.redacted).toBe(true);expect((observations[1]!.data as any).screenshot).toBe('[REDACTED]');
  expect(await readFile(join(dir,'trace.json'),'utf8')).not.toContain('Private Name');
 });
 it('checks cancellation between characters in a screenshot text batch',async()=>{
  const session=browser();const controller=new AbortController();const backend=new ScreenshotKeyboardBackend();
  await backend.start();backend.attachSession({ page: session.page });
  vi.mocked(session.page.keyboard.type).mockImplementation(async()=>{controller.abort(new Error('cancelled'));});
  await expect(backend.execute({kind:'typeText',text:'ABCDE'},{signal:controller.signal})).rejects.toThrow('cancelled');
  expect(session.page.keyboard.type).toHaveBeenCalledTimes(1);expect(session.page.keyboard.type).toHaveBeenCalledWith('A');
  await backend.close();
 });
 it('rejects SR intents and unsupported raw keys',async()=>{
  const backend=new ScreenshotKeyboardBackend();await backend.start();backend.attachSession({ page: browser().page });
  await expect(backend.execute({kind:'intent',intent:'activate'})).rejects.toThrow('unavailable');await expect(backend.execute({kind:'key',key:'Control+L'})).rejects.toThrow('Unsupported');await backend.close();
 });
});
