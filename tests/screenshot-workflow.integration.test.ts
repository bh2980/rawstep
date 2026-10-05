import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { runScreenshotTask } from '@rawstep/browser/screenshot';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import { runCli } from '@rawstep/cli/cli';
import { readTrace } from '@rawstep/core/trace';
import { renderReportHtml } from '@rawstep/reports/report';
import { createTestBrowserSession } from './helpers/browser.js';
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function out(){const p=await mkdtemp(join(tmpdir(),'rawstep-keyboard-browser-'));dirs.push(p);return p;}
const cta=pathToFileURL(resolve('fixtures/simple-cta.html')).href;
describe('screenshot workflow in real Chromium',()=>{
 it('executes keyboard actions, verifies the fixture and preserves valid real PNG evidence',async()=>{
  const seen:string[]=[];
  const trace=await runScreenshotTask({url:cta,goal:'Activate Get started',maxSteps:5,timeoutMs:15000,verify:{all:[{titleIncludes:'Completed'},{textVisibleExact:'Started!'},{domEventSeen:{selector:'#start',event:'click'}}]}},{
   outDir:await out(),warn:message=>seen.push(message),browserSessionFactory:createTestBrowserSession,
   policy:new ScriptedPolicy([{action:{kind:'key',key:'Tab'}},{action:{kind:'key',key:'Tab'}},{action:{kind:'key',key:'Enter'}}])
  });
  expect(trace.outcome?.status).toBe('success');expect(seen).toEqual([]);
  const observations=trace.events.filter(e=>e.type==='keyboard.observation');expect(observations.length).toBe(4);
  const png=(observations[0]!.data as {screenshot:{pngBase64:string}}).screenshot.pngBase64;
  expect(Buffer.from(png,'base64').subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(renderReportHtml(trace)).toContain('data:image/png;base64,');expect(trace.events.some(e=>e.type==='screen-reader.observation')).toBe(false);
 },20000);
 it('runs the installed-style screenshot CLI path without AT or provider injection',async()=>{
  const root=await out();await writeFile(join(root,'task.json'),JSON.stringify({mode:'keyboard',url:cta,goal:'Start',maxSteps:4,verify:{all:[{titleIncludes:'Completed'}]}}));
  await writeFile(join(root,'script.json'),JSON.stringify([{action:{kind:'key',key:'Tab'}},{action:{kind:'key',key:'Tab'}},{action:{kind:'key',key:'Enter'}}]));
  const stderr:string[]=[];
  const args=['screenshot-run',join(root,'task.json'),'--script',join(root,'script.json'),'--out',join(root,'run')];
  if(process.env.RAWSTEP_TEST_BROWSER_PATH)args.push('--browser-executable',process.env.RAWSTEP_TEST_BROWSER_PATH);
  expect(await runCli(args,{stdout:()=>{},stderr:value=>stderr.push(value)})).toBe(0);
  expect(stderr.join('')).not.toContain('deprecated');expect((await readTrace(join(root,'run'))).outcome?.status).toBe('success');
 },20000);
 it('types only named task input into a real focused field and suppresses later saved screenshots',async()=>{
  const dir=await out();const html=join(dir,'form.html');
  await writeFile(html,'<!doctype html><title>Form</title><input autofocus id="name"><button onclick="document.title=\'Completed\'">Save</button>');
  const trace=await runScreenshotTask({url:pathToFileURL(html).href,goal:'Enter the name then save',input:{name:'Ada Lovelace'},maxSteps:4,timeoutMs:15000,verify:{all:[{titleIncludes:'Completed'}]}},{
    outDir:join(dir,'run'),warn:()=>{},browserSessionFactory:createTestBrowserSession,
    policy:new ScriptedPolicy([{action:{kind:'typeText',input:'name'}},{action:{kind:'key',key:'Tab'}},{action:{kind:'key',key:'Enter'}}])
  });
  expect(trace.outcome?.status).toBe('success');
  const images=trace.events.filter(e=>e.type==='keyboard.observation');expect(images[0]!.redacted).toBe(false);expect(images.slice(1).every(e=>e.redacted)).toBe(true);
  expect(await readFile(join(dir,'run','trace.json'),'utf8')).not.toContain('Ada Lovelace');
 },20000);
});
