import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,VoiceOverActivationInput,VoiceOverSpeechTarget,SimulatedSemanticNode,VoiceOverContainer} from 'rawstep/mock-voiceover';

/** Unseen compositions: caller-owned targets, never derived from a Native or model utterance. */
export function generateLandmarkTransfer(){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,(VoiceOverSpeechInput&Partial<Pick<VoiceOverActivationInput,'beforeTarget'>>)[]>={};
 const semantic=(name:string,extra:Partial<SimulatedSemanticNode>={}):SimulatedSemanticNode=>({role:'button',tagName:'button',name,protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false,...extra});
 const scope=(id:string,role:string,name='',items=0):VoiceOverContainer=>({id,role,name,items});
 const target=(identity:string,node:SimulatedSemanticNode,containers:VoiceOverContainer[]):VoiceOverSpeechTarget=>({identity,semantic:node,containers});
 const toggle="this.setAttribute('aria-pressed',String(this.getAttribute('aria-pressed')!=='true'))";
 function add(variant:string,body:string,targets:VoiceOverSpeechTarget[],script:[string,string][]){
  const id='landmark-transfer-v1.'+variant;
  pages[variant]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Community workspace options</title><style>body{font:17px system-ui;padding:18px}button,label{display:block;margin:10px}button{padding:6px}header,main,aside,footer,nav,section,[role=group]{padding:4px}img{width:22px;height:22px}#pickup-panel{margin:4px}</style><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
  cases.push({id,page:'pages/'+variant+'.html',chords:script.map(([,key])=>key),captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},axes:{family:'landmark-state-composition-transfer',role:'button-and-checkbox',templateGroup:'landmark-transfer-v1.'+variant,siteGroup:'synthetic-landmark-transfer-v1',contrastGroup:'landmark-transfer-v1',partition:'test',exposure:'unseen',command:'focus-return-and-state-change'}});
  const states=new Map(targets.map(t=>[t.identity,structuredClone(t)]));
  speechInputs[id]=script.map(([identity,chord])=>{
   const node=states.get(identity)!,beforeTarget=structuredClone(node);
   if(chord==='Space')for(const key of ['checked','pressed','expanded'] as const)if(node.semantic[key]!==undefined)node.semantic[key]=node.semantic[key]!==true;
   return {target:structuredClone(node),command:chord==='Space'?'activate_form_control':chord==='Tab'?'next_focusable_item':'previous_focusable_item',...(chord==='Space'?{beforeTarget}:{})};
  });
 }
 const banner=scope('masthead','banner'),nav=scope('tools','navigation','Journal controls'),main=scope('body','main'),region=scope('options','region','Reading options'),footer=scope('tail','contentinfo');
 add('journal-reader',`<header id="masthead"><nav id="tools" aria-label="Journal controls"><button id="first" aria-description="Keeps this edition available offline."><img alt="Journal home" src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2020%2020'%3E%3Crect%20width='20'%20height='20'%20fill='navy'/%3E%3C/svg%3E"></button><button id="second" aria-pressed="false" onclick="${toggle}">Follow updates</button></nav><button id="third" title="Review recent editions, before leaving.">Recent editions</button></header><main id="body"><section id="options" aria-label="Reading options"><label><input id="fourth" type="checkbox" checked aria-describedby="compact-note">Compact view</label><p id="compact-note" hidden>Reduces spacing, while preserving all content.</p></section><button id="fifth">Apply layout</button></main><footer id="tail"><button id="sixth">Contact desk</button></footer>`,[
  target('first',semantic('Journal home',{description:'Keeps this edition available offline.',hasMoreContent:true}),[banner,nav]),
  target('second',semantic('Follow updates',{pressed:false}),[banner,nav]),
  target('third',semantic('Recent editions',{help:'Review recent editions, before leaving.'}),[banner]),
  target('fourth',semantic('Compact view',{role:'checkbox',tagName:'input',inputType:'checkbox',checked:true,description:'Reduces spacing, while preserving all content.',hasMoreContent:true}),[main,region]),
  target('fifth',semantic('Apply layout'),[main]),target('sixth',semantic('Contact desk'),[footer]),
 ],[['first','Tab'],['second','Tab'],['second','Space'],['third','Tab'],['fourth','Tab'],['fourth','Space'],['fifth','Tab'],['sixth','Tab'],['fifth','Shift+Tab'],['fourth','Shift+Tab'],['fourth','Space'],['third','Shift+Tab'],['second','Shift+Tab'],['second','Space'],['third','Tab']]);
 const workspace=scope('workspace','main'),aside=scope('filter','complementary'),group=scope('cluster','group','Reservation controls'),tail=scope('closure','contentinfo','Reservation footer');
 add('reservation-desk',`<main id="workspace"><button id="first" title="Check the remaining collection times.">Open timetable</button><aside id="filter"><div id="cluster" role="group" aria-label="Reservation controls"><label><input id="second" type="checkbox">Notify on release</label><button id="third" aria-expanded="false" aria-controls="pickup-panel" onclick="this.setAttribute('aria-expanded',String(this.getAttribute('aria-expanded')!=='true'));document.getElementById('pickup-panel').hidden=this.getAttribute('aria-expanded')!=='true'">Show pickup details</button><p id="pickup-panel" hidden>Pickup is available at the west entrance.</p></div><button id="fourth" aria-pressed="mixed" onclick="${toggle}">Keep reservation</button></aside><button id="fifth" aria-description="Stores a local copy of this request.">Send request</button></main><footer id="closure" aria-label="Reservation footer"><button id="sixth">Review terms</button></footer>`,[
  target('first',semantic('Open timetable',{help:'Check the remaining collection times.'}),[workspace]),
  target('second',semantic('Notify on release',{role:'checkbox',tagName:'input',inputType:'checkbox',checked:false}),[workspace,aside,group]),
  target('third',semantic('Show pickup details',{expanded:false}),[workspace,aside,group]),
  target('fourth',semantic('Keep reservation',{pressed:'mixed'}),[workspace,aside]),
  target('fifth',semantic('Send request',{description:'Stores a local copy of this request.',hasMoreContent:true}),[workspace]),target('sixth',semantic('Review terms'),[tail]),
 ],[['first','Tab'],['second','Tab'],['second','Space'],['third','Tab'],['third','Space'],['fourth','Tab'],['fourth','Space'],['third','Shift+Tab'],['third','Space'],['fourth','Tab'],['fourth','Space'],['fifth','Tab'],['sixth','Tab'],['fifth','Shift+Tab'],['fourth','Shift+Tab'],['third','Shift+Tab'],['fourth','Tab']]);
 return {pages,cases,speechInputs};
}
