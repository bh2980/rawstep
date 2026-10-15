import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,VoiceOverActivationInput,VoiceOverSpeechTarget,SimulatedSemanticNode,VoiceOverContainer} from 'rawstep/mock-voiceover';

/** New UI compositions and action histories, authored without Native results or predicted speech. */
export function generateActivationTransfer(){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,(VoiceOverSpeechInput&Partial<Pick<VoiceOverActivationInput,'beforeTarget'>>)[]>={};
 const semantic=(name:string,extra:Partial<SimulatedSemanticNode>={}):SimulatedSemanticNode=>({role:'button',tagName:'button',name,protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false,...extra});
 const script:[string,string][]=[['first','Tab'],['first','Space'],['first','Space'],['second','Tab'],['second','Space'],['third','Tab'],['third','Space'],['second','Shift+Tab'],['second','Space'],['first','Shift+Tab'],['first','Space'],['second','Tab']];
 for(const described of [false,true]){
  const variant=described?'archive-tools':'journey-alerts',id=`activation-transfer-v1.${variant}`;
  const outer:VoiceOverContainer={id:'outer',role:described?'region':'main',name:described?'Archive preferences':'Journey preferences',items:3};
  const inner:VoiceOverContainer={id:'inner',role:'group',name:described?'Download controls':'Delivery controls',items:2};
  const first=described?'Include attachments':'Departure notices',second=described?'Download details':'Delivery details',third=described?'Keep original files':'Review itinerary';
  const note='Includes linked files, when available.';
  const button=(key:string,name:string,attributes:string,handler:string)=>`<button id="${key}"${attributes} onclick="this.dataset.activations=String(Number(this.dataset.activations||0)+1);${handler}">${name}</button>`;
  const body=button('first',first,` aria-pressed="${described?'mixed':'false'}"${described?' aria-describedby="note"':''}`,"this.setAttribute('aria-pressed',String(this.getAttribute('aria-pressed')!=='true'))")
    +button('second',second,` aria-expanded="${!described}"`,"this.setAttribute('aria-expanded',String(this.getAttribute('aria-expanded')!=='true'))");
  const tail=button('third',third,described?' aria-pressed="true"':'','');
  const outerTag=described?'section':'main';
  pages[variant]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Workspace notification choices</title><style>body{font:18px system-ui;padding:24px}button{display:block;margin:16px}fieldset,section,main{padding:12px;border:1px solid #777}</style><body><button id="before" autofocus>Before marker</button><${outerTag} aria-label="${outer.name}"><fieldset><legend>${inner.name}</legend>${body}</fieldset>${tail}</${outerTag}><p id="note" hidden>${note}</p><button id="after">After marker</button></body></html>`;
  cases.push({id,page:`pages/${variant}.html`,chords:script.map(([,key])=>key),captureAxAfterSteps:true,listen:{minWaitMs:2200,quietMs:1200,maxWaitMs:7500},axes:{family:'activation-state-context-transfer',role:'button',templateGroup:`activation-transfer-v1.${variant}`,siteGroup:'synthetic-activation-transfer-v1',contrastGroup:'activation-transfer-v1',partition:'test',exposure:'unseen',command:'activation-and-focus-return-history'}});
  const targets:Record<string,VoiceOverSpeechTarget>={first:{identity:'first',containers:[outer,inner],semantic:semantic(first,{pressed:described?'mixed':false,...(described?{description:note,hasMoreContent:true}:{})})},second:{identity:'second',containers:[outer,inner],semantic:semantic(second,{expanded:!described})},third:{identity:'third',containers:[outer],semantic:semantic(third,described?{pressed:true}:{})}};
  speechInputs[id]=script.map(([identity,chord])=>{
   const current=targets[identity]!,beforeTarget=structuredClone(current);
   if(chord==='Space'&&identity!=='third')for(const state of ['pressed','expanded'] as const)if(current.semantic[state]!==undefined)current.semantic[state]=current.semantic[state]!==true;
   return {target:structuredClone(current),command:chord==='Space'?'activate_form_control':chord==='Tab'?'next_focusable_item':'previous_focusable_item',...(chord==='Space'?{beforeTarget}:{})};
  });
 }
 return {pages,cases,speechInputs};
}
