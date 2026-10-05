import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { runScreenshotTask, ScreenshotKeyboardBackend } from '@rawstep/browser/screenshot';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import { readTrace } from '@rawstep/core/trace';
import type { Decision, Task } from '@rawstep/core/contracts';
import { createTestBrowserSession } from './helpers/browser.js';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
async function directory(){const path=await mkdtemp(join(tmpdir(),'rawstep-real-fixture-'));cleanup.push(()=>rm(path,{recursive:true,force:true}));return path;}
const key=(value:string):Decision=>({action:{kind:'key',key:value}});
const type=(input:string):Decision=>({action:{kind:'typeText',input}});
async function runFixture(name:string,decisions:Decision[]){
  const task=JSON.parse(await readFile(resolve('examples/tasks',`${name}.json`),'utf8')) as Task;task.url=pathToFileURL(resolve('examples/tasks',task.url)).href;
  task.mode = 'keyboard'; // Explicit conversion; the new backend does not silently reinterpret native tasks.
  const outDir=await directory();const warn=vi.fn();
  const trace=await runScreenshotTask(task,{outDir,warn,policy:new ScriptedPolicy(decisions),browserSessionFactory:createTestBrowserSession});
  expect(warn).not.toHaveBeenCalled();
  return {trace,outDir};
}

describe('retained screenshot keyboard fixture execution in real Chromium',()=>{
  it('completes the original simple CTA fixture using real Tab/Enter input and independent verification',async()=>{
    const {trace,outDir}=await runFixture('simple-cta',[key('Tab'),key('Tab'),key('Enter')]);
    expect(trace.outcome?.status).toBe('success');expect(trace.events.filter(event=>event.type==='action.result')).toHaveLength(3);
    expect((await readTrace(outDir)).outcome).toEqual(trace.outcome);
    expect(trace.events.some(event=>event.type==='keyboard.observation')).toBe(true);
  });
  it('records an unsuccessful bad-focus attempt without a policy success override',async()=>{
    const {trace}=await runFixture('bad-focus',[key('Tab'),key('Tab'),{stop:'stuck',rationale:'Noise links do not meet the goal'}]);expect(trace.outcome?.status).toBe('failure');
  });
  it('can complete the original bad-focus fixture through its real keyboard target',async()=>{
    const {trace}=await runFixture('bad-focus',[key('Tab'),key('Tab'),key('Tab'),key('Tab'),key('Enter')]);expect(trace.outcome?.status).toBe('success');
  });
  it('completes email login through named input and removes the value from stored trace',async()=>{
    const {trace,outDir}=await runFixture('email-login',[key('Tab'),key('Tab'),key('Tab'),type('email'),key('Tab'),key('Tab'),key('Enter')]);expect(trace.outcome?.status).toBe('success');expect(await readFile(join(outDir,'trace.json'),'utf8')).not.toContain('traveler@example.com');
  });
  it('completes credential login with both named inputs and no direct-value policy actions',async()=>{
    const {trace,outDir}=await runFixture('login',[key('Tab'),type('email'),key('Tab'),type('password'),key('Tab'),key('Enter')]);expect(trace.outcome?.status).toBe('success');const json=await readFile(join(outDir,'trace.json'),'utf8');expect(json).not.toContain('traveler@example.com');expect(json).not.toContain('super-secret');
  });
  it('completes search by keyboard and selects the required second result',async()=>{
    const {trace}=await runFixture('search',[key('Tab'),type('query'),key('Tab'),key('Enter'),key('Tab'),key('Tab'),key('Enter')]);expect(trace.outcome?.status).toBe('success');
  });
  it('captures current and previous real screenshots without mutating natural startup focus',async()=>{
    const session=await createTestBrowserSession(pathToFileURL(resolve('fixtures/simple-cta.html')).href);cleanup.push(()=>session.close());const backend=new ScreenshotKeyboardBackend();await backend.start();backend.attachSession({ page: session.page });cleanup.push(()=>backend.close());
    expect(await session.page.evaluate(()=>document.activeElement===document.body)).toBe(true);expect(await session.page.locator('html').getAttribute('tabindex')).toBeNull();
    const before=await backend.observe();await backend.execute({kind:'key',key:'Tab'});const after=await backend.observe();
    expect(Buffer.from(before.screenshot.pngBase64,'base64').subarray(1,4).toString()).toBe('PNG');expect(after.previousScreenshot).toEqual(before.screenshot);expect(after.screenshot.pngBase64).not.toBe(before.screenshot.pngBase64);
  });
  it.each([
    ['text input','<input id="field" value="">',true],
    ['textarea','<textarea id="field"></textarea>',true],
    ['contenteditable','<div id="field" contenteditable="true"></div>',true],
    ['readonly input','<input id="field" readonly>',false],
    ['disabled input','<input id="field" disabled>',false],
    ['readonly textarea','<textarea id="field" readonly></textarea>',false],
    ['disabled textarea','<textarea id="field" disabled></textarea>',false],
    ['button','<button id="field">No text</button>',false],
    ['checkbox','<input id="field" type="checkbox">',false],
  ] as const)('enforces the actual focused-editability gate for %s',async(_label,html,allowed)=>{
    const dir=await directory();const file=join(dir,'input.html');await writeFile(file,`<!doctype html><title>Input Gate</title>${html}`);let value='';
    const trace=await runScreenshotTask({url:pathToFileURL(file).href,goal:'Enter task value',maxSteps:1,input:{provided:'fixture input'},verify:{all:[{titleIncludes:'Completed'}]}},{outDir:join(dir,'run'),warn:()=>{},policy:new ScriptedPolicy([type('provided')]),browserSessionFactory:async(url,options)=>{
      const session=await createTestBrowserSession(url,options);await session.page.locator('#field').focus();const close=session.close;session.close=async()=>{value=await session.page.locator('#field').evaluate((node)=>node instanceof HTMLInputElement||node instanceof HTMLTextAreaElement?node.value:node.textContent??'');await close();};return session;
    }});
    expect(trace.events.find(event=>event.type==='browser.input-gate')?.data).toMatchObject({editable:allowed});
    expect(trace.events.find(event=>event.type==='action.result')?.data).toMatchObject({ok:allowed});
    if(allowed)expect(value).toBe('fixture input');else expect(value).not.toContain('fixture input');
  });
  it('replaces pre-existing text using the real platform modifier and Backspace before input',async()=>{
    const dir=await directory();const file=join(dir,'input.html');await writeFile(file,'<!doctype html><input id="field" value="old text">');let value='';
    await runScreenshotTask({url:pathToFileURL(file).href,goal:'Replace',maxSteps:1,input:{provided:'replacement'},verify:{all:[{titleIncludes:'Never'}]}},{outDir:join(dir,'run'),warn:()=>{},policy:new ScriptedPolicy([{action:{kind:'replaceText',input:'provided'}}]),browserSessionFactory:async(url,options)=>{
      const session=await createTestBrowserSession(url,options);await session.page.locator('#field').focus();const close=session.close;session.close=async()=>{value=await session.page.locator('#field').inputValue();await close();};return session;
    }});expect(value).toBe('replacement');
  });
});
