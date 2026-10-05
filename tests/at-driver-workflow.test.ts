import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mockAtDriverServer } from './helpers/mock-at-driver-server.js';
import { AtDriverBackend } from '@rawstep/screenreaders/at-driver';
import { runTask } from '@rawstep/browser/runner';
import { runCli } from '@rawstep/cli/cli';
import { resolveTask } from '@rawstep/core/contracts';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import { TraceRecorder, readTrace } from '@rawstep/core/trace';
import type { BrowserSession } from '@rawstep/browser/browser';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
function browser(){return {page:{bringToFront:async()=>{},evaluate:async()=>true},browser:{version:()=> 'test-browser'},takeBlockedNavigations:()=>[],takeNavigationGuardWarnings:()=>[],close:async()=>{}} as unknown as BrowserSession;}
describe('real WebSocket adapter to runner to saved artifacts',()=>{
  it('runs an actual socket session and reruns analyze/report from the CLI without any model',async()=>{
    const server=await mockAtDriverServer({onCommand:(_command,output)=>{output('Started!');}});cleanup.push(()=>server.close());
    const root=await mkdtemp(join(tmpdir(),'rawstep-integration-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
    const out=join(root,'out');
    const stdout:string[]=[];const stderr:string[]=[];
    const trace0=await runTask(resolveTask({url:'https://example.test',goal:'Start',verify:{all:[{titleIncludes:'Done'}]}},root),{
      backend:new AtDriverBackend({profile:'voiceover',url:server.url,quietMs:10,maxWaitMs:40}),policy:new ScriptedPolicy([{action:{kind:'intent',intent:'activate'}}]),outDir:out,
      browserSessionFactory:async()=>browser(),verifier:async()=>({passed:true,failures:[]})
    });const code=trace0.outcome?.status==='success'?0:1;
    expect(stderr).toEqual([]);expect(code).toBe(0);expect(server.commands.map(c=>c.method)).toEqual(['session.new','interaction.userIntent']);
    const trace=await readTrace(out);expect(trace.outcome?.status).toBe('success');
    expect(trace.events.filter(e=>e.type==='backend.command').every(e=>typeof e.commandId==='string')).toBe(true);
    expect(JSON.stringify(trace)).toContain('Started!');
    expect(await runCli(['analyze',out],{stdout:()=>{},stderr:s=>stderr.push(s)})).toBe(0);
    expect(await runCli(['report',out,'--analysis',join(out,'analysis.json')],{stdout:()=>{},stderr:s=>stderr.push(s)})).toBe(0);
    const before=await readFile(join(out,'trace.json'),'utf8');
    expect(await runCli(['analyze',out],{stdout:()=>{},stderr:s=>stderr.push(s)})).toBe(0);
    expect(await readFile(join(out,'trace.json'),'utf8')).toBe(before);
    expect(await readFile(join(out,'report.html'),'utf8').catch(()=>readFile(join(out,'report','index.html'),'utf8'))).toContain('RawStep');
  });
  it.each([2,3])('stops a text batch before dispatch when command %i cannot be persisted',async(failedId)=>{
    const server=await mockAtDriverServer();cleanup.push(()=>server.close());
    const root=await mkdtemp(join(tmpdir(),'rawstep-write-failure-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
    const original=TraceRecorder.prototype.append;
    const append=vi.spyOn(TraceRecorder.prototype,'append').mockImplementation(function(this:TraceRecorder,...args:Parameters<TraceRecorder['append']>){
      if(args[0]==='backend.command'&&args[2]?.commandId===String(failedId))throw new Error('Injected journal write failure');
      return original.call(this,...args);
    });
    try {
      const trace=await runTask({url:'https://example.test',goal:'Enter named value',input:{q:'ABCDE'},verify:{all:[{titleIncludes:'Done'}]}},{
        backend:new AtDriverBackend({url:server.url,profile:'voiceover',quietMs:5,maxWaitMs:30}),outDir:root,
        browserSessionFactory:async()=>browser(),verifier:async()=>({passed:false,failures:['missing']}),
        policy:{decide:()=>({action:{kind:'typeText',input:'q'}})}
      });
      expect(trace.outcome).toMatchObject({status:'failure',reason:'trace-persistence-error',stage:'action',step:1});
      expect(server.commands.filter(c=>c.method==='interaction.userIntent')).toHaveLength(failedId-2);
      expect(trace.events.filter(e=>e.type==='backend.command').map(e=>e.commandId)).toEqual(failedId===2?['1']:['1','2']);
    } finally { append.mockRestore(); }
  });
  it('does not persist reconstructable input key frames, fragmented/late echoes, rationale or screenshots',async()=>{
    const server=await mockAtDriverServer({onCommand:(command,output)=>{const keys=command.params.keys as string[];output(keys.at(-1)!);}});cleanup.push(()=>server.close());
    const root=await mkdtemp(join(tmpdir(),'rawstep-private-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
    const page=browser();page.page.screenshot=vi.fn();let step=0;
    const trace=await runTask({url:'https://example.test',goal:'Enter provided input',input:{secret:'Az91',year:'2026'},verify:{all:[{titleIncludes:'Done'}]}},{
      backend:new AtDriverBackend({url:server.url,profile:'voiceover',quietMs:10,maxWaitMs:40}),
      outDir:root,browserSessionFactory:async()=>page,verifier:async()=>({passed:false,failures:['Not complete']}),diagnosticScreenshots:true,
      policy:{decide:()=>++step===1?{action:{kind:'typeText',input:'secret'}}:step===2?{action:{kind:'intent',intent:'next'},rationale:'echo A z 9 1'}:{stop:'stuck',rationale:'echo A z 9 1'}}
    });
    const wireInput=server.commands.filter(c=>c.method==='interaction.userIntent').map(c=>c.params.keys.at(-1)).slice(0,4);
    expect(wireInput).toEqual(['a','z','9','1']);
    const stored=await readFile(join(root,'trace.json'),'utf8');
    expect(stored).not.toContain('Az91');expect(stored).not.toContain('echo A z 9 1');
    const inputCommands=trace.events.filter(e=>e.type==='backend.command'&&e.commandId!=='1');
    expect(inputCommands.length).toBe(5);expect(inputCommands.every(e=>e.redacted)).toBe(true);
    expect(inputCommands.every(e=>!(e.data as any).raw && !(e.data as any).rawText)).toBe(true);
    expect(trace.events.filter(e=>e.type==='screen-reader.observation').slice(1).every(e=>e.redacted)).toBe(true);
    expect(page.page.screenshot).not.toHaveBeenCalled();
    expect(trace.events.filter(e=>e.collectionWindow).every(e=>!Number.isNaN(Date.parse(e.collectionWindow!.startedAt)))).toBe(true);
  });
});
