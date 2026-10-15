import type {VoiceOverSpeechInput} from 'rawstep/mock-voiceover';
import {nativeNodeName,nativePressedState,nativeHeadingLevel,type AxDump,type AxNode} from './axdump.js';
import {observeVisualCursor} from './cursor.js';
import {nativeCustomContent} from './native-content.js';

function nativeContainerPath(dump:AxDump,path:number[]){
  const unknown=(reason:string)=>({status:'unmeasured' as const,reason});
  if(dump.truncated||dump.stringTruncations)return unknown('Native attributes are truncated');
  let node=dump.root;
  const containers:NonNullable<VoiceOverSpeechInput['target']['containers']>[number][]=[];
  for(const [i,index]of path.entries()){
    if(['AXTable','AXCell','AXOutline'].includes(node.AXRole??'')||node.AXRole==='AXList'&&node.AXSubrole!=='AXContentList'||node.AXRoleDescription==='article'||unsupportedSpeechAncestor(node,i)||unmappedLandmark(node))return unknown('ancestor requires independently measured structural context not supplied by this probe');
    const s=scope(node);if(s)containers.push({...s,id:String(node.AXDOMIdentifier||`scope:${path.slice(0,i).join('.')}:${s.role}:${s.name}`),items:0});
    if(!Number.isSafeInteger(index)||index<0||!node.children?.[index])return unknown('Native target path missing');
    node=node.children[index]!;
  }
  return {status:'observed' as const,node,containers,path};
}

function observedContainerPath(dump:AxDump){
  const visible=observeVisualCursor(dump);
  if(visible.status!=='observed'||visible.targetStatus!=='unique-geometry-candidate')return {status:'unmeasured' as const,reason:'stable unique visible target not established'};
  return {...nativeContainerPath(dump,visible.candidates[0]!.paths[0]!),singlePath:visible.candidates[0]!.paths.length===1};
}

/** Used context can be observed even when the previous object's own speech role is unsupported. */
export function observedSpeechContext(dump:AxDump){
  const frame=observedContainerPath(dump);if(frame.status!=='observed')return frame;
  if(!frame.singlePath||scope(frame.node)||unmappedLandmark(frame.node)||['AXWebArea','AXGroup','AXTable','AXCell','AXList','AXOutline'].includes(frame.node.AXRole??''))return {status:'unmeasured' as const,reason:'previous structural boundary or alias context requires further observation'};
  return {status:'observed' as const,context:{containers:frame.containers.map(c=>c.id),focusContext:frame.containers.filter(c=>c.role!=='list').at(-1)?.id},
    scope:'Visible previous object ancestor path after a declared focus/object move; model history projection, not a Native private speech-cache or navigation-accuracy measurement.'};
}

/** Intended target input from Native attributes; this does not establish the VoiceOver reading position. */
export function nativeSpeechInput(dump:AxDump,path:number[],command:string){
  const unknown=(reason:string)=>({status:'unmeasured' as const,reason});
  const frame=nativeContainerPath(dump,path);if(frame.status!=='observed')return frame;
  const {node,containers}=frame;
  const semanticRole=role(node);if(!semanticRole)return unknown('target role outside this input verifier');
  if(typeof node.AXEnabled!=='boolean')return unknown('enabled state missing');
  const content=nativeCustomContent(node);if(content.status!=='observed')return unknown('additional content not measured');
  if(typeof node.AXValue==='string'&&node.AXValue&&semanticRole==='button')return unknown('button value needs independent interpretation');
  const pressed=nativePressedState(node);
  if(semanticRole==='button'&&node.AXRole==='AXCheckBox'&&pressed===undefined)return unknown('pressed state missing');
  if(semanticRole==='heading'&&nativeHeadingLevel(node)===undefined)return unknown('heading level missing');
  if(semanticRole==='checkbox'&&![0,1,2,false,true,'mixed'].includes(node.AXValue as never))return unknown('checked state missing');
  const description=content.entries.filter(e=>e.label==='description'&&e.importance===1).map(e=>e.value).join(' ');
  const input:VoiceOverSpeechInput={command,target:{identity:String(node.AXDOMIdentifier||`target:${path.join('.')}`),containers,semantic:{
    role:semanticRole,name:nativeNodeName(node),protected:false,disabled:!node.AXEnabled,readonly:false,required:node.AXRequired===true,multiline:false,modal:false,
    hasMoreContent:content.hasMoreContent,...(description?{description}:{}),...(typeof node.AXHelp==='string'&&node.AXHelp?{help:node.AXHelp}:{}),
    ...(pressed!==undefined?{pressed}:{}),...(typeof node.AXExpanded==='boolean'?{expanded:node.AXExpanded}:{}),
    ...(semanticRole==='checkbox'?{checked:node.AXValue===2||node.AXValue==='mixed'?'mixed':node.AXValue===1||node.AXValue===true}:{}),
    ...(semanticRole==='heading'?{level:nativeHeadingLevel(node)}:{}),...(semanticRole==='link'?{currentPage:node.AXARIACurrent==='page',containsImage:containsNativeImage(node)}:{})
  }}};
  return {status:'constructed' as const,input,unmeasuredFields:['target.containers.items'],scope:'Native target attributes and ancestry only; reading position remains unverified. Unused container item counts are placeholders, not observed zeroes.'};
}

