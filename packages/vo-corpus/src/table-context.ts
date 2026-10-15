import {nativeNodeName,type AxDump,type AxNode} from './axdump.js';

/** Native cell ranges and header references; no DOM, speech, keyboard focus or model annotations. */
export function nativeCellContext(dump:AxDump,ancestors:readonly AxNode[]){
 const unknown=(reason:string)=>({status:'unmeasured' as const,reason}),tables=ancestors.filter(n=>n.AXRole==='AXTable'),cells=ancestors.filter(n=>n.AXRole==='AXCell');
 if(!tables.length&&!cells.length)return {status:'not-applicable' as const};
 if(dump.truncated||dump.stringTruncations||tables.length!==1||cells.length!==1)return unknown('complete single Native table/cell ancestry required');
 const table=tables[0]!,cell=cells[0]!;
 const count=(role:string)=>{const children=table.children?.filter(n=>n.AXRole===role);return table.childrenTruncated||!children?.length||children.some(n=>!Number.isSafeInteger(n.AXElementId)||Number(n.AXElementId)<1)?undefined:new Set(children.map(n=>n.AXElementId)).size;};
 const rows=count('AXRow'),columns=count('AXColumn');if(!rows||!columns)return unknown('Native table dimensions missing');
 const range=(value:unknown,limit:number)=>{const r=value as {location?:number;length?:number}|undefined;return r&&Number.isSafeInteger(r.location)&&Number.isSafeInteger(r.length)&&r.location!>=0&&r.length!>0&&r.location!+r.length!<=limit?{location:r.location!,length:r.length!}:undefined;};
 const row=range(cell.AXRowIndexRange,rows),column=range(cell.AXColumnIndexRange,columns);if(!row||!column)return unknown('Native cell index range/span missing or outside table');
 const refs=cell.AXColumnHeaderUIElements as {status?:string;count?:number;elementIds?:number[]}|undefined;
 if(refs?.status!=='observed'||!Array.isArray(refs.elementIds)||refs.count!==refs.elementIds.length||refs.elementIds.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(refs.elementIds).size!==refs.elementIds.length)return unknown('complete unique Native column-header references required');
 if(refs.elementIds.length>1)return unknown('multiple Native column headers need separate wording calibration');
 const text=(n:AxNode):string|undefined=>{
  if(n.childrenTruncated)return undefined;
  if(n.AXRole==='AXStaticText'){const value=typeof n.AXValue==='string'?n.AXValue:nativeNodeName(n);return value.trim();}
  if(nativeNodeName(n))return nativeNodeName(n);
  const children=n.children?.map(text);return !children||children.some(t=>t===undefined)?undefined:children.filter(Boolean).join(' ');
 };
 let header='';
 if(refs.elementIds.length){
  const matches:AxNode[]=[];const visit=(n:AxNode)=>{if(n.AXElementId===refs.elementIds![0])matches.push(n);n.children?.forEach(visit);};visit(dump.root);
  const names=matches.map(text);if(!names.length||names.some(n=>n===undefined)||names.some(n=>n!==names[0]))return unknown('Native header reference absent, truncated or conflicting across aliases');header=names[0]!;
 }
 return {status:'observed' as const,cell:{row:row.location,column:column.location,rows,columns,header,rowSpan:row.length,columnSpan:column.length},table};
}
