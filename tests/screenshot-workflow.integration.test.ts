import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { runScreenshotTask } from '@rawstep/browser/screenshot';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import { runCli } from '@rawstep/cli/cli';
import { hydrateScreenshots, readTrace } from '@rawstep/core/trace';
import { renderReportHtml } from '@rawstep/reports/report';
import { createTestBrowserSession } from './helpers/browser.js';
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function out(){const p=await mkdtemp(join(tmpdir(),'rawstep-keyboard-browser-'));dirs.push(p);return p;}
const cta=pathToFileURL(resolve('fixtures/simple-cta.html')).href;
describe('screenshot workflow in real Chromium',()=>{
 it('executes keyboard actions, verifies the fixture and preserves valid real PNG evidence',async()=>{
  const seen:string[]=[],outDir=await out();
  const trace=await runScreenshotTask({url:cta,goal:'Activate Get started',maxSteps:5,timeoutMs:15000,verify:{all:[{titleIncludes:'Completed'},{textVisibleExact:'Started!'},{domEventSeen:{selector:'#start',event:'click'}}]}},{
   outDir,warn:message=>seen.push(message),browserSessionFactory:createTestBrowserSession,
   policy:new ScriptedPolicy([{action:{kind:'key',key:'Tab'}},{action:{kind:'key',key:'Tab'}},{action:{kind:'key',key:'Enter'}}])
  });
  expect(trace.outcome?.status).toBe('success');expect(seen).toEqual([]);
  const observations=trace.events.filter(e=>e.type==='keyboard.observation');expect(observations.length).toBe(4);
  // Schema 2.2: the trace keeps a reference and the real PNG lives in blobs/ next to it.
  const ref=(observations[0]!.data as {screenshot:{sha256:string;blob:string;bytes:number}}).screenshot;
  const png=await readFile(join(outDir,ref.blob));
  expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(png.length).toBe(ref.bytes);expect(createHash('sha256').update(png).digest('hex')).toBe(ref.sha256);
  expect(JSON.stringify(trace)).not.toContain('pngBase64');expect(await readFile(join(outDir,'trace.jsonl'),'utf8')).not.toContain('pngBase64');
  expect(renderReportHtml(trace)).toContain(`src="${ref.blob}"`);expect(renderReportHtml(await hydrateScreenshots(trace,outDir))).toContain('data:image/png;base64,');expect(trace.events.some(e=>e.type==='screen-reader.observation')).toBe(false);
 },20000);
 it('hydrates the final blob screenshot for the optional stop-reason model',async()=>{
  const outDir=await out(),pixels:string[]=[];
  const trace=await runScreenshotTask({url:cta,goal:'Activate Get started',maxSteps:3,timeoutMs:15000,verify:{all:[{titleIncludes:'Completed'}]}},{
   outDir,browserSessionFactory:createTestBrowserSession,policy:new ScriptedPolicy([{stop:'stuck'}]),
   stopReasonModel:{choose:async request=>{pixels.push(request.screenshot.pngBase64);return{choiceId:'reason:no-visible-focus',model:{id:'test-double',runtime:'unit-only'}}}}
  });
  expect(trace.outcome?.status).not.toBe('success');
  expect(Buffer.from(pixels[0]!,'base64').subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(JSON.parse(await readFile(join(outDir,'stop-reason.json'),'utf8'))).toMatchObject({status:'completed',hypothesis:'no-visible-focus'});
 },20000);
 it('lets the CLI read back the hints and report of a saved keyboard run',async()=>{
  const root=await out(),run=join(root,'run');
  const trace=await runScreenshotTask({url:cta,goal:'Start',maxSteps:4,timeoutMs:15000,verify:{all:[{titleIncludes:'Completed'}]}},{
    outDir:run,browserSessionFactory:createTestBrowserSession,policy:new ScriptedPolicy([{action:{kind:'key',key:'Tab'}},{action:{kind:'key',key:'Tab'}},{action:{kind:'key',key:'Enter'}}])
  });
  expect(trace.outcome?.status).toBe('success');
  const stderr:string[]=[];
  expect(await runCli(['hints',run],{stdout:()=>{},stderr:value=>stderr.push(value)})).toBe(0);
  expect(await runCli(['report',run],{stdout:()=>{},stderr:value=>stderr.push(value)})).toBe(0);
  expect(stderr).toEqual([]);expect((await readTrace(run)).outcome?.status).toBe('success');expect(await readFile(join(run,'report.html'),'utf8')).toContain('data:image/png;base64,');
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
