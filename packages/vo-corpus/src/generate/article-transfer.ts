import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,VoiceOverActivationInput,VoiceOverSpeechTarget,SimulatedSemanticNode,VoiceOverContainer} from 'rawstep/mock-voiceover';

/** New compositions with caller-authored state/history and observable article entry edges. */
export function generateArticleTransfer(browser:'safari'|'chrome'='safari'){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,(VoiceOverSpeechInput&Partial<Pick<VoiceOverActivationInput,'beforeTarget'>>)[]>={};
 const semantic=(name:string,extra:Partial<SimulatedSemanticNode>={}):SimulatedSemanticNode=>({role:'button',tagName:'button',name,protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false,...extra});
 const scope=(id:string,role:string,name='',entryChildName?:string):VoiceOverContainer=>({id,role,name,items:0,...(entryChildName!==undefined?{entryChildName}:{})});
 const target=(identity:string,node:SimulatedSemanticNode,containers:VoiceOverContainer[]):VoiceOverSpeechTarget=>({identity,semantic:node,containers});
 function add(variant:string,body:string,targets:VoiceOverSpeechTarget[],trace:[string,string][]){
  const id='article-transfer-v1.'+variant;
  pages[variant]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Community request centre</title><style>body{font:17px system-ui;padding:14px}button,label{margin:5px}article,section,main,footer,[role=group]{padding:3px}p{margin:6px 0}h3{margin:8px 0}</style><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
  cases.push({id,page:'pages/'+variant+'.html',chords:trace.map(([,key])=>key),captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},axes:{family:'article-composition-transfer',role:'button-and-checkbox',partition:'test',exposure:'unseen',templateGroup:'article-transfer-v1.'+variant,siteGroup:'synthetic-article-transfer-v1',contrastGroup:'article-transfer-v1',command:'article-context-focus-return-and-state-change'}});
  const states=new Map(targets.map(t=>[t.identity,structuredClone(t)]));
  speechInputs[id]=trace.map(([identity,chord])=>{
   const node=states.get(identity)!,beforeTarget=structuredClone(node);
   if(chord==='Space')for(const key of ['checked','pressed','expanded'] as const)if(node.semantic[key]!==undefined)node.semantic[key]=node.semantic[key]!==true;
   return {target:structuredClone(node),command:chord==='Space'?'activate_form_control':chord==='Tab'?'next_focusable_item':'previous_focusable_item',...(chord==='Space'?{beforeTarget}:{})};
  });
 }
 const main=scope('desk','main'),region=scope('board','region','Public notices'),footer=scope('tail','contentinfo');
 const notice=(entry:string)=>scope('notice','article',browser==='safari'?'Neighbourhood digest':'',browser==='chrome'?entry:undefined),subscription=scope('subscription','article','Notification controls');
 add('civic-notices',`<main id="desk"><section id="board" aria-label="Public notices"><article id="notice"><h3>Neighbourhood digest</h3><div><button id="first">Inspect notice</button></div><button id="second">Flag notice</button></article><article id="subscription" aria-label="Notification controls"><label><input id="third" type="checkbox" checked>Weekly bulletin</label><button id="fourth">Save subscription</button></article><button id="fifth">Return to index</button></section></main><footer id="tail"><button id="sixth">Contact council</button></footer>`,[
  target('first',semantic('Inspect notice'),[main,region,notice('')]),target('second',semantic('Flag notice'),[main,region,notice('Flag notice')]),
  target('third',semantic('Weekly bulletin',{role:'checkbox',tagName:'input',inputType:'checkbox',checked:true}),[main,region,subscription]),target('fourth',semantic('Save subscription'),[main,region,subscription]),
  target('fifth',semantic('Return to index'),[main,region]),target('sixth',semantic('Contact council'),[footer]),target('before',semantic('Before marker'),[]),
 ],[['first','Tab'],['second','Tab'],['third','Tab'],['third','Space'],['fourth','Tab'],['fifth','Tab'],['sixth','Tab'],['fifth','Shift+Tab'],['fourth','Shift+Tab'],['third','Shift+Tab'],['third','Space'],['second','Shift+Tab'],['first','Shift+Tab'],['before','Shift+Tab'],['first','Tab'],['second','Tab']]);
 const request=scope('request','region','Archive request'),edition=scope('edition','article','Edition options'),delivery=scope('delivery','group','Delivery actions');
 const packageScope=(entry:string)=>scope('package','article','',entry);
 const toggle="this.setAttribute('aria-pressed',String(this.getAttribute('aria-pressed')!=='true'))";
 add('archive-cart',`<section id="request" aria-label="Archive request"><article id="package"><p>A lending option for registered readers.</p><article id="edition" aria-label="Edition options"><button id="first" aria-pressed="false" onclick="${toggle}">Reserve edition</button><button id="second">Preview edition</button></article><button id="third" aria-expanded="false" aria-controls="collection-notes" onclick="this.setAttribute('aria-expanded',String(this.getAttribute('aria-expanded')!=='true'));document.getElementById('collection-notes').hidden=this.getAttribute('aria-expanded')!=='true'">Show collection notes</button><p id="collection-notes" hidden>Collection closes at five.</p><button id="fourth">Submit reservation</button></article><div id="delivery" role="group" aria-label="Delivery actions"><button id="fifth">Print confirmation</button></div><button id="sixth">Return to catalogue</button></section>`,[
  target('first',semantic('Reserve edition',{pressed:false}),[request,packageScope('Edition options'),edition]),target('second',semantic('Preview edition'),[request,packageScope('Edition options'),edition]),
  target('third',semantic('Show collection notes',{expanded:false}),[request,packageScope('Show collection notes')]),target('fourth',semantic('Submit reservation'),[request,packageScope('Submit reservation')]),
  target('fifth',semantic('Print confirmation'),[request,delivery]),target('sixth',semantic('Return to catalogue'),[request]),
 ],[['first','Tab'],['first','Space'],['second','Tab'],['third','Tab'],['third','Space'],['fourth','Tab'],['third','Shift+Tab'],['third','Space'],['second','Shift+Tab'],['first','Shift+Tab'],['first','Space'],['second','Tab'],['third','Tab'],['fourth','Tab'],['fifth','Tab'],['sixth','Tab'],['fifth','Shift+Tab'],['fourth','Shift+Tab']]);
 return {pages,cases,speechInputs};
}