/** Caller input from an independently visible Native target, never an utterance or AX keyboard focus. */
export function observedSpeechInput(dump:AxDump,command:string){
  const frame=observedContainerPath(dump);if(frame.status!=='observed')return frame;
  const candidate=nativeSpeechInput(dump,frame.path,command);if(candidate.status!=='constructed')return candidate;
  const verification=checkSpeechInput(candidate.input,dump);
  return verification.status==='verified'?{status:'observed' as const,input:candidate.input,verification}:{status:'unmeasured' as const,reason:verification.reasons.join('; ')};
}

const names=(a:unknown)=>typeof a==='string'?a.replace(/\s+/g,' ').trim():'';
const containsNativeImage=(n:AxNode):boolean=>(n.children??[]).some(child=>child.AXRole==='AXImage'||containsNativeImage(child));
const roles:Record<string,string>={AXButton:'button',AXCheckBox:'checkbox',AXLink:'link',AXHeading:'heading'};
const role=(n:AxNode)=>n.AXRole==='AXCheckBox'&&['AXToggle','AXToggleButton'].includes(String(n.AXSubrole))?'button':roles[n.AXRole??''];
const landmarkRoles=new Set(['main','navigation','banner','contentinfo','complementary','region','form']);
const scopeRoles=new Set([...landmarkRoles,'group','radio group','tab group','article']);
const unsupportedSpeechAncestor=(n:AxNode,index:number)=>n.AXRole==='AXWebArea'&&index>0||['AXDialog','AXSheet'].includes(n.AXRole??'')||['AXApplicationDialog','AXApplicationAlertDialog'].includes(String(n.AXSubrole))||['dialog','web dialog','alertdialog','web alert dialog'].includes(String(n.AXRoleDescription));
const unmappedLandmark=(n:AxNode)=>String(n.AXSubrole??'').startsWith('AXLandmark')&&!scope(n);
function scope(n:AxNode){
  // Both browsers expose the same subrole; Safari calls it "content information", Chrome "footer".
  const description=n.AXSubrole==='AXLandmarkContentInfo'?'contentinfo':String(n.AXRoleDescription??'');
  const role=n.AXRole==='AXTable'?'table':n.AXRole==='AXList'&&n.AXSubrole==='AXContentList'?'list':n.AXRole==='AXGroup'&&scopeRoles.has(description)?description.replace('radio group','radiogroup').replace('tab group','tablist'):undefined;
  if(!role)return undefined;
  const name=nativeNodeName(n);if(!name&&!landmarkRoles.has(role)&&!['article','table','list'].includes(role))return undefined;
  const result:{role:string;name:string;rows?:number;columns?:number}={role,name};
  if(role==='table'){
    const count=(role:string)=>{const nodes=n.children?.filter(c=>c.AXRole===role)??[];return nodes.some(c=>!Number.isSafeInteger(c.AXElementId))?undefined:new Set(nodes.map(c=>c.AXElementId)).size;};
    result.rows=count('AXRow');result.columns=count('AXColumn');
  }
  return result;
}

