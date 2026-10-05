import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTask, validateDecision } from '@rawstep/browser/runner';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import type { AllowedActions, Backend, Task } from '@rawstep/core/contracts';
import type { BrowserSession } from '@rawstep/browser/browser';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
const allowed:AllowedActions={intents:['activate'],keys:['Tab'],inputKeys:['email'],replaceText:true};
describe('retained action/input safety responsibilities',()=>{
  it.each([{action:{kind:'key',key:'Tab'}},{action:{kind:'intent',intent:'activate'}},{action:{kind:'typeText',input:'email'}},{action:{kind:'replaceText',input:'email'}},{stop:'success'},{stop:'stuck'}])('accepts capability-bounded decision %#',decision=>expect(()=>validateDecision(decision,allowed)).not.toThrow());
  it.each([null,{}, {action:{kind:'key',key:'Control+L'}},{action:{kind:'intent',intent:'unsupported'}},{action:{kind:'typeText',input:'unknown'}},{action:{kind:'replaceText',input:'unknown'}},{action:{kind:'typeText',text:'literal secret'}},{stop:'success',action:{kind:'key',key:'Tab'}},{stop:'other'}])('rejects malformed/unallowed decision %# before execution',decision=>expect(()=>validateDecision(decision,allowed)).toThrow());
  it('rejects replaceText when the backend lacks replace support',()=>expect(()=>validateDecision({action:{kind:'replaceText',input:'email'}},{...allowed,replaceText:false})).toThrow());
  it('rejects any text entry without named input opt-in',()=>expect(()=>validateDecision({action:{kind:'typeText',input:'email'}},{...allowed,inputKeys:[]})).toThrow());

  it.each([
    ['<input id="target" type="text">',true], ['<input id="target" type="email">',true],
    ['<input id="target" type="password">',true], ['<input id="target" type="search">',true],
    ['<textarea id="target"></textarea>',true], ['<input id="target" readonly>',false],
    ['<textarea id="target" readonly></textarea>',false], ['<textarea id="target" disabled></textarea>',false],
    ['<input id="target" disabled>',false], ['<input id="target" type="checkbox">',false],
  ] as const)('executes the production focus gate against DOM field %s',async(html,editable)=>{
    const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only'});const target=dom.window.document.getElementById('target')!;
    target.focus();
    const execute=vi.fn(async()=>({}));const backend:Backend={capabilities:{intents:[],keys:[],textEntry:true,replaceText:true},start:async()=>({}),execute,observe:async()=>({windowId:'w',startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),reason:'quiet',outputs:[],speech:[]}),close:async()=>{},subscribe:()=>()=>{}};
    const page={bringToFront:async()=>{},evaluate:async(fn:()=>unknown)=>dom.window.eval(`(${fn.toString()})()`)};
    const browser={page,browser:{version:()=> 'DOM-harness-not-browser'},takeBlockedNavigations:()=>[],takeNavigationGuardWarnings:()=>[],close:async()=>dom.window.close()} as unknown as BrowserSession;
    const outDir=await mkdtemp(join(tmpdir(),'rawstep-input-migration-'));cleanup.push(()=>rm(outDir,{recursive:true,force:true}));
    const task:Task={url:'https://example.test',goal:'Enter named value',maxSteps:1,input:{email:'test@example.test'},verify:{all:[{titleIncludes:'Done'}]}};
    const trace=await runTask(task,{backend,browserSessionFactory:async()=>browser,outDir,policy:new ScriptedPolicy([{action:{kind:'typeText',input:'email'}}]),verifier:async()=>({passed:false,failures:['Not complete']})});
    expect(execute).toHaveBeenCalledTimes(editable?1:0);
    expect(trace.events.find(event=>event.type==='browser.input-gate')?.data).toMatchObject({editable});
    if(editable)expect(execute).toHaveBeenCalledWith({kind:'typeText',text:'test@example.test'}, {signal:expect.any(AbortSignal)});
  });
});
