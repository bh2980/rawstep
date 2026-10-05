import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Backend, BackendAction, Task, DecisionPolicy, VerificationRecord } from '@rawstep/core/contracts';
import { BrowserAccessBlockedError, type BrowserSession } from '@rawstep/browser/browser';
import { runTask } from '@rawstep/browser/runner';
import type { ObserverEvent, PageObserver } from '@rawstep/browser/observer';
import { ScriptedPolicy } from '@rawstep/policies/policy';
import { TraceRecorder } from '@rawstep/core/trace';
import { analyzeTrace } from '@rawstep/reports/analyze';

const dirs: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function out() { const path = await mkdtemp(join(tmpdir(),'rawstep-runner-v2-')); dirs.push(path); return path; }
const task: Task = { id:'test',url:'https://example.com/task',goal:'Activate start',maxSteps:3,timeoutMs:2000,verify:{all:[{titleIncludes:'Done'}]} };
function fixture() {
  const listeners = new Set<(event: unknown) => void>();
  let sequence = 0;
  const backend: Backend = {
    capabilities:{intents:['next','activate'],keys:['Tab','Enter'],textEntry:true,replaceText:true},
    start:vi.fn(async () => ({screenReader:'mock',screenReaderVersion:'unknown'})),
    execute:vi.fn(async (action:BackendAction) => ({id:'command-1',action})),
    observe:vi.fn(async () => { const output = {sequence:++sequence,receivedAt:new Date().toISOString(),text:'Real captured utterance',raw:{method:'interaction.capturedOutput',params:{data:'Real captured utterance'}}}; for(const listener of listeners) listener({type:'output',output}); return {windowId:`w-${sequence}`,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),reason:'quiet',outputs:[output],speech:[output.text]}; }),
    close:vi.fn(async () => {}),
    subscribe:listener => { listeners.add(listener); return () => listeners.delete(listener); }
  };
  const browser = {page:{bringToFront:vi.fn(async()=>{}),evaluate:vi.fn(async()=>true),screenshot:vi.fn(async()=>{})},browser:{version:()=> 'test-browser'},takeBlockedNavigations:()=>[],takeNavigationGuardWarnings:()=>[],close:vi.fn(async()=>{})} as unknown as BrowserSession;
  const browserSessionFactory = vi.fn(async () => browser);
  const verifier = vi.fn(async (): Promise<VerificationRecord> => ({passed:true,failures:[]}));
  return {backend,browser,browserSessionFactory,verifier};
}
describe('model-neutral runner',()=>{
  it('rejects explicit task/backend modality mismatches before starting resources',async()=>{
    const f=fixture();Object.defineProperty(f.backend,'observationKind',{value:'keyboard'});
    await expect(runTask({...task,mode:'screenreader'},{...f,outDir:await out(),policy:new ScriptedPolicy([])})).rejects.toThrow('does not match');
    expect(f.backend.start).not.toHaveBeenCalled();expect(f.browserSessionFactory).not.toHaveBeenCalled();
    const other=fixture();await expect(runTask({...task,mode:'keyboard'},{...other,outDir:await out(),policy:new ScriptedPolicy([])})).rejects.toThrow('does not match');
  });
  it('fails closed if an output subscriber cannot persist evidence and still closes every resource',async()=>{
    const f=fixture();const subscribe=f.backend.subscribe;
    f.backend.subscribe=listener=>subscribe(event=>{try{listener(event);}catch{ /* Model the transport's observer-error isolation. */ }});
    vi.mocked(f.backend.close).mockRejectedValue(new Error('Close failed'));
    const original=TraceRecorder.prototype.append;
    const failing=vi.spyOn(TraceRecorder.prototype,'append').mockImplementation(function(this:TraceRecorder,...args:Parameters<TraceRecorder['append']>){
      if(['backend.output','run.error','run.cleanup-warning'].includes(args[0]))throw new Error('Disk write failed');
      return original.call(this,...args);
    });
    try {
      const trace=await runTask(task,{...f,outDir:await out(),policy:new ScriptedPolicy([{stop:'success'}])});
      expect(trace.outcome?.reason).toBe('trace-persistence-error');expect(trace.outcome?.status).toBe('failure');
      expect(f.backend.execute).not.toHaveBeenCalled();expect(f.browser.close).toHaveBeenCalled();
    } finally { failing.mockRestore(); }
  });
  it('runs without an LLM and completes only on independent verification',async()=>{
    const f=fixture(); const trace=await runTask(task,{...f,outDir:await out(),policy:new ScriptedPolicy([{action:{kind:'intent',intent:'activate'}}])});
    expect(trace.outcome?.status).toBe('success'); expect(f.verifier).toHaveBeenCalled(); expect(f.backend.close).toHaveBeenCalled(); expect(f.browser.close).toHaveBeenCalled();
    expect(trace.events.filter(e=>e.source==='screen-reader').length).toBeGreaterThan(0);
  });
  it('does not accept a policy success claim as verification',async()=>{
    const f=fixture(); f.verifier.mockResolvedValue({passed:false,failures:['missing']});
    const trace=await runTask(task,{...f,outDir:await out(),policy:new ScriptedPolicy([{stop:'success'}])});
    expect(trace.outcome?.reason).toBe('verification-failed'); expect(f.backend.execute).not.toHaveBeenCalled();
  });
  it('keeps verifier and browser diagnostics out of every policy observation and history',async()=>{
    const f=fixture(); f.verifier.mockResolvedValue({passed:false,failures:['secret selector #ground-truth']});
    const seen: unknown[]=[]; let n=0;
    const policy:DecisionPolicy={decide:input=>{seen.push(input);return ++n===1?{action:{kind:'intent',intent:'next'}}:{stop:'stuck'};}};
    const trace=await runTask(task,{...f,outDir:await out(),policy,diagnosticScreenshots:true});
    expect(JSON.stringify(seen)).not.toMatch(/ground-truth|browserVersion|screenshot|domFocus/);
    expect(JSON.stringify(trace)).toContain('secret selector');
  });
  it('rejects unallowed action before execution and closes resources',async()=>{
    const f=fixture(); const trace=await runTask(task,{...f,outDir:await out(),policy:new ScriptedPolicy([{action:{kind:'key',key:'Control+L'}}])});
    expect(trace.outcome?.status).toBe('failure');expect(f.backend.execute).not.toHaveBeenCalled();expect(f.backend.close).toHaveBeenCalled();
    expect(trace.events.find(e=>e.type==='policy.rejected')?.data).toMatchObject({step:1,action:{kind:'key',key:'Control+L'},reasonCode:'action-not-allowed'});
  });
  it('allows only named task inputs, gates editability, and redacts input values on disk',async()=>{
    const f=fixture();const dir=await out();
    const trace=await runTask({...task,input:{email:'private@example.test'}},{...f,outDir:dir,policy:new ScriptedPolicy([{action:{kind:'typeText',input:'email'}}])});
    expect(f.backend.execute).toHaveBeenCalledWith({kind:'typeText',text:'private@example.test'}, {signal:expect.any(AbortSignal)});
    expect(await readFile(join(dir,'trace.json'),'utf8')).not.toContain('private@example.test');expect(trace.privacy.inputValues).toBe('redacted');
  });
  it('fails text-entry safely for a noneditable target',async()=>{
    const f=fixture();vi.mocked(f.browser.page.evaluate).mockResolvedValue(false);f.verifier.mockResolvedValue({passed:false,failures:['missing']});
    const trace=await runTask({...task,input:{q:'search'}},{...f,outDir:await out(),policy:new ScriptedPolicy([{action:{kind:'typeText',input:'q'}},{stop:'stuck'}])});
    expect(f.backend.execute).not.toHaveBeenCalled();expect(trace.events.some(e=>e.type==='action.result'&&JSON.stringify(e.data).includes('editable'))).toBe(true);
  });
  it('rejects text entry when browser chrome has focus despite a stale active input',async()=>{
    const f=fixture();vi.stubGlobal('document',{hasFocus:()=>false,get activeElement(){throw new Error('Do not inspect stale field when document is unfocused');}});
    vi.mocked(f.browser.page.evaluate).mockImplementation(async(fn:any)=>fn());
    f.verifier.mockResolvedValue({passed:false,failures:['missing']});
    await runTask({...task,input:{q:'secret'}},{...f,outDir:await out(),policy:new ScriptedPolicy([{action:{kind:'typeText',input:'q'}},{stop:'stuck'}])});
    expect(f.backend.execute).not.toHaveBeenCalled();
  });
  it('redacts form-encoded and partial input from browser diagnostics after entry, including final drain',async()=>{
    const f=fixture();const dir=await out();let entered=false;let drains=0;
    vi.mocked(f.backend.execute).mockImplementation(async()=>{entered=true;return {};});
    f.browser.takeBlockedNavigations=()=>entered?[{url:'https://example.test?q=Ada+Lovelace',fromUrl:'https://example.test?q=Ada',reason:'Typed Ada+Lovelace',timestamp:new Date().toISOString()}]:[];
    f.browser.takeNavigationGuardWarnings=()=>entered?[{scope:'navigationGuard',level:'warn',code:'NAVIGATION_GUARD_INSTALL_WARNING',message:++drains>1?'Late Ada+Lovelace':'Partial Ada'}]:[];
    f.verifier.mockResolvedValue({passed:false,failures:['missing']});
    const trace=await runTask({...task,input:{name:'Ada Lovelace'}},{...f,outDir:dir,policy:new ScriptedPolicy([{action:{kind:'typeText',input:'name'}},{stop:'stuck'}])});
    const stored=await readFile(join(dir,'trace.json'),'utf8');
    expect(stored).not.toContain('Ada+Lovelace');expect(stored).not.toContain('Partial Ada');expect(stored).not.toContain('?q=Ada');
    expect(trace.events.filter(e=>e.type.startsWith('browser.navigation-')).every(e=>e.redacted)).toBe(true);
  });
  it('redacts access-barrier error diagnostics after named text entry',async()=>{
    const f=fixture(),directory=await out(),secret='PRIVATE_ACCESS_INPUT',encoded=Buffer.from(secret).toString('base64');
    f.verifier.mockRejectedValue(new BrowserAccessBlockedError(`https://example.test/${encoded}`,403,`Blocked ${encoded}`));
    const trace=await runTask({...task,input:{secret}},{...f,outDir:directory,policy:new ScriptedPolicy([{action:{kind:'typeText',input:'secret'}}])});
    expect(trace.outcome).toMatchObject({status:'inconclusive',reason:'access-blocked'});
    expect(trace.events.find(e=>e.type==='browser.access-blocked')?.redacted).toBe(true);
    for(const path of ['trace.json','trace.jsonl'])expect(await readFile(join(directory,path),'utf8')).not.toContain(encoded);
  });
  it('persists per-rule witnesses by ID outside policy context and masks delayed input fragments',async()=>{
    const f=fixture();const dir=await out();const seen:unknown[]=[];
    f.verifier.mockResolvedValue({passed:false,failures:['Echo A z'],rules:[{ruleIndex:0,ruleType:'responseSeen',passed:false,failure:'Echo A z',witnesses:[{kind:'response',url:'https://example.test?q=A',method:'POST',status:409,ok:false,timestamp:'2026-01-01T00:00:00.000Z'}]}]});
    let n=0;
    const trace=await runTask({...task,input:{q:'Az',id:'event'}},{...f,outDir:dir,policy:{decide:input=>{seen.push(input);return ++n===1?{action:{kind:'typeText',input:'q'}}:{stop:'stuck'};}}});
    const evidence=trace.events.filter(e=>e.type==='verifier.evidence');
    expect(evidence.length).toBe(2);expect(evidence.every(e=>e.redacted)).toBe(true);
    expect(evidence[0]?.data).toMatchObject({step:1,ruleIndex:0,ruleType:'responseSeen',passed:false,witness:{kind:'response',status:409,ok:false,timestamp:'2026-01-01T00:00:00.000Z',details:'[REDACTED]'}});
    const results=trace.events.filter(e=>e.type==='verifier.result');
    expect((results[0]!.data as any).rules[0].evidenceEventIds).toEqual([evidence[0]!.id]);
    expect(JSON.stringify(seen)).not.toContain('responseSeen');expect(JSON.stringify(seen)).not.toContain('409');
    const persisted=await readFile(join(dir,'trace.json'),'utf8');expect(persisted).not.toContain('Echo A z');expect(persisted).not.toContain('?q=A');
  });
  it('redacts a rejected decision after input while retaining the attempted step and reason',async()=>{
    const f=fixture();f.verifier.mockResolvedValue({passed:false,failures:['missing']});
    const trace=await runTask({...task,input:{q:'Az'}},{...f,outDir:await out(),policy:new ScriptedPolicy([{action:{kind:'typeText',input:'q'}},{action:{kind:'key',key:'Echo A z'}}])});
    const rejected=trace.events.find(e=>e.type==='policy.rejected');
    expect(rejected?.redacted).toBe(true);expect(rejected?.data).toMatchObject({step:2,action:{kind:'key',details:'[REDACTED]'},reasonCode:'action-not-allowed'});
    expect(JSON.stringify(trace)).not.toContain('Echo A z');
  });
  it('bounds a hung policy by timeout and aborts its signal',async()=>{
    const f=fixture();let signal:AbortSignal|undefined;
    const trace=await runTask({...task,timeoutMs:30},{...f,outDir:await out(),policy:{decide:input=>{signal=input.signal;return new Promise(()=>{});}}});
    expect(trace.outcome?.reason).toBe('timeout');expect(signal?.aborted).toBe(true);expect(f.backend.close).toHaveBeenCalled();
  });
  it.each(['SIGINT','SIGTERM'])('saves an aborted outcome and interruption point for %s without waiting for budget',async(signal)=>{
    const f=fixture();const controller=new AbortController();let ready!:()=>void;
    const started=new Promise<void>(resolve=>{ready=resolve;});
    const running=runTask({...task,timeoutMs:5000},{...f,outDir:await out(),signal:controller.signal,policy:{decide:()=>{ready();return new Promise(()=>{});}}});
    await started;controller.abort(signal);
    const trace=await running;
    expect(trace.outcome).toMatchObject({status:'aborted',reason:'aborted',stage:'policy',step:1,cancellation:{signal,stage:'policy',step:1}});
    expect(trace.events.find(e=>e.type==='run.aborted')?.data).toEqual({signal,stage:'policy',step:1});
    expect(f.backend.execute).not.toHaveBeenCalled();expect(f.backend.close).toHaveBeenCalled();expect(f.browser.close).toHaveBeenCalled();
  });
  it('does not start a backend for a pre-aborted run and preserves metadata with short inputs',async()=>{
    const f=fixture();const controller=new AbortController();controller.abort('SIGINT');
    const trace=await runTask({...task,input:{q:'a'}},{...f,outDir:await out(),signal:controller.signal,policy:new ScriptedPolicy([])});
    expect(trace.outcome).toMatchObject({status:'aborted',reason:'aborted',stage:'backend-start',step:0,cancellation:{signal:'SIGINT'}});
    expect(f.backend.start).not.toHaveBeenCalled();
  });
  it('ends at the action budget',async()=>{
    const f=fixture();f.verifier.mockResolvedValue({passed:false,failures:['missing']});
    const trace=await runTask({...task,maxSteps:1},{...f,outDir:await out(),policy:new ScriptedPolicy([{action:{kind:'intent',intent:'next'}}])});
    expect(trace.outcome?.reason).toBe('maxSteps');expect(f.backend.execute).toHaveBeenCalledTimes(1);
  });
  it('retains the outcome when an optional later analyzer fails',async()=>{
    const f=fixture();const trace=await runTask(task,{...f,outDir:await out(),policy:new ScriptedPolicy([{stop:'success'}])});
    const before=JSON.stringify(trace.outcome);const report=await analyzeTrace(trace,{id:'broken',analyze:()=>{throw new Error('provider down');}});
    expect(report.status).toBe('failed');expect(JSON.stringify(trace.outcome)).toBe(before);
  });
  describe('page observer evidence',()=>{
    const at='2026-01-01T00:00:00.000Z';
    function withObserver(f:ReturnType<typeof fixture>,queue:ObserverEvent[],dropped:Record<number,number>={}){
      const observer:PageObserver={available:true,setStep:vi.fn(),take:()=>queue.splice(0),dropped:()=>dropped,close:vi.fn(async()=>{})};
      (f.browser as unknown as {observer:PageObserver}).observer=observer;return observer;
    }
    it('redacts observer events emitted after text entry, keeps earlier ones and records dropped counts',async()=>{
      const f=fixture(),dir=await out(),queue:ObserverEvent[]=[{kind:'focus',step:1,at,frame:'main',role:'textbox',name:'Search field'}];
      const observer=withObserver(f,queue,{3:5});
      vi.mocked(f.backend.execute).mockImplementation(async()=>{queue.push(
        {kind:'state',step:1,at,frame:'main',role:'textbox',name:'Secret Value',text:'typed Secret Value',attr:'aria-invalid',value:'true',url:'https://example.test/?q=Secret+Value'},
        {kind:'appeared',step:1,at,frame:'main',role:'status',name:'Unrelated label',text:'Unrelated text'});return {};});
      f.verifier.mockResolvedValue({passed:false,failures:['missing']});
      const trace=await runTask({...task,input:{field:'Secret Value'}},{...f,outDir:dir,policy:new ScriptedPolicy([{action:{kind:'typeText',input:'field'}},{stop:'stuck'}])});
      const events=trace.events.filter(e=>e.type.startsWith('observer.')&&e.type!=='observer.metadata'&&e.type!=='observer.dropped');
      const focus=events.find(e=>e.type==='observer.focus')!;
      expect(focus.data).toMatchObject({kind:'focus',step:1,role:'textbox',name:'Search field'});expect(focus.redacted).toBe(false);
      const state=events.find(e=>e.type==='observer.state')!;
      expect(state.data).toMatchObject({kind:'state',step:1,role:'textbox',name:'[REDACTED]',text:'[REDACTED]',value:'[REDACTED]',url:'[REDACTED]',attr:'aria-invalid'});expect(state.redacted).toBe(true);
      // Taint redacts every later observer event, even ones that do not echo the typed value.
      const appeared=events.find(e=>e.type==='observer.appeared')!;
      expect(appeared.data).toMatchObject({kind:'appeared',step:1,role:'status',name:'[REDACTED]',text:'[REDACTED]'});expect(appeared.redacted).toBe(true);
      expect(events.indexOf(focus)).toBeLessThan(events.indexOf(state));
      expect(trace.events.find(e=>e.type==='observer.dropped')?.data).toMatchObject({perStep:{3:5}});
      expect(observer.close).not.toHaveBeenCalled();
      for(const path of ['trace.json','trace.jsonl']){const stored=await readFile(join(dir,path),'utf8');expect(stored).not.toContain('Secret Value');expect(stored).not.toContain('Unrelated label');expect(stored).toContain('Search field');}
    });
    it('keeps observer events readable when no text was entered',async()=>{
      const f=fixture(),queue:ObserverEvent[]=[{kind:'focus',step:1,at,frame:'main',role:'button',name:'Start'}];withObserver(f,queue);
      f.verifier.mockResolvedValue({passed:false,failures:['missing']});
      const trace=await runTask(task,{...f,outDir:await out(),policy:new ScriptedPolicy([{stop:'stuck'}])});
      const focus=trace.events.find(e=>e.type==='observer.focus')!;
      expect(focus.data).toMatchObject({name:'Start'});expect(focus.redacted).toBe(false);
      expect(trace.events.some(e=>e.type==='observer.dropped')).toBe(false);
    });
  });
  describe('goal baseline',()=>{
    const at='2026-01-01T00:00:00.000Z';
    const rules:Task['verify']['all']=[{titleIncludes:'Done'},{not:{event:{kind:'focus-lost'}}},{event:{kind:'live-region',text:'Added'}}];
    /** The built-in verifier needs page.title(); the shared fixture supplies a verifier mock instead. */
    function builtIn(title:()=>Promise<string>,queue:ObserverEvent[]=[]){
      const {verifier,...f}=fixture();void verifier;
      (f.browser.page as unknown as {title:()=>Promise<string>}).title=title;
      (f.browser as unknown as {observer:PageObserver}).observer={available:true,setStep:vi.fn(),take:()=>queue.splice(0),dropped:()=>({}),close:vi.fn(async()=>{})};
      return {f,queue};
    }
    const types=(trace:{events:{type:string}[]})=>trace.events.map(e=>e.type);
    it('records which rules held once, before the first policy decision, using the built-in verifier',async()=>{
      const {f}=builtIn(async()=>'Done page',[{kind:'live-region',step:0,at,frame:'main',role:'status',text:'Added to cart'}]);
      const trace=await runTask({...task,verify:{all:rules}},{...f,outDir:await out(),policy:new ScriptedPolicy([{stop:'stuck'}])});
      const baselines=trace.events.filter(e=>e.type==='verifier.baseline');
      expect(baselines).toHaveLength(1);
      // Initial-load events never satisfy an event rule, so the baseline shows the goal is not yet met.
      expect(baselines[0]!.data).toEqual({passed:false,rules:[{ruleIndex:0,ruleType:'titleIncludes',passed:true},{ruleIndex:1,ruleType:'not',passed:true},{ruleIndex:2,ruleType:'event',passed:false}]});
      expect(baselines[0]).toMatchObject({source:'verifier',redacted:false});
      const order=types(trace);
      expect(order.indexOf('verifier.baseline')).toBeGreaterThan(-1);
      expect(order.indexOf('verifier.baseline')).toBeLessThan(order.indexOf('policy.decision'));
      expect(order.indexOf('verifier.baseline')).toBeLessThan(order.indexOf('verifier.result'));
      expect(trace.events.some(e=>e.type==='verifier.evidence'&&(e.data as {step:number}).step===0)).toBe(false);
      const stored=JSON.stringify(baselines[0]!.data);expect(stored).not.toContain('Done page');expect(stored).not.toContain('Added to cart');expect(stored).not.toContain('witness');
    });
    it('does not let the baseline decide the outcome even when every rule already holds',async()=>{
      const {f}=builtIn(async()=>'Done page');
      const trace=await runTask({...task,verify:{all:[{titleIncludes:'Done'},{not:{event:{kind:'focus-lost'}}}]}},{...f,outDir:await out(),policy:new ScriptedPolicy([{action:{kind:'intent',intent:'activate'}}])});
      expect(trace.events.find(e=>e.type==='verifier.baseline')!.data).toMatchObject({passed:true});
      expect(f.backend.execute).toHaveBeenCalledTimes(1);
      expect(trace.outcome).toMatchObject({status:'success',reason:'verified'});
      expect(trace.events.filter(e=>e.type==='verifier.result').map(e=>(e.data as {step:number}).step)).toEqual([1]);
    });
    it('feeds the in-memory timeline to later verifications and passes an event rule that happened after step 0',async()=>{
      const {f,queue}=builtIn(async()=>'Other',[{kind:'live-region',step:0,at,frame:'main',text:'Added'}]);
      vi.mocked(f.backend.execute).mockImplementation(async()=>{queue.push({kind:'live-region',step:1,at,frame:'main',role:'status',text:'Added to cart'});return {};});
      const trace=await runTask({...task,verify:{all:[{event:{kind:'live-region',role:'status',text:'Added'}}]}},{...f,outDir:await out(),policy:new ScriptedPolicy([{action:{kind:'intent',intent:'activate'}}])});
      expect(trace.events.find(e=>e.type==='verifier.baseline')!.data).toEqual({passed:false,rules:[{ruleIndex:0,ruleType:'event',passed:false}]});
      expect(trace.outcome).toMatchObject({status:'success',reason:'verified'});
      const evidence=trace.events.find(e=>e.type==='verifier.evidence')!;
      expect(evidence.data).toMatchObject({step:1,ruleType:'event',passed:true,witness:{kind:'observer-event',event:{kind:'live-region',step:1,role:'status',text:'Added to cart'}}});
    });
    it('records only the error name when the baseline throws, then continues with the run',async()=>{
      let calls=0;
      const {f}=builtIn(async()=>{if(++calls===1)throw new TypeError('secret https://example.test/?q=Private');return 'Done page';});
      const trace=await runTask(task,{...f,outDir:await out(),policy:new ScriptedPolicy([{stop:'success'}])});
      const baseline=trace.events.find(e=>e.type==='verifier.baseline')!;
      expect(baseline.data).toEqual({error:'TypeError'});expect(JSON.stringify(baseline)).not.toMatch(/secret|Private/);
      expect(types(trace).indexOf('verifier.baseline')).toBeLessThan(types(trace).indexOf('policy.decision'));
      expect(trace.outcome).toMatchObject({status:'success',reason:'verified'});
    });
    it('never runs a custom verifier for the baseline',async()=>{
      const f=fixture();
      const trace=await runTask(task,{...f,outDir:await out(),policy:new ScriptedPolicy([{action:{kind:'intent',intent:'activate'}}])});
      expect(trace.events.some(e=>e.type==='verifier.baseline')).toBe(false);
      expect(f.verifier).toHaveBeenCalledTimes(1);
      expect(f.verifier).toHaveBeenCalledWith(expect.objectContaining({goal:task.goal}),f.browser,expect.anything());
      // This fake session has no observer: no timeline at all, so event rules report "unavailable" instead of "nothing happened".
      expect((f.verifier.mock.calls[0] as unknown[])[2]).not.toHaveProperty('timeline');
    });
    it('shows the unredacted timeline to the verifier but redacts observer witnesses after text entry',async()=>{
      const {f,queue}=builtIn(async()=>'Other');
      vi.mocked(f.backend.execute).mockImplementation(async()=>{queue.push({kind:'appeared',step:1,at,frame:'main',role:'status',name:'Welcome Secret Value',text:'Hi Secret Value'});return {};});
      const dir=await out();
      const trace=await runTask({...task,input:{field:'Secret Value'},verify:{all:[{event:{kind:'appeared',role:'status',name:'Secret Value'}}]}},{...f,outDir:dir,policy:new ScriptedPolicy([{action:{kind:'typeText',input:'field'}}])});
      expect(trace.outcome).toMatchObject({status:'success',reason:'verified'});
      const evidence=trace.events.find(e=>e.type==='verifier.evidence')!;
      expect(evidence.redacted).toBe(true);
      expect(evidence.data).toMatchObject({witness:{kind:'observer-event',details:'[REDACTED]',event:{kind:'appeared',step:1,role:'status'}}});
      expect((evidence.data as {witness:{event:object}}).witness.event).toEqual({kind:'appeared',step:1,role:'status'});
      for(const path of ['trace.json','trace.jsonl'])expect(await readFile(join(dir,path),'utf8')).not.toContain('Secret Value');
    });
  });
});
