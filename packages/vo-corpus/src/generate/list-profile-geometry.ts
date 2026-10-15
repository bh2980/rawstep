import {generateListProfiles} from './list-profiles.js';

/** Measurement contrast: larger anchor boxes separate AXLink from its text child's geometry. */
export function generateListProfileGeometry(){
 const source=generateListProfiles('train'),pages:Record<string,string>={},cases:typeof source.cases=[],focusTargets:Record<string,string[]>={};
 for(const variant of ['ul-none-role','ul-none','ol-default']){
  const parent=source.cases.find(c=>c.page===`pages/${variant}.html`)!,id='list-profile-geometry-v1.'+variant;
  pages[variant]=source.pages[variant]!.replace('button,a{margin:4px}','button,a{margin:4px}a{display:inline-block;padding:4px}');
  cases.push({...parent,id,axes:{...parent.axes,geometry:'padded-anchor',sourceCase:parent.id}});focusTargets[id]=source.focusTargets[parent.id]!;
 }
 return {pages,cases,focusTargets};
}
