import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,VoiceOverSpeechTarget} from 'rawstep/mock-voiceover';

/** Calibration of nonmodal dialog entry, within-dialog returns and exposed child counts. */
export function generateDialogSpeech(){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,VoiceOverSpeechInput[]>={};
 const variants=[{id:'named-direct',name:'Dispatch options',items:4},{id:'named-wrapped',name:'Dispatch options',items:3,wrapped:true},{id:'unnamed-direct',name:'',items:4},{id:'native-open',name:'Dispatch options',items:4,native:true},{id:'singleton',name:'Dispatch options',items:1,single:true}];
 for(const variant of variants){
  const id='dialog-speech-v1.'+variant.id,tag=variant.native?'dialog':'div';
  const heading=variant.single?'':'<h2>Dispatch panel</h2><p>Invoices are kept for thirty days.</p>',buttons='<button id="first">Review dispatch</button>'+(variant.single?'':'<button id="second">Keep draft</button>');
  pages[variant.id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Dispatch settings</title><style>body{font:17px system-ui;padding:18px}button{margin:5px}h2,p{margin:6px 0}#panel{padding:8px;border:1px solid #777}</style><body><button id="before" autofocus>Before marker</button><${tag} id="panel" ${variant.native?'open':'role="dialog"'}${variant.name?` aria-label="${variant.name}"`:''}>${heading}${variant.wrapped?'<div>':''}${buttons}${variant.wrapped?'</div>':''}</${tag}><button id="after">After marker</button></body></html>`;
  const trace=variant.single?[['first','Tab'],['after','Tab'],['first','Shift+Tab'],['before','Shift+Tab'],['first','Tab']]:[['first','Tab'],['second','Tab'],['after','Tab'],['second','Shift+Tab'],['first','Shift+Tab'],['before','Shift+Tab']];
  cases.push({id,page:'pages/'+variant.id+'.html',chords:trace.map(([,key])=>key!),captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},axes:{family:'nonmodal-dialog-speech',role:'button',partition:'train',exposure:'calibration',templateGroup:'dialog-speech-v1',contrastGroup:'dialog-speech-v1',command:'focus-entry-within-exit-return'}});
  speechInputs[id]=trace.map(([identity,chord])=>{
   const target:VoiceOverSpeechTarget={identity:identity!,semantic:{role:'button',tagName:'button',name:identity==='first'?'Review dispatch':identity==='second'?'Keep draft':identity==='before'?'Before marker':'After marker',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false},containers:['first','second'].includes(identity!)?[{id:'panel',role:'dialog',name:variant.name,items:variant.items}]:[]};
   return {target,command:chord==='Tab'?'next_focusable_item':'previous_focusable_item'};
  });
 }
 return {pages,cases,speechInputs};
}
