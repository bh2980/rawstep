import type {AxNode} from './axdump.js';

/** API no-value is observed absence; old/missing, failed or undecodable data remains unmeasured. */
export function nativeCustomContent(node:AxNode){
  const unknown=(reason:string)=>({status:'unmeasured' as const,reason});
  if(node.AXCustomContentWithheld)return unknown('protected content withheld');
  const raw=node.AXCustomContent as {status?:unknown;errorCode?:unknown;entries?:unknown;rawBase64?:unknown;byteCount?:unknown}|undefined;
  if(raw?.status==='no-value'&&raw.errorCode===-25212)return {status:'observed' as const,hasMoreContent:false,entries:[]};
  if(raw?.status!=='observed'||!Array.isArray(raw.entries)||typeof raw.rawBase64!=='string')return unknown('custom content not observed');
  const bytes=Buffer.from(raw.rawBase64,'base64');
  if(bytes.length!==raw.byteCount||bytes.toString('base64')!==raw.rawBase64)return unknown('archive bytes missing or corrupted');
  const entries=raw.entries as {label:unknown;value:unknown;importance:unknown}[];
  if(entries.some(e=>!e||typeof e!=='object'||typeof e.label!=='string'||typeof e.value!=='string'||!Number.isSafeInteger(e.importance)))return unknown('invalid decoded entries');
  return {status:'observed' as const,hasMoreContent:entries.length>0,entries:entries as {label:string;value:string;importance:number}[]};
}
