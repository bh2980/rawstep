import {setTimeout as wait} from 'node:timers/promises';
import type {AxDump} from './axdump.js';
type Probe={clock:'host-unix-ms';requestedAt:number;observedAt:number;snapshot?:AxDump;error?:string};

/** Allow same-document canonical slash/query additions, never an unrelated old page or origin. */
export function matchesDocumentURL(actual:unknown,requested:string){
 if(typeof actual!=='string'||!URL.canParse(actual)||!URL.canParse(requested))return false;
 const a=new URL(actual),r=new URL(requested),path=(u:URL)=>u.pathname.replace(/\/$/,'');
 return a.protocol===r.protocol&&a.origin===r.origin&&path(a)===path(r)&&[...new Set(r.searchParams.keys())].every(key=>JSON.stringify(a.searchParams.getAll(key))===JSON.stringify(r.searchParams.getAll(key)));
}

/** Navigation commit evidence only: neither network-idle, full content nor speech completion is established. */
export async function waitForNativeDocument(read:()=>Promise<AxDump>,requested:string,options:{timeoutMs?:number;pollMs?:number;onProbe?:(probe:Probe)=>Promise<void>|void}={}){
 const timeoutMs=options.timeoutMs??45000,pollMs=options.pollMs??500;
 if(!URL.canParse(requested)||!Number.isFinite(timeoutMs)||timeoutMs<0||!Number.isFinite(pollMs)||pollMs<=0)throw new Error('A requested URL and finite nonnegative timeout/positive poll interval are required');
 const startedAt=Date.now();let attempts=0;
 for(;;){
  const probe:Probe={clock:'host-unix-ms',requestedAt:Date.now(),observedAt:0};
  try{probe.snapshot=await read();}catch(error){probe.error=String(error);}
  probe.observedAt=Date.now();attempts++;await options.onProbe?.(probe);
  const dump=probe.snapshot;
  if(dump?.root.AXRole==='AXWebArea'&&matchesDocumentURL(dump.root.AXURL,requested)&&!!dump.root.children?.length)return {status:'document-observed' as const,startedAt,endedAt:Date.now(),attempts,url:String(dump.root.AXURL)};
  if(Date.now()-startedAt>=timeoutMs)return {status:'timeout' as const,startedAt,endedAt:Date.now(),attempts};
  await wait(Math.min(pollMs,timeoutMs-(Date.now()-startedAt)));
 }
}
