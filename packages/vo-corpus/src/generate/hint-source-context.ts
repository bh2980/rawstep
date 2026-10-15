import type {Case} from '../cases.js';

/** One-factor title/name and form-name contrasts; no live website text is retained. */
export function generateHintSourceContext(){
 const set='hint-source-context-v1',pages:Record<string,string>={},cases:Case[]=[],targetIds:Record<string,string[]>={},authoredHelp:Record<string,string|undefined>={};
 const add=(variant:string,body:string,chords:string[],targets:string[],role:string,title?:string)=>{
  const id=set+'.'+variant;
  pages[variant]=`<!doctype html><html lang=en><meta charset=utf-8><title>Forecast settings</title><style>body{font:17px system-ui;padding:16px}button{margin:5px}a{display:inline-block;padding:7px;margin:5px}</style><body><button id=before autofocus>Before marker</button>${body}<button id=after>After marker</button></body></html>`;
  cases.push({id,page:'pages/'+variant+'.html',chords,captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},taskOutcome:{controls:[{role,name:'Inspect forecast',state:{disabled:false}}],texts:[]},axes:{family:'hint-source-context-calibration',role,partition:'train',exposure:'calibration',templateGroup:set,contrastGroup:variant.startsWith('form-')?set+'.form':set+'.'+role+'-title',sourceCondition:variant,command:role==='link'?'object-entry-return':'focus-entry-within-return'}});
  targetIds[id]=targets;authoredHelp[id]=title;
 };
 for(const role of ['button','link'])for(const condition of ['none','equal','different']){
  const title=condition==='none'?undefined:condition==='equal'?'Inspect forecast':'Review forecast details',attribute=title?` title="${title}"`:'';
  const body=role==='button'?`<button id=first type=button${attribute}>Inspect forecast</button>`:`<a id=first href="#after"${attribute}>Inspect forecast</a>`;
  add(role+'-title-'+condition,body,role==='button'?['Tab','Shift+Tab','Tab']:['VO+Right','VO+Left','VO+Right'],['first','before','first'],role,title);
 }
 const controls='<button id=first type=button>Inspect forecast</button><button id=second type=button>Keep forecast</button>';
 for(const [variant,body]of Object.entries({
  'form-div':`<div>${controls}</div>`,
  'form-unnamed':`<form>${controls}</form>`,
  'form-named':`<form aria-label="Forecast choices">${controls}</form>`,
  'form-region':`<section aria-label="Forecast choices">${controls}</section>`,
 }))add(variant,body,['Tab','Tab','Shift+Tab'],['first','second','first'],'button');
 return {pages,cases,targetIds,authoredHelp};
}
