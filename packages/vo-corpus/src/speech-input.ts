import type {VoiceOverSpeechInput} from 'rawstep/mock-voiceover';
import {nativeNodeName,nativePressedState,nativeHeadingLevel,type AxDump,type AxNode} from './axdump.js';
import {observeVisualCursor} from './cursor.js';
import {nativeCustomContent} from './native-content.js';

function nativeContainerPath(dump:AxDump,path:number[]){
  const unknown=(reason:string)=>({status:'unmeasured' as const,reason});
  if(dump.truncated||dump.stringTruncations)return unknown('Native attributes are truncated');
  let node=dump.root;
  const ancestors:AxNode[]=[];
  const containers:NonNullable<VoiceOverSpeechInput['target']['containers']>[number][]=[];
  for(const [i,index]of path.entries()){
    if(['AXTable','AXCell','AXOutline'].includes(node.AXRole??'')||node.AXRole==='AXList'&&node.AXSubrole!=='AXContentList'||unsupportedSpeechAncestor(node,i)||unmappedLandmark(node))return unknown('ancestor requires independently measured structural context not supplied by this probe');
    if(!Number.isSafeInteger(index)||index<0||!node.children?.[index])return unknown('Native target path missing');
    ancestors.push(node);
    const s=scope(node);
    if(s?.role==='dialog'&&(s.items===undefined||s.items<1||!measuredName(node)||!s.name&&!dialogFirstChildName(node)))return unknown('Native dialog name, direct children or named first child unmeasured');
    if(s?.role==='article'&&(!measuredName(node)||!s.name&&!measuredName(node.children[index]!)))return unknown('Native article or entry child name attributes missing');
    if(s)containers.push({...s,...(s.role==='dialog'&&dialogFirstChildName(node)!==undefined?{firstChildName:dialogFirstChildName(node)}:{}),...(s.role==='article'&&measuredName(node.children[index]!)?{entryChildName:nativeNodeName(node.children[index])}:{}),id:String(node.AXDOMIdentifier||`scope:${path.slice(0,i).join('.')}:${s.role}:${s.name}`),items:s.items??0});
    node=node.children[index]!;
  }
  return {status:'observed' as const,node,containers,path,ancestors};
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
  const {node,containers,ancestors}=frame;
  const semanticRole=role(node);if(!semanticRole)return unknown('target role outside this input verifier');
  if(typeof node.AXEnabled!=='boolean')return unknown('enabled state missing');
  const content=nativeCustomContent(node);if(content.status!=='observed')return unknown('additional content not measured');
  if(typeof node.AXValue==='string'&&node.AXValue&&semanticRole==='button')return unknown('button value needs independent interpretation');
  const pressed=nativePressedState(node);
  if(semanticRole==='button'&&node.AXRole==='AXCheckBox'&&pressed===undefined)return unknown('pressed state missing');
  if(semanticRole==='heading'&&nativeHeadingLevel(node)===undefined)return unknown('heading level missing');
  if(semanticRole==='checkbox'&&![0,1,2,false,true,'mixed'].includes(node.AXValue as never))return unknown('checked state missing');
  const linkSet=semanticRole==='link'?nativeLinkSet(node,ancestors):undefined;
  if(linkSet?.status==='unmeasured')return unknown(linkSet.reason);
  const description=content.entries.filter(e=>e.label==='description'&&e.importance===1).map(e=>e.value).join(' ');
  const input:VoiceOverSpeechInput={command,target:{identity:String(node.AXDOMIdentifier||`target:${path.join('.')}`),containers,semantic:{
    role:semanticRole,name:nativeNodeName(node),protected:false,disabled:!node.AXEnabled,readonly:false,required:node.AXRequired===true,multiline:false,modal:false,
    hasMoreContent:content.hasMoreContent,...(description?{description}:{}),...(typeof node.AXHelp==='string'&&node.AXHelp?{help:node.AXHelp}:{}),
    ...(pressed!==undefined?{pressed}:{}),...(typeof node.AXExpanded==='boolean'?{expanded:node.AXExpanded}:{}),
    ...(semanticRole==='checkbox'?{checked:node.AXValue===2||node.AXValue==='mixed'?'mixed':node.AXValue===1||node.AXValue===true}:{}),
    ...(semanticRole==='heading'?{level:nativeHeadingLevel(node)}:{}),...(semanticRole==='link'?{currentPage:node.AXARIACurrent==='page',containsImage:containsNativeImage(node),...(linkSet?.status==='observed'?{position:linkSet.position,setSize:linkSet.setSize}:{})}:{})
  }}};
  return {status:'constructed' as const,input,unmeasuredFields:containers.flatMap((c,i)=>c.role==='dialog'?[]:[`target.containers.${i}.items`]),scope:'Native target attributes and ancestry only; reading position remains unverified. Dialog items count independently exposed Native children; other unused counts remain placeholders, not observed zeroes.'};
}

