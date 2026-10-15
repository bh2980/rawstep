import {nativeHeadingLevel,nativeNodeName,type AxNode} from './axdump.js';
import {nativeCustomContent} from './native-content.js';

const contains=(n:AxNode,role:string):boolean=>(n.children??[]).some(c=>c.AXRole===role||contains(c,role));
const compound=(n:AxNode)=>n.AXRole==='AXLink'&&contains(n,'AXHeading')||n.AXRole==='AXHeading'&&contains(n,'AXLink');

/** A measured single linked-heading unit; preserves the physical node and its activation-link identity separately. */
export function nativeLinkedHeading(node:AxNode,ancestors:AxNode[],command:string,browser:'safari'|'chrome'){
  const unknown=(reason:string)=>({status:'unmeasured' as const,reason});
  if(ancestors.some(compound))return unknown('linked-heading child position is outside the measured outer-unit scope');
  if(!compound(node))return {status:'not-applicable' as const};
  if(!['next_item','previous_item'].includes(command))return unknown('linked-heading command outside the measured object-reading scope');
  const nodes:AxNode[]=[],visit=(n:AxNode)=>{nodes.push(n);n.children?.forEach(visit);};visit(node);
  if(nodes.some(n=>n.childrenTruncated||!Number.isSafeInteger(n.AXElementId)||Number(n.AXElementId)<1)||new Set(nodes.map(n=>n.AXElementId)).size!==nodes.length)return unknown('complete unique Native linked-heading children required');
  const content=nodes.map(nativeCustomContent);
  if(content.some(c=>c.status!=='observed'||c.hasMoreContent)||nodes.some(n=>n.AXEnabled!==true||n.AXHelp||n.AXRequired||n.AXExpanded!==undefined||n.AXInvalid&&n.AXInvalid!==false||n.AXARIACurrent&&n.AXARIACurrent!=='false'))return unknown('linked-heading help, custom content or nondefault state requires separate calibration');
  const transparent=(n:AxNode)=>n.AXRole==='AXGroup'&&n.AXRoleDescription==='group'&&!nativeNodeName(n);
  const children=(n:AxNode):AxNode[]=>(n.children??[]).flatMap(c=>transparent(c)?children(c):[c]);
  const inner=children(node),child=inner.length===1?inner[0]:undefined;
  const outerLink=node.AXRole==='AXLink',heading=outerLink?child:node,link=outerLink?node:child;
  if(heading?.AXRole!=='AXHeading'||link?.AXRole!=='AXLink')return unknown('linked-heading is not a single heading/link pair');
  const level=nativeHeadingLevel(heading),name=nativeNodeName(node),leaves=children(outerLink?heading:link);
  if(level===undefined||!name||nativeNodeName(heading)!==name||nativeNodeName(link)!==name||leaves.length!==1||leaves[0]!.AXRole!=='AXStaticText'||leaves[0]!.children?.length||leaves[0]!.AXValue!==name)return unknown('linked-heading names, level or plain-text unit are ambiguous');
  if(!link.AXDOMIdentifier)return unknown('linked-heading activation identity missing');
  const disclosure=heading.AXDisclosureLevel;
  if(browser==='chrome'&&!outerLink&&(!Number.isSafeInteger(disclosure)||Number(disclosure)<1||Number(disclosure)>5))return unknown('Native linked-heading disclosure level missing or outside measured positive range');
  return {status:'observed' as const,heading,link,identity:String(link.AXDOMIdentifier),semantic:{level,headingLink:true,
    ...(outerLink?{headingLinkOrder:'link-heading' as const}:{headingParts:[{text:name,link:true}],...(browser==='chrome'?{nativeDisclosureLevel:Number(disclosure)}:{})})},
    scope:'Complete equal-name single link/heading with plain text, positive independently exposed Chrome disclosure level, and object next/previous commands. Physical outline and activation-link identity are distinct; no logical cursor inference.'};
}
