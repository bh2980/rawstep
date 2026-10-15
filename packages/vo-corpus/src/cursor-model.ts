import type {Page} from 'playwright';
import type {MockVoiceOverCursorObservation} from 'rawstep/mock-voiceover';

type AXTarget={nodeId:string;backendDOMNodeId?:number;ignored:boolean;role:string;name:string};
export type ModelCursorObservation={protocol:'model-cursor-cdp-v1';status:'observed'|'unavailable';requestedAt:string;endedAt:string;
  cursor?:MockVoiceOverCursorObservation;domId?:string;domIdCount?:number;axNodes?:AXTarget[];reason?:string};

/** Evaluator-only independent AX inventory and DOM identity, attached to the backend's cached reading target. */
export async function observeModelCursor(page:Page,cursor:MockVoiceOverCursorObservation|undefined,windowId:string):Promise<ModelCursorObservation>{
  const requestedAt=new Date().toISOString(),base={protocol:'model-cursor-cdp-v1' as const,requestedAt};
  if(!cursor?.target||cursor.windowId!==windowId)return {...base,status:'unavailable',endedAt:new Date().toISOString(),reason:'no target from the matching completed observation'};
  const cdp=await page.context().newCDPSession(page),objectGroup='vo-corpus-cursor';
  try{
    await cdp.send('Accessibility.enable');
    const tree=await cdp.send('Accessibility.getFullAXTree');
    const axNodes=tree.nodes.map(n=>({nodeId:n.nodeId,backendDOMNodeId:n.backendDOMNodeId,ignored:n.ignored,role:String(n.role?.value??''),name:String(n.name?.value??'')}));
    let domId='',domIdCount=0;
    if(cursor.target.backendDOMNodeId){
      const {object}=await cdp.send('DOM.resolveNode',{backendNodeId:cursor.target.backendDOMNodeId,objectGroup});
      if(!object.objectId)throw new Error('reading target has no DOM receiver');
      const {result,exceptionDetails}=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,returnByValue:true,
        functionDeclaration:'function(){const id=this instanceof Element?this.id:"";return {id,count:id?Array.from(document.querySelectorAll("[id]")).filter(e=>e.id===id).length:0}}'});
      if(exceptionDetails||!result.value)throw new Error('reading target DOM identity unavailable');
      domId=String(result.value.id??'');domIdCount=Number(result.value.count);
    }
    return {...base,status:'observed',endedAt:new Date().toISOString(),cursor,domId,domIdCount,axNodes};
  }catch(error){return {...base,status:'unavailable',endedAt:new Date().toISOString(),cursor,reason:(error as Error).message};}
  finally{await cdp.send('Runtime.releaseObjectGroup',{objectGroup}).catch(()=>{});await cdp.detach();}
}