/** Caller input from an independently visible Native target, never an utterance or AX keyboard focus. */
export function observedSpeechInput(dump:AxDump,command:string){
  const frame=observedContainerPath(dump);if(frame.status!=='observed')return frame;
  const candidate=nativeSpeechInput(dump,frame.path,command);if(candidate.status!=='constructed')return candidate;
  const verification=checkSpeechInput(candidate.input,dump);
  return verification.status==='verified'?{status:'observed' as const,input:candidate.input,verification}:{status:'unmeasured' as const,reason:verification.reasons.join('; ')};
}

const measuredName=(n:AxNode)=>typeof n.AXTitle==='string'||typeof n.AXDescription==='string';
const names=(a:unknown)=>typeof a==='string'?a.replace(/\s+/g,' ').trim():'';
/** Default content-list ordinal from independently exposed Native children, never an utterance. */
function nativeLinkSet(node:AxNode,ancestors:AxNode[]){
  const unknown=(reason:string)=>({status:'unmeasured' as const,reason});
  const explicit=(n:AxNode)=>n.AXARIAPosInSet!==undefined||n.AXARIASetSize!==undefined;
  if(explicit(node))return unknown('explicit Native link set attributes require separate calibration');
  let index=ancestors.length-1;
  while(index>=0&&!(ancestors[index]!.AXRole==='AXList'&&ancestors[index]!.AXSubrole==='AXContentList'))index--;
  if(index<0)return {status:'not-applicable' as const};
  const list=ancestors[index]!,item=ancestors[index+1]??node,children=list.children;
  if(explicit(item))return unknown('explicit Native list-item set attributes require separate calibration');
  let unit=item;
  while(unit!==node){
    const content=unit.children?.filter(c=>c.AXRole!=='AXListMarker');
    if(unit.AXRole!=='AXGroup'||nativeNodeName(unit)||unit.childrenTruncated||content?.length!==1)return unknown('Native list item is not a single unnamed link unit');
    unit=content[0]!;
  }
  if(!children?.length||list.childrenTruncated||children.some(c=>!Number.isSafeInteger(c.AXElementId)||Number(c.AXElementId)<=0)||new Set(children.map(c=>c.AXElementId)).size!==children.length)return unknown('complete unique Native list children required for link set metrics');
  const position=children.indexOf(item)+1;
  return position>0?{status:'observed' as const,position,setSize:children.length}:unknown('Native link list child missing');
}
const containsNativeImage=(n:AxNode):boolean=>(n.children??[]).some(child=>child.AXRole==='AXImage'||containsNativeImage(child));
const roles:Record<string,string>={AXButton:'button',AXCheckBox:'checkbox',AXLink:'link',AXHeading:'heading'};
const role=(n:AxNode)=>n.AXRole==='AXCheckBox'&&['AXToggle','AXToggleButton'].includes(String(n.AXSubrole))?'button':roles[n.AXRole??''];
const landmarkRoles=new Set(['main','navigation','banner','contentinfo','complementary','region','form']);
const scopeRoles=new Set([...landmarkRoles,'group','radio group','tab group','article']);
const isDialog=(n:AxNode)=>n.AXRole==='AXGroup'&&n.AXSubrole==='AXApplicationDialog'&&['dialog','web dialog'].includes(String(n.AXRoleDescription));
const dialogFirstChildName=(n:AxNode)=>n.children?.[0]&&measuredName(n.children[0])?nativeNodeName(n.children[0]):undefined;
const unsupportedSpeechAncestor=(n:AxNode,index:number)=>n.AXRole==='AXWebArea'&&index>0||!isDialog(n)&&(['AXDialog','AXSheet'].includes(n.AXRole??'')||['AXApplicationDialog','AXApplicationAlertDialog'].includes(String(n.AXSubrole))||['dialog','web dialog','alertdialog','web alert dialog'].includes(String(n.AXRoleDescription)));
const unmappedLandmark=(n:AxNode)=>String(n.AXSubrole??'').startsWith('AXLandmark')&&!scope(n);
function scope(n:AxNode){
  // Both browsers expose the same subrole; Safari calls it "content information", Chrome "footer".
  const description=n.AXSubrole==='AXLandmarkContentInfo'?'contentinfo':String(n.AXRoleDescription??'');
  const role=isDialog(n)?'dialog':n.AXRole==='AXTable'?'table':n.AXRole==='AXList'&&n.AXSubrole==='AXContentList'?'list':n.AXRole==='AXGroup'&&scopeRoles.has(description)?description.replace('radio group','radiogroup').replace('tab group','tablist'):undefined;
  if(!role)return undefined;
  const name=nativeNodeName(n);if(!name&&!landmarkRoles.has(role)&&!['article','table','list','dialog'].includes(role))return undefined;
  const result:{role:string;name:string;rows?:number;columns?:number;items?:number}={role,name};
  if(role==='dialog'){
    const nodes=n.children;result.items=nodes&&!n.childrenTruncated&&nodes.every(c=>Number.isSafeInteger(c.AXElementId)&&Number(c.AXElementId)>0)?new Set(nodes.map(c=>c.AXElementId)).size:undefined;
  }
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
    const sets=chains.map(c=>nativeLinkSet(c.node,c.ancestors)),set=sets[0]!;
    if(sets.some(s=>JSON.stringify(s)!==JSON.stringify(set)))return unknown('native alias link set metrics disagree');
    if(set.status==='unmeasured')return unknown(set.reason);
    if(set.status==='observed'){
      if(expected.position===undefined||expected.setSize===undefined)reasons.push('link set metrics missing in input');
      else if(expected.position!==set.position||expected.setSize!==set.setSize)reasons.push('link set metrics differ');
    }else if(expected.position!==undefined||expected.setSize!==undefined)return unknown('Native link set metrics unmeasured');
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
  const expectedScopes=(input.target.containers??[]).map(c=>({role:c.role,name:c.name,...(c.role==='table'?{rows:c.rows,columns:c.columns}:c.role==='dialog'?{items:c.items}:{})}));
  if(observedScopes[0]!.some(s=>s.role==='table'&&(!s.rows||!s.columns)))return unknown('native table dimensions not observed');
  if(JSON.stringify(observedScopes[0])!==JSON.stringify(expectedScopes))reasons.push('ancestor context differs');
  const dialogChains=chains.map(c=>c.ancestors.filter(isDialog));
  if(dialogChains.some(c=>c.length>1))return unknown('nested dialog speech context not calibrated');
  const firstChildNames=dialogChains.map(chain=>chain.map(dialogFirstChildName));
  if(firstChildNames.some(names=>JSON.stringify(names)!==JSON.stringify(firstChildNames[0])))return unknown('native alias dialog first children disagree');
  for(const [i,dialog]of dialogChains[0]!.entries()){
    const observed=scope(dialog)!,expected=(input.target.containers??[]).filter(c=>c.role==='dialog')[i];
    if(observed.items===undefined||observed.items<1||!measuredName(dialog))return unknown('Native dialog name or direct-child count unmeasured');
    if(!expected)continue;
    if(!observed.name&&(!dialogFirstChildName(dialog)||expected.firstChildName===undefined))return unknown('unnamed dialog first-child summary unmeasured');
    if(expected.firstChildName!==undefined){
      if(dialogFirstChildName(dialog)===undefined)return unknown('Native dialog first child name attributes missing');
      if(expected.firstChildName!==dialogFirstChildName(dialog))reasons.push('dialog first child name differs');
    }
  }

  const articleEntries=chains.map(c=>c.ancestors.flatMap((n,i)=>scope(n)?.role==='article'?[{name:nativeNodeName(n),nameMeasured:measuredName(n),entryChildName:measuredName(c.ancestors[i+1]??c.node)?nativeNodeName(c.ancestors[i+1]??c.node):undefined}]:[]));
  const expectedArticles=(input.target.containers??[]).filter(c=>c.role==='article');
  if(articleEntries.some(entries=>JSON.stringify(entries)!==JSON.stringify(articleEntries[0])))return unknown('native alias article entry children disagree');
  for(const [i,article]of articleEntries[0]!.entries()){
    const expected=expectedArticles[i];
    if(!expected)continue;
    if(!article.nameMeasured||(!article.name||expected.entryChildName!==undefined)&&article.entryChildName===undefined)return unknown('Native article or entry child name attributes missing');
    if(!article.name&&expected.entryChildName===undefined)return unknown('unnamed article entry child name unmeasured');
    if(expected?.entryChildName!==undefined&&expected.entryChildName!==article.entryChildName)reasons.push('article entry child name differs');
  }

  if(!!input.target.cell!==chains.some(c=>c.ancestors.some(n=>n.AXRole==='AXCell')))reasons.push('cell context differs');
  return {status:reasons.length?'mismatch' as const:'verified' as const,reasons,observedTarget:{role:role(node),name:nativeNodeName(node),id:String(node.AXDOMIdentifier??'')},observedScopes:observedScopes[0],observedHelp:typeof node.AXHelp==='string'?node.AXHelp:undefined,
    scope:'Stable unique visible geometry candidate plus native target/state/ancestor observations; not a logical cursor API or Navigation Accuracy. Non-changing defaults remain caller supplied; unused container counts and cell coordinates are not independently verified.'};
}
