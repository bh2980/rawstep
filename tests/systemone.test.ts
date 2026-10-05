import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeSystemOneClient, SystemOneHttpClient, VercelEvaluationClient, SystemOneSpeechPolicy, SystemOneScreenshotAdapter, assertSystemOneInputs, speechChoices } from 'rawstep/systemone';
import { ScreenshotDecisionPolicy } from 'rawstep/screenshot';
import { runTask } from '@rawstep/browser/runner';
import { runScreenshotTask } from '@rawstep/browser/screenshot';
import type { Backend, DecisionPolicy } from '@rawstep/core/contracts';
import type { BrowserSession } from '@rawstep/browser/browser';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nV8AAAAASUVORK5CYII=';
const signal = () => new AbortController().signal;
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function directory() { const d = await mkdtemp(join(tmpdir(), 'rawstep-systemone-')); cleanup.push(() => rm(d,{recursive:true,force:true})); return d; }
function input(): Parameters<DecisionPolicy['decide']>[0] { return {
  goal:'Activate start', observation:{kind:'screenreader',provenance:'simulation',speech:['Start, button'],outputEventIds:['out'],window:{id:'w',startedAt:'s',endedAt:'e',reason:'fixture'}},
  history:[],allowedActions:{intents:['activate'],keys:['Tab'],inputKeys:['name'],replaceText:true},inputs:{name:{sensitive:true}},signal:signal(),
}; }
function visualSession(): BrowserSession {
  return {
    page: { bringToFront: vi.fn(async () => {}), screenshot: vi.fn(async () => Buffer.from(png, 'base64')),
      viewportSize: () => ({ width: 1, height: 1 }), keyboard: { press: vi.fn(async () => {}), type: vi.fn(async () => {}) } },
    browser: { version: () => 'fake' }, takeBlockedNavigations: () => [], takeNavigationGuardWarnings: () => [], close: vi.fn(async () => {}),
  } as unknown as BrowserSession;
}
async function http(handler:(request:{path:string;headers:Record<string,unknown>;body:any})=>unknown|Promise<unknown>) {
  const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
    const response=await handler({path:req.url!,headers:req.headers,body});if(res.destroyed)return;res.setHeader('content-type','application/json');res.end(JSON.stringify(response));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  return `http://127.0.0.1:${(server.address() as {port:number}).port}/v1`;
}
const answer=(model:string,id:string,criteria:Record<string,unknown>)=>({model,answers:{next:{type:'choice',choice:id,probabilities:Object.fromEntries(Object.keys(criteria).map(key=>[key,key===id?1:0]))}}});
describe('model-independent SystemOne contracts',()=>{
  it('uses speech only, excluding input values, DOM, verifier and metadata',async()=>{
    const fake=new FakeSystemOneClient(['intent:activate']);const policy=new SystemOneSpeechPolicy(fake);const value=input();Object.assign(value.observation,{dom:'HIDDEN',verifier:'HIDDEN'});
    expect(await policy.decide(value)).toEqual({action:{kind:'intent',intent:'activate'}});expect(JSON.stringify(fake.requests)).not.toMatch(/PRIVATE_INPUT|HIDDEN|outputEventIds/);
    expect(policy.takeDecisionEvidence()).toEqual([expect.objectContaining({kind:'model-inference',observationSource:'simulated-speech-only'})]);
  });
  it('bridges images while preserving existing focus gates and repetition stops',async()=>{
    const fake=new FakeSystemOneClient(['focus:editable-target','type:name']);const policy=new ScreenshotDecisionPolicy({model:new SystemOneScreenshotAdapter(fake),focusGate:{}});
    const value={...input(),observation:{kind:'keyboard' as const,screenshot:{pngBase64:png,viewport:{w:1,h:1}},window:input().observation.window}};
    expect(await policy.decide(value)).toEqual({action:{kind:'typeText',input:'name'}});expect(fake.requests[0]!.images?.[0]?.pngBase64).toBe(png);expect(JSON.stringify(fake.requests)).not.toContain('PRIVATE_INPUT');
    const repeated=new ScreenshotDecisionPolicy({model:new SystemOneScreenshotAdapter(fake),maxUnchangedTransitions:1});
    expect(await repeated.decide({...value,history:[{step:1,decision:{action:{kind:'key',key:'Tab'}},observation:value.observation}]})).toMatchObject({stop:'stuck',stopSource:'exploration-guard'});expect(fake.requests).toHaveLength(2);
  });
  it('rejects unknown decisions, cancellation, images and oversized candidate lists',async()=>{
    await expect(new SystemOneSpeechPolicy(new FakeSystemOneClient(['arbitrary'])).decide(input())).rejects.toThrow('Invalid SystemOne');
    const controller=new AbortController();controller.abort();await expect(new SystemOneSpeechPolicy(new FakeSystemOneClient(['key:Tab'])).decide({...input(),signal:controller.signal})).rejects.toThrow();
    const client=new VercelEvaluationClient({baseURL:'https://example.test/v1',model:'configured',apiKey:'test-key'});
    expect(()=>new SystemOneScreenshotAdapter(client)).toThrow('input modalities');expect(()=>assertSystemOneInputs(client,['text'],256)).toThrow('candidate count');
  });
  it('runs fake decision → fake backend → trace → independent verification',async()=>{
    const fake=new FakeSystemOneClient(['intent:activate']);const dir=await directory();
    const backend:Backend={evidenceProvenance:'simulation',capabilities:{intents:['activate'],keys:[],textEntry:false,replaceText:false},start:async()=>({backend:'fake'}),execute:vi.fn(async()=>({})),close:vi.fn(async()=>{}),subscribe:()=>()=>{},observe:async()=>({windowId:'w',startedAt:'2026-10-01T00:00:00Z',endedAt:'2026-10-01T00:00:01Z',reason:'fixture',outputs:[],speech:['Start button']})};
    const session={page:{bringToFront:async()=>{}},browser:{version:()=> 'fake'},takeBlockedNavigations:()=>[],takeNavigationGuardWarnings:()=>[],close:vi.fn(async()=>{})} as unknown as BrowserSession;
    const trace=await runTask({url:'https://example.test',goal:'Start',verify:{all:[{titleIncludes:'Done'}]}},{backend,policy:new SystemOneSpeechPolicy(fake),outDir:dir,browserSessionFactory:async()=>session,verifier:async()=>({passed:true,failures:[]})});
    expect(trace.outcome?.status).toBe('success');expect(backend.execute).toHaveBeenCalledOnce();expect(backend.close).toHaveBeenCalled();expect(session.close).toHaveBeenCalled();expect(trace.events.some(e=>e.type==='policy.evidence')).toBe(true);expect(await readFile(join(dir,'trace.json'),'utf8')).toContain('fake-systemone');
  });
  it('runs a fake image decision through the keyboard runner to a finalized trace without credentials', async () => {
    const cwd = await directory(), session = visualSession(), client = new FakeSystemOneClient(['key:Enter']);
    const saved = await runScreenshotTask({ mode: 'keyboard', url: 'https://example.test', goal: 'Start', verify: { all: [{ titleIncludes: 'Done' }] } }, {
      outDir: join(cwd, 'run'), policy: new ScreenshotDecisionPolicy({ model: new SystemOneScreenshotAdapter(client) }),
      browserSessionFactory: async () => session, verifier: async () => ({ passed: true, failures: [] }),
    });
    expect(session.page.keyboard.press).toHaveBeenCalledWith('Enter'); expect(session.close).toHaveBeenCalledOnce();
    expect(saved.endedAt).toBeTruthy(); expect(saved.outcome?.status).toBe('success');
    expect(saved.events.some(e => e.type === 'keyboard.observation')).toBe(true);
    expect(saved.events.some(e => e.type === 'policy.evidence')).toBe(true);
    expect(client.requests[0]?.images?.[0]?.pngBase64).toBe(png);
    expect(await readFile(join(cwd, 'run', 'trace.json'), 'utf8')).toContain('fake-systemone');
  });
  it('never accepts model success as verifier success, and invalid candidates dispatch nothing', async () => {
    for (const candidate of ['stop:success', 'arbitrary-command']) {
      const session = visualSession();
      const trace = await runScreenshotTask({ url: 'https://example.test', goal: 'Start', verify: { all: [{ titleIncludes: 'Done' }] }, timeoutMs: 1000 }, {
        outDir: await directory(), policy: new ScreenshotDecisionPolicy({ model: new SystemOneScreenshotAdapter(new FakeSystemOneClient([candidate])) }),
        browserSessionFactory: async () => session, verifier: async () => ({ passed: false, failures: ['Not done'] }),
      });
      expect(trace.outcome?.status).not.toBe('success'); expect(session.page.keyboard.press).not.toHaveBeenCalled(); expect(session.close).toHaveBeenCalledOnce();
      if (candidate === 'stop:success') expect(trace.outcome?.policyStopSource).toBe('model');
    }
  });
});
describe('actual HTTP protocols, not real model inference',()=>{
  it('uses Gateway evaluation, not chat completions or fallback options',async()=>{
    const requests:any[]=[];const baseURL=await http(request=>{requests.push(request);return request.path.endsWith('/models')?{data:[{id:'test/native',type:'evaluation',modalities:{input:['text']}}]}:answer('test/native','intent:activate',request.body.questions.next.criteria);});
    await new SystemOneSpeechPolicy(new VercelEvaluationClient({baseURL,model:'test/native',apiKey:'PRIVATE_KEY'})).decide(input());
    expect(requests.map(r=>r.path)).toEqual(['/v1/models','/v1/evaluate']);expect(requests[1].headers.authorization).toBe('Bearer PRIVATE_KEY');expect(requests[1].body).not.toHaveProperty('providerOptions');expect(JSON.stringify(requests[1].body)).not.toContain('PRIVATE_KEY');
  });
  it('rejects generative models before inference and silent model substitution',async()=>{
    const post=vi.fn();const baseURL=await http(request=>{if(request.body)post();return {data:[{id:'not-native',type:'language',modalities:{input:['text']}}]};});
    await expect(new VercelEvaluationClient({baseURL,model:'not-native',apiKey:'test'}).prepare({signal:signal()})).rejects.toThrow('native text evaluation');expect(post).not.toHaveBeenCalled();
    const changed=new SystemOneHttpClient({baseURL:await http(req=>answer('changed','a',req.body.questions.next.criteria)),model:'requested',capabilities:{inputs:['text'],maxChoices:10,maxImages:0}});
    await expect(changed.evaluate({state:{},instructions:'next',choices:[{id:'a',label:'A'}]},{signal:signal()})).rejects.toThrow('different model');
  });
  it('sends ordered inline current/previous media without file paths or URLs',async()=>{
    let sent:any;const baseURL=await http(req=>{sent=req.body;return answer('visual-model','a',sent.questions.next.criteria);});
    const client=new SystemOneHttpClient({baseURL,model:'visual-model',capabilities:{inputs:['text','image'],maxChoices:255,maxImages:2}});
    await client.evaluate({state:{goal:'Next',imageOrder:['current','previous']},images:[{pngBase64:png},{pngBase64:png}],instructions:'Choose',choices:[{id:'a',label:'A'}]},{signal:signal()});
    expect(sent.state.screens).toEqual(['<image:1>','<image:2>']);expect(sent.media).toEqual([{type:'image',data:`data:image/png;base64,${png}`},{type:'image',data:`data:image/png;base64,${png}`}]);expect(JSON.stringify(sent)).not.toMatch(/"url"|"path"/);
  });
  it('fails closed without leaking HTTP bodies, invalid JSON or transport credentials',async()=>{
    for(const fetcher of [async()=>new Response('PRIVATE_BODY',{status:500}),async()=>new Response('PRIVATE_BODY'),async()=>{throw new Error('PRIVATE_KEY');},async()=>Response.json({model:'test',answers:{next:{type:'choice',choice:'a',probabilities:{a:-1}}}})]){
      const client=new SystemOneHttpClient({baseURL:'http://127.0.0.1:1/v1',model:'test',capabilities:{inputs:['text'],maxChoices:10,maxImages:0},fetch:fetcher});
      const error=await client.evaluate({state:{},instructions:'Choose',choices:[{id:'a',label:'A'}]},{signal:signal()}).then(()=>undefined,e=>e);expect(error).toBeInstanceOf(Error);expect(String(error)).not.toMatch(/PRIVATE_BODY|PRIVATE_KEY/);
    }
  });
  it('cancels in-flight HTTP and enforces a timeout without another inference', async () => {
    const request = { state: {}, instructions: 'Choose', choices: [{ id: 'a', label: 'A' }] };
    const seen = vi.fn();
    let began!: () => void; const started = new Promise<void>(resolve => began = resolve);
    const fetcher: typeof fetch = async (_url, options) => {
      seen(); began();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(options!.signal!.reason);
        if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener('abort', abort, { once: true });
      });
    };
    const client = new SystemOneHttpClient({ baseURL: 'http://127.0.0.1:1/v1', model: 'test', capabilities: { inputs: ['text'], maxChoices: 10, maxImages: 0 }, fetch: fetcher, timeoutMs: 10 });
    const controller = new AbortController();
    const pending = client.evaluate(request, { signal: controller.signal });
    await started; controller.abort(new Error('PRIVATE_REASON'));
    await expect(pending).rejects.toThrow('cancelled');
    await expect(client.evaluate(request, { signal: signal() })).rejects.toThrow('timed out');
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('early give-up configuration',()=>{
  it('removes the speech model\'s stuck/uncertain choices only when modelGiveUp is false',async()=>{
    const allowed=input().allowedActions,stops=(o?:{modelGiveUp?:boolean})=>speechChoices(allowed,o).map(c=>c.id).filter(id=>id.startsWith('stop:'));
    expect(stops()).toEqual(['stop:success','stop:stuck','stop:uncertain']);expect(stops({modelGiveUp:false})).toEqual(['stop:success']);
    const fake=new FakeSystemOneClient(['stop:success']);const policy=new SystemOneSpeechPolicy(fake,undefined,undefined,{modelGiveUp:false});
    expect(await policy.decide(input())).toEqual({stop:'success',stopSource:'model'});
    expect(fake.requests[0]!.choices.map(c=>c.id).filter(id=>id.startsWith('stop:'))).toEqual(['stop:success']);
  });
});
