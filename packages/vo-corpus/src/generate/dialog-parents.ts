import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,VoiceOverContainer} from 'rawstep/mock-voiceover';

/** Controlled parent-role contrasts motivated by the inspected dialog transfer failures. */
export function generateDialogParents(){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,VoiceOverSpeechInput[]>={};
 for(const variant of [{id:'anonymous',tag:'div',role:undefined,name:''},{id:'main',tag:'main',role:'main',name:''},{id:'region',tag:'section',role:'region',name:'Review section'},{id:'group',tag:'div',role:'group',name:'Review section'}]){
  const id='dialog-parent-context-v1.'+variant.id,chords=['Tab','Tab','Tab','Shift+Tab','Shift+Tab','Shift+Tab'];
  pages[variant.id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Review preferences</title><style>body{font:17px system-ui;padding:16px}button{margin:5px}h3,p{margin:6px 0}</style><body><button id="before" autofocus>Before marker</button><${variant.tag} id="outer"${variant.role==='group'?' role="group"':''}${variant.name?` aria-label="${variant.name}"`:''}><div id="panel" role="dialog" aria-label="Review controls"><h3>Review choices</h3><p>Select items to keep.</p><button id="first">Keep note</button><button id="second">Clear note</button></div></${variant.tag}><button id="after">After marker</button></body></html>`;
  cases.push({id,page:'pages/'+variant.id+'.html',chords,captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},axes:{family:'dialog-parent-context-calibration',role:'button',partition:'train',exposure:'calibration',templateGroup:'dialog-parent-context-v1',contrastGroup:'dialog-parent-context-v1',command:'Tab-entry-exit-reentry',parentRole:variant.role??'anonymous'}});
  speechInputs[id]=['first','second','after','second','first','before'].map((identity,i)=>{
   const outer:VoiceOverContainer[]=variant.role?[{id:'outer',role:variant.role,name:variant.name,items:0}]:[];
   return {command:chords[i]==='Tab'?'next_focusable_item':'previous_focusable_item',target:{identity,semantic:{role:'button',tagName:'button',name:identity==='first'?'Keep note':identity==='second'?'Clear note':identity==='after'?'After marker':'Before marker',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false},containers:['first','second'].includes(identity)?[...outer,{id:'panel',role:'dialog',name:'Review controls',items:4,firstChildName:'Review choices'}]:[]}};
  });
 }
 return {pages,cases,speechInputs};
}
