import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,VoiceOverSpeechTarget,VoiceOverContainer,SimulatedSemanticNode} from 'rawstep/mock-voiceover';

/** Explicit caller-owned targets and state transitions; no prediction or Native receipt constructs these inputs. */
export function generateSpeechTransfer(){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,VoiceOverSpeechInput[]>={};
 const semantic=(name:string,extra:Partial<SimulatedSemanticNode>={}):SimulatedSemanticNode=>({role:'button',name,protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false,...extra});
 const scope=(id:string,role:string,name:string,items:number):VoiceOverContainer=>({id,role,name,items});
 const target=(identity:string,node:SimulatedSemanticNode,containers:VoiceOverContainer[]):VoiceOverSpeechTarget=>({identity,semantic:node,containers});
 function add(id:string,body:string,nodes:VoiceOverSpeechTarget[],script:[string,string][]){
  pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Outdoor trip preferences</title><style>body{font:17px system-ui;padding:20px}section,main,fieldset,form,div[role=group]{margin:10px;padding:10px;border:1px solid #777}button,label{display:block;margin:12px}</style><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
  const caseId=`speech-transfer-v1.${id}`;
  cases.push({id:caseId,page:`pages/${id}.html`,chords:script.map(([,chord])=>chord),captureAxAfterSteps:true,listen:{minWaitMs:1500,quietMs:1000,maxWaitMs:6500},axes:{family:'speech-description-state-composition',role:'button-and-checkbox',partition:'test',exposure:'unseen',templateGroup:`speech-transfer-v1.${id}`,siteGroup:'synthetic-speech-transfer-v1',command:'focus-state-return-history'}});
  const states=new Map(nodes.map(n=>[n.identity,structuredClone(n)]));states.set('before',target('before',semantic('Before marker'),[]));
  speechInputs[caseId]=script.map(([identity,chord])=>{
   const node=states.get(identity)!;
   if(chord==='Space'){if(node.semantic.role!=='checkbox')throw new Error('Only checkbox state changes are authored here');node.semantic.checked=!node.semantic.checked;}
   return {target:structuredClone(node),command:chord==='Tab'?'next_focusable_item':chord==='Shift+Tab'?'previous_focusable_item':'activate_form_control',...(chord==='Space'?{checkedStateChanged:true}:{})};
  });
 }
 const region=scope('rental','region','Rental settings',5),form=scope('delivery','form','Trip delivery',4),group=scope('notices','group','Trip notices',3);
 add('rental-delivery',`<section aria-label="Rental settings"><form aria-label="Trip delivery"><div role="group" aria-label="Trip notices"><label><input id="first" type="checkbox" checked aria-describedby="notice">Weather updates</label><p id="notice" hidden>Sent before departure, when available.</p><button id="second" type="button" title="Review the packing list, before checkout.">Review packing</button></div><button id="third" type="button" aria-description="Keep a local receipt, for your records.">Store itinerary</button></form></section>`,[
  target('first',semantic('Weather updates',{role:'checkbox',tagName:'input',inputType:'checkbox',checked:true,description:'Sent before departure, when available.',hasMoreContent:true}),[region,form,group]),
  target('second',semantic('Review packing',{help:'Review the packing list, before checkout.'}),[region,form,group]),
  target('third',semantic('Store itinerary',{description:'Keep a local receipt, for your records.',hasMoreContent:true}),[region,form]),
 ],[['first','Tab'],['first','Space'],['second','Tab'],['third','Tab'],['second','Shift+Tab'],['first','Shift+Tab'],['first','Space'],['before','Shift+Tab'],['first','Tab'],['first','Space'],['second','Tab']]);
 const main=scope('harbor','main','Harbor preferences',4),fieldset=scope('offline','group','Offline access',3),storage=scope('storage','group','Storage notifications',1);
 add('offline-storage',`<main aria-label="Harbor preferences"><fieldset><legend>Offline access</legend><button id="first" type="button" aria-description="Available without a network connection.">Prepare map</button><div role="group" aria-label="Storage notifications"><label><input id="second" type="checkbox" title="Warn before the storage quota is reached.">Storage warning</label></div></fieldset><button id="third" type="button" title="Check the permissions, before sharing.">Review access</button></main>`,[
  target('first',semantic('Prepare map',{description:'Available without a network connection.',hasMoreContent:true}),[main,fieldset]),
  target('second',semantic('Storage warning',{role:'checkbox',tagName:'input',inputType:'checkbox',checked:false,help:'Warn before the storage quota is reached.'}),[main,fieldset,storage]),
  target('third',semantic('Review access',{help:'Check the permissions, before sharing.'}),[main]),
 ],[['first','Tab'],['second','Tab'],['second','Space'],['first','Shift+Tab'],['second','Tab'],['third','Tab'],['second','Shift+Tab'],['second','Space'],['third','Tab'],['second','Shift+Tab']]);
 return {pages,cases,speechInputs};
}
