import type {Case} from '../cases.js';

/** Isolate self-disable receipts; reserve different histories/layouts before inspecting these Native contrasts. */
export function generateButtonDisableSpeech(partition:'train'|'test'){
 const set=partition==='train'?'button-disable-source-v1':'button-disable-transfer-v1',pages:Record<string,string>={},cases:Case[]=[];
 const add=(variant:string,body:string,chords:string[],disabled:boolean)=>{
  const id=set+'.'+variant;
  pages[variant]=`<!doctype html><html lang=en><meta charset=utf-8><title>Workspace confirmation</title><style>body{font:17px system-ui;padding:16px}button{margin:7px;padding:7px}section,form,fieldset,[role=group]{padding:8px}</style><body><button id=before autofocus>Before marker</button>${body}<p id=receipt></p><button id=after>After marker</button></body></html>`;
  cases.push({id,page:'pages/'+variant+'.html',chords,captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},taskOutcome:{controls:[{role:'button',name:'Confirm workspace choice',state:{disabled}}],texts:['Workspace choice confirmed.']},axes:{family:'button-self-disable-receipt',role:'button',partition,exposure:partition==='train'?'calibration':'unseen',templateGroup:partition==='train'?set:id,siteGroup:partition==='train'?set:id,contrastGroup:partition==='train'?set:id,oraclePurpose:'fixture-health',command:partition==='train'?'space-state-contrast':'reverse-return-before-disable'}});
 };
 const button=(disable:boolean)=>`<button id=first type=button onclick="${disable?'this.disabled=true;':''}document.getElementById('receipt').textContent='Workspace choice confirmed.'">Confirm workspace choice</button>`;
 if(partition==='train')for(const context of ['bare','form'])for(const disable of [false,true]){
  const b=button(disable);add(context+'-'+(disable?'disable':'enabled'),context==='form'?`<form aria-label="Workspace settings" onsubmit="return false">${b}</form>`:b,['Tab','Space'],disable);
 }else{
  add('review-card',`<section aria-label="Workspace review"><button id=lead>Review account</button>${button(true)}<button id=tail>Review permissions</button></section>`,['Tab','Tab','Tab','Shift+Tab','Shift+Tab','Tab','Space'],true);
  add('confirmation-form',`<article aria-label="Workspace summary"><form aria-label="Confirm workspace" onsubmit="return false"><fieldset><legend>Confirmation choices</legend><button id=lead>Read confirmation details</button>${button(true)}</fieldset></form></article>`,['Tab','Tab','Shift+Tab','Tab','Shift+Tab','Tab','Space'],true);
 }
 return {pages,cases};
}
