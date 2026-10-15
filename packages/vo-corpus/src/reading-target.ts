import type {AxDump,AxNode} from './axdump.js';
import {nativeNodeName} from './axdump.js';
import {observeVisualCursor} from './cursor.js';
import type {ModelCursorObservation} from './cursor-model.js';

type Target={id:string;role:string;name:string};
const nativeRoles:Record<string,string>={AXButton:'button',AXLink:'link',AXHeading:'heading',AXStaticText:'statictext',AXTextField:'textbox',AXTextArea:'textbox',AXCheckBox:'checkbox',AXRadioButton:'radio',AXSwitch:'switch',AXSlider:'slider',AXComboBox:'combobox'};
const atomic=new Set(Object.values(nativeRoles));
const name=(s:unknown)=>typeof s==='string'?s.replace(/\s+/g,' ').trim():'';
const key=(t:Target)=>JSON.stringify([t.role,t.name]);
const scope='Experimental visible atomic reading-target comparison. Container/end boundaries, caret positions and ambiguous identities are unmeasured; this is not full logical Navigation Accuracy.';

/** Neither speech nor AX/DOM keyboard focus participates in target assignment or equality. */
export function compareReadingTarget(dump:AxDump|undefined,model:ModelCursorObservation|undefined){
  const unknown=(reason:string)=>({status:'unmeasured' as const,reason,scope});
  if(!dump)return unknown('native AX snapshot missing');
  const visible=observeVisualCursor(dump);
  if(visible.status!=='observed'||visible.targetStatus!=='unique-geometry-candidate')return unknown('stable unique native geometry candidate not established');
  if(model?.status!=='observed'||model.protocol!=='model-cursor-cdp-v1'||model.cursor?.protocol!=='mock-reading-cursor-v1'||!model.cursor.target||!model.axNodes)return unknown('independent model reading-target observation missing');
  const cursor=model.cursor.target;
  if(cursor.end)return unknown('native visible outline cannot distinguish entry from an end boundary');
  const nodes=new Map<number,AxNode>();let inconsistent=false;
  function visit(n:AxNode){
    if(Number.isSafeInteger(n.AXElementId)){
      const id=Number(n.AXElementId),old=nodes.get(id);
      if(old&&JSON.stringify([old.AXRole,old.AXDOMIdentifier,old.AXTitle,old.AXDescription,old.AXValue])!==JSON.stringify([n.AXRole,n.AXDOMIdentifier,n.AXTitle,n.AXDescription,n.AXValue]))inconsistent=true;
      nodes.set(id,n);
    }
    n.children?.forEach(visit);
  }
  visit(dump.root);
  if(inconsistent)return unknown('native alias identity changed during snapshot');
  const nativeNode=nodes.get(visible.candidates[0]!.axId);
  if(!nativeNode)return unknown('native geometry candidate missing from AX inventory');
  const targetOf=(n:AxNode):Target=>({id:name(n.AXDOMIdentifier),role:nativeRoles[n.AXRole??'']??'',name:name(n.AXRole==='AXStaticText'?n.AXValue:nativeNodeName(n))});
  const native=targetOf(nativeNode),predicted:Target={id:model.domId??'',role:cursor.role.toLowerCase(),name:name(cursor.name)};
  if(!atomic.has(native.role)||!atomic.has(predicted.role))return unknown('logical unit is outside the calibrated atomic-role observer');
  // AX node IDs are session-local; backend DOM node IDs join independently opened CDP sessions.
  const sources=model.axNodes.filter(n=>!n.ignored&&(cursor.backendDOMNodeId===undefined?n.nodeId===cursor.axId:n.backendDOMNodeId===cursor.backendDOMNodeId));
  if(sources.length!==1)return unknown('model target source absent or ambiguous in independent AX inventory');
  const source=sources[0]!;
  if(name(source.name)!==predicted.name||source.role.toLowerCase()!==predicted.role)return unknown('projected model unit differs from its independent AX source');
  if(native.role!==predicted.role)return {status:'mismatch' as const,reason:'different atomic reading-unit roles',native,predicted,scope};
  if(native.id&&predicted.id){
    if(model.domIdCount!==1||[...nodes.values()].filter(n=>targetOf(n).id===native.id&&targetOf(n).role===native.role).length!==1)return unknown('DOM identity is not unique on both sides');
    return {status:native.id===predicted.id?'matched' as const:'mismatch' as const,identityMethod:'dom-id' as const,native,predicted,scope};
  }
  if(!native.name||!predicted.name)return unknown('unnamed atomic target has no common DOM identity');
  const nativePeers=[...nodes.values()].map(targetOf).filter(n=>key(n)===key(native));
  const modelPeers=model.axNodes.filter(n=>!n.ignored&&n.role.toLowerCase()===predicted.role&&name(n.name)===predicted.name);
  if(nativePeers.length!==1||modelPeers.length!==1)return unknown('role/name identity is ambiguous or absent in independent inventories');
  return {status:key(native)===key(predicted)?'matched' as const:'mismatch' as const,identityMethod:'unique-role-name' as const,native,predicted,scope};
}

export function summarizeReadingTargets(rows:ReturnType<typeof compareReadingTarget>[]){
  const matched=rows.filter(r=>r.status==='matched').length,mismatch=rows.filter(r=>r.status==='mismatch').length;
  return {status:'experimental-visible-target' as const,planned:rows.length,matched,mismatch,unmeasured:rows.length-matched-mismatch,
    comparable:matched+mismatch,conditionalRate:matched+mismatch?matched/(matched+mismatch):null,allPlanRate:rows.length?matched/rows.length:null,scope};
}
