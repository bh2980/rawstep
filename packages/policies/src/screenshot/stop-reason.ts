import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import type { RunTrace } from '@rawstep/core/trace';
import { SCREENSHOT_MODEL_PROTOCOL, validateModelResponse, type ScreenshotModelAdapter, type ScreenshotModelRequest, type ScreenshotChoice } from './model.js';
import type { Decision, ScreenshotObservation } from '@rawstep/core/contracts';
import { screenshotHash } from './policy.js';
export const STOP_REASON_CHOICES = Object.freeze([
  ['no-visible-focus','No visible keyboard focus can be located'],['unknown-next-action','The next useful keyboard action is unclear'],['no-visible-change','Recent actions did not visibly change the screen'],['apparent-cycle','The recent visible states appear to repeat'],['goal-uncertain','It is unclear whether the task goal has been achieved'],['insufficient-visual-info','The screenshot provides insufficient visual information'],['other-unknown','Other or unknown; no specific explanation is justified']
] as const);
export type StopReasonReport = {schemaVersion:'1.0';runId:string;originalOutcome:RunTrace['outcome'];status:'completed'|'not-applicable'|'unavailable'|'failed';stopSource?:string;hypothesis?:string;model?:{id:string;runtime:string;revision?:string};choices?:{id:string;label:string}[];probabilities?:number[];screenshotEventId?:string;screenshotSha256?:string;durationMs?:number;reason?:string;limitation:string};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
/** Optional read-only second opinion. Never mutates a trace, verifies success or dispatches an action. */
export async function diagnoseScreenshotStop(trace:RunTrace,options:{model:ScreenshotModelAdapter;timeoutMs?:number;signal?:AbortSignal}):Promise<StopReasonReport>{
  const base:StopReasonReport={schemaVersion:'1.0',runId:trace.runId,originalOutcome:structuredClone(trace.outcome),status:'not-applicable',stopSource:typeof trace.outcome?.policyStopSource==='string'?trace.outcome.policyStopSource:undefined,limitation:'Uncalibrated model hypothesis selected from a bounded list. This does not establish a page defect, actual focus state or a causal explanation. The original trace and run outcome are unchanged.'};
  const stops=trace.events.filter(e=>e.type==='policy.decision').map(e=>object(object(e.data).decision));const last=stops.at(-1);
  if(!last||!['stuck','uncertain'].includes(String(last.stop)))return base;
  const event=trace.events.filter(e=>e.type==='keyboard.observation').at(-1);const data=object(event?.data);const screenshot=data.screenshot as ScreenshotObservation|undefined;
  if(!event||event.redacted||!screenshot||typeof screenshot.pngBase64!=='string')return {...base,status:'unavailable',reason:'The final screenshot is unavailable or private; no stale screenshot was substituted.'};
  const timeoutMs=options.timeoutMs??RAWSTEP_DEFAULTS.modelTimeoutMs;if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300_000)throw new Error('Stop diagnosis timeout must be 1–300000ms.');
  const signal=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(options.signal?[options.signal]:[])]);const started=performance.now();
  try{
    const choices:ScreenshotChoice[]=STOP_REASON_CHOICES.map(([id,label])=>({id:`reason:${id}`,label,decision:{stop:'uncertain'}}));
    const history=trace.events.filter(e=>e.type==='policy.decision').slice(-12).map(e=>{const value=object(e.data),decision=object(value.decision);let safe:Decision={stop:'uncertain'};if(['success','stuck','uncertain'].includes(String(decision.stop)))safe={stop:decision.stop as 'stuck'};else{const action=object(decision.action);if(action.kind==='key'&&typeof action.key==='string')safe={action:{kind:'key',key:action.key}};else if(['typeText','replaceText'].includes(String(action.kind))&&typeof action.input==='string')safe={action:{kind:action.kind as 'typeText',input:action.input}}}return{step:typeof value.step==='number'?value.step:0,decision:safe}});
    const sha256=screenshotHash(screenshot);
    const request:ScreenshotModelRequest={protocol:SCREENSHOT_MODEL_PROTOCOL,purpose:'stop-reason',goal:trace.task.goal??'Explain the recorded stop using only the final screenshot and action history.',screenshot:{pngBase64:screenshot.pngBase64,viewport:{...screenshot.viewport}},choices:structuredClone(choices),history,visualState:{sha256,visits:1,unchangedTransitions:0}};
    const result=await new Promise<Awaited<ReturnType<ScreenshotModelAdapter['choose']>>>((resolve,reject)=>{const abort=()=>reject(signal.reason);if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});Promise.resolve().then(()=>options.model.choose(request,{signal})).then(value=>{signal.removeEventListener('abort',abort);signal.aborted?reject(signal.reason):resolve(value)},error=>{signal.removeEventListener('abort',abort);reject(error)})});
    validateModelResponse(result,choices);
    return{...base,status:'completed',hypothesis:result.choiceId.slice(7),model:{id:result.model.id,runtime:result.model.runtime,...(result.model.revision?{revision:result.model.revision}:{})},choices:choices.map(({id,label})=>({id,label})),...(result.probabilities?{probabilities:result.probabilities}:{}),screenshotEventId:event.id,screenshotSha256:sha256,durationMs:performance.now()-started};
  }catch{return{...base,status:'failed',reason:'Stop-reason classification failed, timed out or was cancelled; raw model errors omitted.',durationMs:performance.now()-started}}
}