/** Verifies supported object inputs against visible geometry and AX attributes, never speech or keyboard focus. */
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
  if(chains.some(c=>c.ancestors.some((n,i)=>unsupportedSpeechAncestor(n,i))))return unknown('dialog or nested web-area context not independently verified');
  if(chains.some(c=>c.ancestors.some(unmappedLandmark)))return unknown('Native landmark role outside this input verifier');
  if(chains.some(c=>c.ancestors.some(n=>n.AXRole==='AXList'&&n.AXSubrole!=='AXContentList')))return unknown('Native list widget outside this input verifier');
  if(chains.some(c=>JSON.stringify([c.node.AXRole,c.node.AXSubrole,nativeNodeName(c.node),nativeHeadingLevel(c.node),c.node.AXValue,c.node.AXExpanded,c.node.AXEnabled])!==JSON.stringify([node.AXRole,node.AXSubrole,nativeNodeName(node),nativeHeadingLevel(node),node.AXValue,node.AXExpanded,node.AXEnabled])))return unknown('native alias attributes disagree');
  if(!['button','checkbox','link','heading'].includes(expected.role)||!role(node))return unknown('role outside this input verifier');
  if(typeof node.AXEnabled!=='boolean')return unknown('enabled state missing');
  const reasons:string[]=[];
  if(role(node)!==expected.role)reasons.push('target role differs');
  if(names(nativeNodeName(node))!==names(expected.name))reasons.push('target name differs');
  if(node.AXDOMIdentifier&&node.AXDOMIdentifier!==input.target.identity)reasons.push('target DOM identity differs');
  if(!node.AXEnabled!==expected.disabled)reasons.push('disabled state differs');
  if(typeof node.AXRequired==='boolean'&&node.AXRequired!==expected.required)reasons.push('required state differs');
  if(expected.required&&typeof node.AXRequired!=='boolean')return unknown('required state missing');
  if(expected.role==='link'){
    if(!!expected.containsImage!==containsNativeImage(node))reasons.push('link image content differs');
    if(!!expected.currentPage!==(node.AXARIACurrent==='page'))reasons.push('current-page state differs');
  }
  if(expected.role==='heading'){
    const level=nativeHeadingLevel(node);
    if(level===undefined||expected.level===undefined)return unknown('heading level unmeasured');
    if(level!==expected.level)reasons.push('heading level differs');
  }
  const pressed=nativePressedState(node);
  if(expected.pressed!==undefined){
    if(pressed===undefined)return unknown('pressed state missing');
    if(pressed!==expected.pressed)reasons.push('pressed state differs');
  }else if(pressed!==undefined)reasons.push('toggle state missing in input');
  if(expected.expanded!==undefined){
    if(typeof node.AXExpanded!=='boolean')return unknown('expanded state missing');
    if(node.AXExpanded!==expected.expanded)reasons.push('expanded state differs');
  }
  if(expected.role==='checkbox'){
    if(![0,1,2,false,true,'mixed'].includes(node.AXValue as never))return unknown('checked state missing');
    const checked=node.AXValue===2||node.AXValue==='mixed'?'mixed':node.AXValue===1||node.AXValue===true;
    if(checked!==expected.checked)reasons.push('checked state differs');
  }
  if(expected.description!==undefined||expected.help!==undefined||expected.hasMoreContent!==undefined){
    const contents=chains.map(c=>nativeCustomContent(c.node));
    if(contents.some(c=>c.status!=='observed'))return unknown('native custom content unmeasured');
    if(contents.some(c=>JSON.stringify(c)!==JSON.stringify(contents[0])))return unknown('native alias custom content differs');
    const content=contents[0]!;
    if(content.status==='observed'){
      if(expected.hasMoreContent!==undefined&&expected.hasMoreContent!==content.hasMoreContent)reasons.push('additional content availability differs');
      if(expected.description!==undefined&&expected.description!==content.entries.filter(e=>e.label==='description'&&e.importance===1).map(e=>e.value).join(' '))reasons.push('inline description differs');
    }
    if(expected.help!==undefined){
      if(chains.some(c=>typeof c.node.AXHelp!=='string'))return unknown('native help unmeasured');
      if(chains.some(c=>c.node.AXHelp!==expected.help))reasons.push('native help differs');
    }
  }
  const observedScopes=chains.map(c=>c.ancestors.flatMap(n=>{const s=scope(n);return s?[s]:[]}));
  if(observedScopes.some(s=>JSON.stringify(s)!==JSON.stringify(observedScopes[0])))return unknown('native alias ancestor contexts disagree');
  const expectedScopes=(input.target.containers??[]).map(c=>({role:c.role,name:c.name,...(c.role==='table'?{rows:c.rows,columns:c.columns}:{})}));
  if(observedScopes[0]!.some(s=>s.role==='table'&&(!s.rows||!s.columns)))return unknown('native table dimensions not observed');
  if(JSON.stringify(observedScopes[0])!==JSON.stringify(expectedScopes))reasons.push('ancestor context differs');
  if(!!input.target.cell!==chains.some(c=>c.ancestors.some(n=>n.AXRole==='AXCell')))reasons.push('cell context differs');
  return {status:reasons.length?'mismatch' as const:'verified' as const,reasons,observedTarget:{role:role(node),name:nativeNodeName(node),id:String(node.AXDOMIdentifier??'')},observedScopes:observedScopes[0],observedHelp:typeof node.AXHelp==='string'?node.AXHelp:undefined,
    scope:'Stable unique visible geometry candidate plus native target/state/ancestor observations; not a logical cursor API or Navigation Accuracy. Non-changing defaults remain caller supplied; unused container counts and cell coordinates are not independently verified.'};
}
