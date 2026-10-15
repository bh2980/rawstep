import type {Case} from '../cases.js';

/** Browser contrasts reuse measured primitives; the reserved tasks have new structures and histories. */
export function generateListProfiles(partition:'train'|'test'){
 const id=partition==='train'?'list-profiles-v1':'list-profiles-transfer-v1',pages:Record<string,string>={},cases:Case[]=[],focusTargets:Record<string,string[]>={};
 function add(variant:string,body:string,trace:[string,string][],taskOutcome:NonNullable<Case['taskOutcome']>){
  const caseId=id+'.'+variant;
  pages[variant]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Resource collection</title><style>body{font:17px system-ui;padding:16px}button,a{margin:4px}li{padding:5px}</style><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
  cases.push({id:caseId,page:'pages/'+variant+'.html',chords:trace.map(([,key])=>key),captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},taskOutcome,axes:{family:partition==='train'?'list-browser-contrast':'list-dynamic-task-transfer',role:'link',partition,exposure:partition==='train'?'calibration':'unseen',templateGroup:partition==='train'?id:caseId,contrastGroup:id,siteGroup:partition==='train'?'synthetic-list-profile-calibration':'synthetic-list-profile-transfer',command:partition==='train'?'focus-entry-exit-return':'focus-state-save-return'}});
  focusTargets[caseId]=trace.map(([target])=>target);
 }
 if(partition==='train')for(const v of [
  {id:'ul-default',tag:'ul',none:false,explicit:false,nav:false},
  {id:'ul-none',tag:'ul',none:true,explicit:false,nav:false},
  {id:'ul-none-role',tag:'ul',none:true,explicit:true,nav:false},
  {id:'ul-none-nav',tag:'ul',none:true,explicit:false,nav:true},
  {id:'ol-default',tag:'ol',none:false,explicit:false,nav:false},
  {id:'ol-none',tag:'ol',none:true,explicit:false,nav:false},
 ]){
  const list=`<${v.tag}${v.explicit?' role="list"':''}${v.none?' style="list-style:none"':''}><li><a id="first" href="#alpha">First resource</a></li><li><a id="second" href="#beta">Second resource</a></li></${v.tag}>`;
  add(v.id,v.nav?`<nav aria-label="Resource routes">${list}</nav>`:list,[['first','Tab'],['second','Tab'],['after','Tab'],['second','Shift+Tab'],['first','Shift+Tab'],['before','Shift+Tab']],{controls:[{role:'link',name:'First resource',state:{disabled:false}}],texts:[]});
 }
 if(partition==='test'){
  add('reading-workspace',`<main aria-label="Reading workspace"><article aria-label="Research collection"><ul style="list-style:none"><li><a id="first" href="#atlas">Inspect atlas</a></li><li><a id="second" href="#archive">Inspect archive</a></li><li id="extra" hidden><a id="third" href="#research">Inspect research notes</a></li></ul><label><input id="choice" type="checkbox" onchange="document.getElementById('extra').hidden=!this.checked">Include research resources</label><button id="save" onclick="document.getElementById('saved').textContent='Reading collection saved'">Save reading collection</button><p id="saved"></p></article></main>`,
   [['first','Tab'],['second','Tab'],['choice','Tab'],['choice','Space'],['third','Shift+Tab'],['second','Shift+Tab'],['first','Shift+Tab'],['second','Tab'],['third','Tab'],['choice','Tab'],['save','Tab'],['save','Space']],
   {controls:[{role:'checkbox',name:'Include research resources',state:{checked:true}},{role:'link',name:'Inspect research notes',state:{disabled:false}}],texts:['Reading collection saved']});
  add('product-references',`<section aria-label="Product references"><ol style="list-style:none"><li><a id="first" href="#materials">Inspect materials</a></li><li><a id="second" href="#dimensions">Inspect dimensions</a></li><li id="extra" hidden><a id="third" href="#care">Inspect care instructions</a></li></ol><button id="choice" aria-expanded="false" aria-controls="extra" onclick="this.setAttribute('aria-expanded',String(this.getAttribute('aria-expanded')!=='true'));document.getElementById('extra').hidden=this.getAttribute('aria-expanded')!=='true'">Show care reference</button><button id="save" onclick="document.getElementById('saved').textContent='Product references saved'">Save product references</button><p id="saved"></p></section>`,
   [['first','Tab'],['second','Tab'],['choice','Tab'],['choice','Space'],['third','Shift+Tab'],['choice','Tab'],['save','Tab'],['save','Space'],['choice','Shift+Tab'],['third','Shift+Tab'],['second','Shift+Tab'],['first','Shift+Tab'],['second','Tab'],['third','Tab'],['choice','Tab'],['save','Tab']],
   {controls:[{role:'button',name:'Show care reference',state:{expanded:true}},{role:'link',name:'Inspect care instructions',state:{disabled:false}}],texts:['Product references saved']});
 }
 return {pages,cases,focusTargets};
}
