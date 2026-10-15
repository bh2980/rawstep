import type {AxDump,AxNode} from './axdump.js';

export type CursorRect={x:number;y:number;width:number;height:number};
type Sample={protocol:string;status:string;frame?:CursorRect;window?:CursorRect&{id:number;ownerPID:number;layer:number};pngBase64?:string;reason?:string};
export type VisualCursorCapture={before:Sample;after:Sample;stable:boolean;scope?:string};
const rectangle=(r:CursorRect|undefined):r is CursorRect=>!!r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
const equal=(a:CursorRect,b:CursorRect,tolerance=0)=>['x','y','width','height'].every(k=>Math.abs(a[k as keyof CursorRect]-b[k as keyof CursorRect])<=tolerance);

/** Independently visible outline; candidate identity uses geometry only, never speech or AX keyboard focus. */
export function observeVisualCursor(dump:AxDump){
  const raw=dump.visualCursor;
  const candidates:{axId:number;role:string;paths:number[][]}[]=[];
  if(!raw)return {status:'unmeasured' as const,candidates,reason:'visual observation not requested'};
  const {before,after}=raw;
  if([before,after].some(s=>!s||s.protocol!=='visible-vo-overlay-v1'||s.status!=='observed'||!rectangle(s.frame)||!rectangle(s.window)))return {status:'unavailable' as const,candidates,reason:'isolated outline not established in both captures'};
  if(!raw.stable||!equal(before.frame!,after.frame!)||before.window!.id!==after.window!.id||before.window!.ownerPID!==after.window!.ownerPID)return {status:'unstable' as const,candidates,reason:'outline or owning window changed across AX observation'};
  const frame=after.frame!,window=after.window!;
  let unidentified=false;
  function visit(n:AxNode,path:number[]){
    const p=n.AXPosition as {x:number;y:number}|undefined,z=n.AXSize as {width:number;height:number}|undefined;
    if(p&&z&&rectangle({...p,...z})){
      // Four points of outline padding were independently measured on the default macOS profile.
      const left=Math.max(window.x,p.x-4),top=Math.max(window.y,p.y-4),right=Math.min(window.x+window.width,p.x+z.width+4),bottom=Math.min(window.y+window.height,p.y+z.height+4);
      if(equal(frame,{x:left,y:top,width:right-left,height:bottom-top},1)){
        if(!Number.isSafeInteger(n.AXElementId)||Number(n.AXElementId)<=0)unidentified=true;
        else{
          const previous=candidates.find(c=>c.axId===n.AXElementId);
          if(previous)previous.paths.push(path);
          else candidates.push({axId:Number(n.AXElementId),role:String(n.AXRole??''),paths:[path]});
        }
      }
    }
    n.children?.forEach((c,i)=>visit(c,[...path,i]));
  }
  visit(dump.root,[]);
  const targetStatus=dump.truncated||dump.stringTruncations||unidentified?'unmeasured' as const:candidates.length===1?'unique-geometry-candidate' as const:candidates.length?'ambiguous' as const:'unmatched' as const;
  return {status:'observed' as const,frame,candidates,targetStatus,
    scope:'Visible cursor location is observed independently. A geometry candidate is not a direct logical VoiceOver cursor API result or a native/model Navigation Accuracy score.'};
}

export function summarizeVisualCursor(rows:ReturnType<typeof observeVisualCursor>[]){
  return {planned:rows.length,observed:rows.filter(r=>r.status==='observed').length,
    uniqueGeometryCandidates:rows.filter(r=>r.status==='observed'&&r.targetStatus==='unique-geometry-candidate').length,
    ambiguous:rows.filter(r=>r.status==='observed'&&r.targetStatus==='ambiguous').length,
    unmatched:rows.filter(r=>r.status==='observed'&&r.targetStatus==='unmatched').length,
    unstable:rows.filter(r=>r.status==='unstable').length,unavailable:rows.filter(r=>r.status==='unavailable').length,
    unmeasured:rows.filter(r=>r.status==='unmeasured'||r.status==='observed'&&r.targetStatus==='unmeasured').length,
    scope:'Native visible-location observation coverage only. No simulator cursor comparison or full logical Navigation Accuracy is established.'};
}
