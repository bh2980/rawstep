import type {Case} from '../cases.js';

/** Reserved before the hint calibration: a state task and a distinct link-reading composition. */
export function generateHintContextTransfer(){
 const set='hint-context-transfer-v1',pages:Record<string,string>={},cases:Case[]=[],targetIds:Record<string,string[]>={};
 const add=(variant:string,body:string,trace:[string,string][],taskOutcome:NonNullable<Case['taskOutcome']>,purpose:string)=>{
  const id=set+'.'+variant;
  pages[variant]=`<!doctype html><html lang=en><meta charset=utf-8><title>Travel preferences</title><style>body{font:17px system-ui;padding:16px}button{margin:5px}a{display:inline-block;padding:7px;margin:5px}</style><body><button id=before autofocus>Before marker</button>${body}<button id=after>After marker</button></body></html>`;
  cases.push({id,page:'pages/'+variant+'.html',chords:trace.map(([,chord])=>chord),captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},taskOutcome,axes:{family:'hint-context-composition-transfer',role:purpose==='task-outcome'?'button':'link',partition:'test',exposure:'unseen',templateGroup:id,siteGroup:id,contrastGroup:id,oraclePurpose:purpose,command:purpose==='task-outcome'?'enable-save-reverse-return':'compare-three-link-sources'}});
  targetIds[id]=trace.map(([target])=>target);
 };
 add('delivery-preferences',`<section aria-label="Journey settings"><form><button id=first type=button title="Use arrival notices" aria-pressed=false onclick='this.setAttribute("aria-pressed",this.getAttribute("aria-pressed")!=="true");document.getElementById("second").disabled=this.getAttribute("aria-pressed")!=="true"'>Use arrival notices</button><button id=second type=button title="Store the journey preferences" disabled onclick='document.getElementById("saved").textContent="Journey preferences stored"'>Store preferences</button><p id=saved></p></form></section>`,
  [['first','Tab'],['first','Space'],['second','Tab'],['second','Space'],['first','Shift+Tab'],['first','Space'],['first','Space'],['second','Tab'],['first','Shift+Tab'],['second','Tab'],['after','Tab'],['second','Shift+Tab'],['second','Space'],['first','Shift+Tab']],
  {controls:[{role:'button',name:'Use arrival notices',state:{pressed:true}},{role:'button',name:'Store preferences',state:{disabled:false}}],texts:['Journey preferences stored']},'task-outcome');
 add('route-link-notices','<div><a id=first href="#after">Local route notes</a><a id=second href="#after" title="Regional route notes">Regional route notes</a><a id=third href="#after" title="Details about extended routes">Extended route notes</a></div>',
  [['first','VO+Right'],['second','VO+Right'],['third','VO+Right'],['second','VO+Left'],['first','VO+Left'],['second','VO+Right'],['first','VO+Left'],['second','VO+Right'],['third','VO+Right'],['after','VO+Right']],
  {controls:[{role:'link',name:'Local route notes',state:{disabled:false}},{role:'link',name:'Regional route notes',state:{disabled:false}},{role:'link',name:'Extended route notes',state:{disabled:false}}],texts:[]},'fixture-health');
 return {pages,cases,targetIds};
}
