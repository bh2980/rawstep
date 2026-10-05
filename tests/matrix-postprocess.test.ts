import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Backend } from '@rawstep/core/contracts';
import { TraceRecorder } from '@rawstep/core/trace';
const execute=vi.hoisted(()=>vi.fn());
vi.mock('@rawstep/browser/runner',()=>({runTask:execute}));
import { runEnvironmentMatrix } from '@rawstep/cli/matrix';
const dirs:string[]=[];afterEach(async()=>{vi.restoreAllMocks();execute.mockReset();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function directory(){const d=await mkdtemp(join(tmpdir(),'rawstep-matrix-'));dirs.push(d);return d;}
function backend():Backend{return {capabilities:{keys:[],intents:[],textEntry:false,replaceText:false},start:async()=>({}),execute:async()=>({}),observe:async()=>({windowId:'w',startedAt:'s',endedAt:'e',reason:'test',speech:[],outputs:[]}),subscribe:()=>()=>{},close:vi.fn(async()=>{})};}
const task={id:'matrix-task',url:'https://example.test',goal:'Test',timeoutMs:1000,verify:{all:[{titleIncludes:'Done'}]}};
describe('matrix postprocessing cannot replace execution evidence',()=>{
  it.each(['analysis','report'])('retains successful run when %s fails',async(stage)=>{
    const root=await directory();const recorder=new TraceRecorder({id:'fixture'},join(root,'trace'));await recorder.initialize();recorder.append('action.result',{ok:true});const trace=await recorder.finalize({status:'success',reason:'verified'});execute.mockResolvedValue(trace);
    const report=await runEnvironmentMatrix(task,{outDir:join(root,'matrix'),mode:'native',profiles:['default'],createBackend:async()=>backend(),createPolicy:()=>({decide:()=>({stop:'success'})}),
      ...(stage==='analysis'?{analyze:async()=>{throw new Error('analysis failure');}}:{analyze:async()=>({schemaVersion:'1.0' as const,traceSchemaVersion:trace.schemaVersion,runId:trace.runId,analyzer:{id:'fake'},analyzedAt:new Date().toISOString(),status:'completed' as const,summary:'test',findings:[],runOutcome:trace.outcome})}),
      reportWriter:async()=>{if(stage==='report')throw new Error('report failure');return {htmlPath:'report.html',jsonPath:'report.json'};},
    });
    expect(report.rows).toHaveLength(1);expect(report.rows[0]).toMatchObject({runId:trace.runId,outcome:trace.outcome,classification:'task-completed',metrics:{actions:1},tracePath:'default/trace.json',analysisStatus:stage==='analysis'?'failed':'completed',reportStatus:stage==='report'?'failed':'completed'});
  });
  it('closes an acquired backend if setup budget expires before runner ownership',async()=>{
    const root=await directory();const b=backend();let now=0;vi.spyOn(Date,'now').mockImplementation(()=>now);
    const report=await runEnvironmentMatrix(task,{outDir:join(root,'matrix'),mode:'native',profiles:['default'],createBackend:async()=>{now=2000;return b;},createPolicy:()=>({decide:()=>({stop:'success'})})});
    expect(b.close).toHaveBeenCalledOnce();expect(execute).not.toHaveBeenCalled();expect(report.rows[0]?.classification).toBe('runtime-error');
  });
});
