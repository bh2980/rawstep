import {generateListProfiles} from './list-profiles.js';

/** Apply the declared geometry protocol to reserved inputs without changing task bodies or histories. */
export function generateMeasuredListTransfer(){
 const source=generateListProfiles('test'),pages:Record<string,string>={},cases:typeof source.cases=[],focusTargets:Record<string,string[]>={};
 for(const parent of source.cases){
  const variant=parent.page.slice(6,-5),id='list-profiles-measured-transfer-v1.'+variant;
  pages[variant]=source.pages[variant]!.replace('button,a{margin:4px}','button,a{margin:4px}a{display:inline-block;padding:4px}');
  cases.push({...parent,id,axes:{...parent.axes,measurement:'padded-text-anchor-v1',sourceReservedCase:parent.id}});focusTargets[id]=source.focusTargets[parent.id]!;
 }
 return {pages,cases,focusTargets};
}
