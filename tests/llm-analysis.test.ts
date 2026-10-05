import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TraceRecorder } from '@rawstep/core/trace';
import { analyzeSavedTrace, analyzeTrace } from '@rawstep/reports/analyze';
import { LlmTraceAnalyzer, analysisTracePayload } from '@rawstep/reports/analyze/llm';
import { runCli } from '@rawstep/cli/cli';
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'rawstep-llm-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const recorder=new TraceRecorder({id:'llm',input:{name:'PRIVATE_INPUT'}},dir);await recorder.initialize();
  recorder.append('keyboard.observation',{screenshot:{pngBase64:'DO_NOT_SEND_PNG',viewport:{w:1,h:1}}});
  recorder.append('action.result',{ok:false,text:'PRIVATE_INPUT'});
  return {dir,trace:await recorder.finalize({status:'failure',reason:'verification-failed'})};
}
const result=(id:string)=>({summary:'Model interpretation, not a verdict',findings:[{id:'finding',title:'Failed action',description:'Inspect saved evidence',severity:'warning',evidenceEventIds:[id]}]});
describe('explicit finalized-trace LLM analysis',()=>{
  it('adds analysis focus while preserving evidence validation and external cancellation', async () => {
    const {trace}=await fixture(); const controller=new AbortController(); let sent: any;
    const fetcher: typeof fetch = async (_url, init) => { sent=JSON.parse(String(init!.body)); return Response.json({ choices: [{ finish_reason:'stop', message:{content:JSON.stringify(result('invented-event'))} }] }); };
    const analyzer=new LlmTraceAnalyzer({baseURL:'http://127.0.0.1:1/v1',model:'fixture',instructions:'Compare keyboard navigation',fetch:fetcher,signal:controller.signal});
    await expect(analyzer.analyze(trace)).rejects.toThrow('LLM analysis failed');
    expect(sent.messages[0].content).toContain('existing trace event IDs'); expect(sent.messages[1].content).toContain('Compare keyboard navigation');
    const abortFetch: typeof fetch = async (_url, init) => { if(init!.signal!.aborted) throw new Error('aborted'); return new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})); };
    const pending=new LlmTraceAnalyzer({baseURL:'http://127.0.0.1:1/v1',model:'fixture',fetch:abortFetch,signal:controller.signal}).analyze(trace);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'RawstepError', code: 'analysis-cancelled' });
    // Callers can tell cancellation from failure without any provider text in the report.
    const cancelled = new AbortController(); cancelled.abort();
    const report = await analyzeTrace(trace, new LlmTraceAnalyzer({baseURL:'http://127.0.0.1:1/v1',model:'fixture',fetch:abortFetch,signal:cancelled.signal}));
    expect(report).toMatchObject({ status: 'failed', failure: 'cancelled', error: 'Analyzer execution or evidence validation failed.' });
    // The LLM analyzer validates its own output, so an invented event ID surfaces as an analyzer error.
    expect((await analyzeTrace(trace, new LlmTraceAnalyzer({baseURL:'http://127.0.0.1:1/v1',model:'fixture',fetch:fetcher}))).failure).toBe('analyzer-error');
    expect((await analyzeTrace(trace, { id: 'bad', analyze: () => ({ summary: 'x', findings: [{ id: 'f', title: 't', description: 'd', severity: 'info', evidenceEventIds: ['missing'] }] }) })).failure).toBe('invalid-result');
  });
  it('calls actual local HTTP only on analyze --llm and preserves execution artifacts',async()=>{
    const {dir,trace}=await fixture();const original=await readFile(join(dir,'trace.json'),'utf8');const sent:any[]=[];
    const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));sent.push(JSON.parse(Buffer.concat(chunks).toString()));res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result(trace.events[1]!.id))}}]}));});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
    const options={cwd:dir,stdout:()=>{},stderr:()=>{},env:{RAWSTEP_ANALYSIS_PROVIDER:'openai-compatible',RAWSTEP_ANALYSIS_BASE_URL:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,RAWSTEP_ANALYSIS_MODEL:'fixture'}};
    expect(await runCli(['analyze',dir],options)).toBe(0);expect(sent).toHaveLength(0);
    expect(await runCli(['analyze',dir,'--llm'],options)).toBe(0);expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent)).not.toMatch(/DO_NOT_SEND_PNG|PRIVATE_INPUT/);
    expect(JSON.parse(sent[0].messages[1].content).trace.events.map((e:any)=>e.id)).toEqual(trace.events.map(e=>e.id));
    expect(await readFile(join(dir,'trace.json'),'utf8')).toBe(original);
    const analysis=JSON.parse(await readFile(join(dir,'analysis.json'),'utf8'));expect(analysis.runOutcome).toEqual(trace.outcome);expect(analysis.analyzer.id).toContain('llm');
  });
  it.each(['missing-event','invalid-json','length','http-error','timeout'])('records %s as analysis failure, not run failure',async(kind)=>{
    const {dir,trace}=await fixture();const before=await readFile(join(dir,'trace.json'),'utf8');
    const fetcher:typeof fetch=async(_url,init)=>{
      if(kind==='timeout')return new Promise((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('PRIVATE_TRANSPORT')),{once:true}));
      if(kind==='http-error')return new Response('PRIVATE_BODY',{status:500});
      return Response.json({choices:[{finish_reason:kind==='length'?'length':'stop',message:{content:kind==='invalid-json'?'PRIVATE_BODY':JSON.stringify(result('missing'))}}]});
    };
    const analysis=await analyzeSavedTrace(dir,{analyzer:new LlmTraceAnalyzer({baseURL:'http://127.0.0.1:1/v1',model:'fixture',timeoutMs:10,fetch:fetcher})});
    expect(analysis.status).toBe('failed');expect(analysis.runOutcome).toEqual(trace.outcome);expect(JSON.stringify(analysis)).not.toMatch(/PRIVATE_BODY|PRIVATE_TRANSPORT/);expect(await readFile(join(dir,'trace.json'),'utf8')).toBe(before);
  });
  it('fails before transmission for unfinished, sensitive or oversized traces',async()=>{
    const {trace}=await fixture();const fetcher=vi.fn<typeof fetch>();
    expect(()=>analysisTracePayload({...trace,endedAt:undefined})).toThrow('finalized');
    expect(()=>analysisTracePayload({...trace,privacy:{...trace.privacy,inputValues:'included-by-explicit-opt-in'}})).toThrow('input-redacted');
    await expect(new LlmTraceAnalyzer({baseURL:'http://127.0.0.1:1/v1',model:'test',maxInputBytes:10,fetch:fetcher}).analyze(trace)).rejects.toThrow('no events were silently truncated');expect(fetcher).not.toHaveBeenCalled();
  });
});
