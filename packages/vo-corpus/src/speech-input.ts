import type {VoiceOverSpeechInput} from 'rawstep/mock-voiceover';
import {nativeNodeName,type AxDump,type AxNode} from './axdump.js';
import {observeVisualCursor} from './cursor.js';

const names=(a:unknown)=>typeof a==='string'?a.replace(/\s+/g,' ').trim():'';
const roles:Record<string,string>={AXButton:'button',AXCheckBox:'checkbox'};
const scopeRoles=new Set(['main','navigation','banner','contentinfo','complementary','region','form','group','radio group','tab group','article']);
function scope(n:AxNode){
  const description=String(n.AXRoleDescription??'');
  const role=n.AXRole==='AXTable'?'table':n.AXRole==='AXGroup'&&scopeRoles.has(description)?description.replace('radio group','radiogroup').replace('tab group','tablist'):undefined;
  if(!role)return undefined;
  const name=nativeNodeName(n);if(!name&&role!=='article'&&role!=='table')return undefined;
  const result:{role:string;name:string;rows?:number;columns?:number}={role,name};
  if(role==='table'){
    const count=(role:string)=>{const nodes=n.children?.filter(c=>c.AXRole===role)??[];return nodes.some(c=>!Number.isSafeInteger(c.AXElementId))?undefined:new Set(nodes.map(c=>c.AXElementId)).size;};
    result.rows=count('AXRow');result.columns=count('AXColumn');
  }
  return result;
}

/** Verifies only the button/checkbox inputs used by speech-contexts-v1. Never reads utterances or AX keyboard focus. */
export function checkSpeechInput(input:VoiceOverSpeechInput,dump:AxDump|undefined){
  const unknown=(reason:string)=>({status:'unmeasured' as const,reasons:[reason]});
  if(!dump)return unknown('native AX snapshot missing');
  const visible=observeVisualCursor(dump);
  if(visible.status!=='observed'||visible.targetStatus!=='unique-geometry-candidate')return unknown('stable unique visible target not established');
  const chains=visible.candidates[0]!.paths.map(path=>{
    let node=dump.root;const ancestors:AxNode[]=[];
    for(const index of path){ancestors.push(node);node=node.children![index]!;}
    return {node,ancestors};
  });
  const {node}=chains[0]!,expected=input.target.semantic;
  if(chains.some(c=>JSON.stringify([c.node.AXRole,nativeNodeName(c.node),c.node.AXValue,c.node.AXEnabled])!==JSON.stringify([node.AXRole,nativeNodeName(node),node.AXValue,node.AXEnabled])))return unknown('native alias attributes disagree');
  if(!['button','checkbox'].includes(expected.role)||!roles[node.AXRole??''])return unknown('role outside this input verifier');
  if(typeof node.AXEnabled!=='boolean')return unknown('enabled state missing');
  const reasons:string[]=[];
  if(roles[node.AXRole??'']!==expected.role)reasons.push('target role differs');
  if(names(nativeNodeName(node))!==names(expected.name))reasons.push('target name differs');
  if(node.AXDOMIdentifier&&node.AXDOMIdentifier!==input.target.identity)reasons.push('target DOM identity differs');
  if(!node.AXEnabled!==expected.disabled)reasons.push('disabled state differs');
  if(expected.role==='checkbox'){
    if(![0,1,2,false,true,'mixed'].includes(node.AXValue as never))return unknown('checked state missing');
    const checked=node.AXValue===2||node.AXValue==='mixed'?'mixed':node.AXValue===1||node.AXValue===true;
    if(checked!==expected.checked)reasons.push('checked state differs');
  }
  const observedScopes=chains.map(c=>c.ancestors.flatMap(n=>{const s=scope(n);return s?[s]:[]}));
  if(observedScopes.some(s=>JSON.stringify(s)!==JSON.stringify(observedScopes[0])))return unknown('native alias ancestor contexts disagree');
  const expectedScopes=(input.target.containers??[]).map(c=>({role:c.role,name:c.name,...(c.role==='table'?{rows:c.rows,columns:c.columns}:{})}));
  if(observedScopes[0]!.some(s=>s.role==='table'&&(!s.rows||!s.columns)))return unknown('native table dimensions not observed');
  if(JSON.stringify(observedScopes[0])!==JSON.stringify(expectedScopes))reasons.push('ancestor context differs');
  if(!!input.target.cell!==chains.some(c=>c.ancestors.some(n=>n.AXRole==='AXCell')))reasons.push('cell context differs');
  return {status:reasons.length?'mismatch' as const:'verified' as const,reasons,observedTarget:{role:roles[node.AXRole??''],name:nativeNodeName(node),id:String(node.AXDOMIdentifier??'')},observedScopes:observedScopes[0],
    scope:'Stable unique visible geometry candidate plus native target/state/ancestor observations; not a logical cursor API or Navigation Accuracy. Synthetic static markup supplies non-changing semantic defaults; unused cell coordinates are not independently verified.'};
}
