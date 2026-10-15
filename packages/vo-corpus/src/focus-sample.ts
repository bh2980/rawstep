import {createHash} from 'node:crypto';
import {nativeNodeName,type AxDump,type AxNode} from './axdump.js';
type Target={role:'AXButton'|'AXCheckBox'|'AXLink';name:string;category:'button'|'link';path:number[]};

/** Fixed role slots and hash ranking; no speech, predicted correctness or replacement after failure. */
export function sampleFocusTargets(dump:AxDump,seed:string){
 if(!seed||dump.truncated||dump.stringTruncations)throw new Error('A seed and complete Native AX tree are required');
 const groups=new Map<string,{target:Target;ids:Set<number>;enabled:boolean;identified:boolean}>();
 function visit(node:AxNode,path:number[]){
  const role=node.AXRole as Target['role'],name=nativeNodeName(node);
  const category=role==='AXLink'?'link':role==='AXButton'||role==='AXCheckBox'&&['AXToggle','AXToggleButton'].includes(String(node.AXSubrole))?'button':undefined;
  if(category&&name){
   const key=JSON.stringify([role,name]),id=Number(node.AXElementId),identified=Number.isSafeInteger(id)&&id>0;
   const group=groups.get(key)??{target:{role,name,category,path},ids:new Set<number>(),enabled:node.AXEnabled===true,identified:true};
   group.ids.add(id);group.identified&&=identified;group.enabled&&=node.AXEnabled===true;groups.set(key,group);
  }
  node.children?.forEach((child,i)=>visit(child,[...path,i]));
 }
 visit(dump.root,[]);
 const targets=[...groups.values()].filter(g=>g.identified&&g.ids.size===1&&g.enabled).map(g=>({...g.target,rank:createHash('sha256').update(seed+'\0'+JSON.stringify([g.target.role,g.target.name])).digest('hex')})).sort((a,b)=>a.rank.localeCompare(b.rank));
 const used={button:0,link:0};
 const slots=(['button','link','button','link'] as const).map(category=>{
  const target=targets.filter(t=>t.category===category)[used[category]++];
  return target?{category,status:'selected' as const,target}:{category,status:'unavailable' as const,reason:'fewer than two uniquely named enabled controls of this role'};
 });
 return {slots,poolCounts:{button:targets.filter(t=>t.category==='button').length,link:targets.filter(t=>t.category==='link').length},ambiguousNames:[...groups.values()].filter(g=>g.ids.size!==1||!g.identified).length,
  scope:'Two button and two link slots among uniquely named, enabled Native controls. Not an unbiased element sample or coverage of unnamed/disabled controls. Alias equality uses snapshot-local Native IDs.'};
}
