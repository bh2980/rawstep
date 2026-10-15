import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,VoiceOverSpeechTarget,VoiceOverContainer,SimulatedSemanticNode} from 'rawstep/mock-voiceover';

/** Caller-owned speech inputs; no native receipt or predicted string participates in fixture construction. */
export function generateSpeechContexts(){
  const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,VoiceOverSpeechInput[]>={};
  const chords=['Tab','Tab','Tab','Shift+Tab','Tab','Tab','Shift+Tab','Shift+Tab','Tab','Shift+Tab'];
  const targets=['first','second','third','second','third','fourth','third','second','third','second'];
  const semantic=(name:string,extra:Partial<SimulatedSemanticNode>={}):SimulatedSemanticNode=>({role:'button',name,protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,...extra});
  const scope=(id:string,role:string,name:string,extra:Partial<VoiceOverContainer>={}):VoiceOverContainer=>({id,role,name,items:4,...extra});
  const target=(identity:string,name:string,containers:VoiceOverContainer[],extra:Partial<VoiceOverSpeechTarget>={}):VoiceOverSpeechTarget=>({identity,semantic:semantic(name),containers,...extra});
  function add(id:string,body:string,nodes:VoiceOverSpeechTarget[],pair:string){
    pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Workspace preferences</title><style>body{font:16px system-ui;padding:8px}main,section,form,fieldset,article,div[role=group]{padding:5px;margin:4px;border:1px solid #aaa}button,label{display:block;margin:6px}td,th{padding:5px}</style><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
    const caseId=`speech-contexts-v1.${id}`;
    cases.push({id:caseId,page:`pages/${id}.html`,chords:[...chords],captureAxAfterSteps:true,listen:{minWaitMs:1200,quietMs:900,maxWaitMs:6000},axes:{family:'speech-context-composition',role:'button-and-checkbox',partition:'test',exposure:'unseen',templateGroup:`speech-contexts-v1.${pair}`,contrastGroup:`speech-contexts-v1.${pair}`,siteGroup:'synthetic-speech-contexts-v1',command:'caller-owned-focus-targets'}});
    speechInputs[caseId]=targets.map((id,i)=>({target:structuredClone(nodes.find(n=>n.identity===id)!),command:chords[i]==='Tab'?'next_focusable_item':'previous_focusable_item'}));
  }
  for(const grouped of [false,true]){
    const main=scope('workspace','main','Workspace console'),bookings=scope('bookings','region','Booking tools'),payments=scope('payments','region','Payment tools'),group=scope('delivery','group','Delivery actions',{items:2});
    const controls='<button id="first">Prepare booking</button><button id="second">Check booking</button>';
    add(`sibling-regions-${grouped?'group':'flat'}`,`<main aria-label="Workspace console"><section aria-label="Booking tools"><div${grouped?' role="group" aria-label="Delivery actions"':''}>${controls}</div></section><section aria-label="Payment tools"><button id="third">Review invoice</button></section><button id="fourth">Close workspace</button></main>`,[
      target('first','Prepare booking',[main,bookings,...(grouped?[group]:[])]),target('second','Check booking',[main,bookings,...(grouped?[group]:[])]),target('third','Review invoice',[main,payments]),target('fourth','Close workspace',[main]),
    ],'sibling-regions');
  }
  for(const fieldset of [true,false]){
    const region=scope('security','region','Account security'),form=scope('access','form','Access settings'),group=scope('choices','group','Delivery choices',{items:2});
    const controls='<label><input id="first" type="checkbox">Email receipts</label><label><input id="second" type="checkbox" checked>Printed receipts</label>';
    add(`nested-form-${fieldset?'fieldset':'aria-group'}`,`<section aria-label="Account security"><form aria-label="Access settings">${fieldset?`<fieldset><legend>Delivery choices</legend>${controls}</fieldset>`:`<div role="group" aria-label="Delivery choices">${controls}</div>`}<button id="third" type="button">Save delivery choices</button></form><button id="fourth">Close security panel</button></section>`,[
      target('first','Email receipts',[region,form,group],{semantic:semantic('Email receipts',{role:'checkbox',tagName:'input',inputType:'checkbox',checked:false})}),target('second','Printed receipts',[region,form,group],{semantic:semantic('Printed receipts',{role:'checkbox',tagName:'input',inputType:'checkbox',checked:true})}),target('third','Save delivery choices',[region,form]),target('fourth','Close security panel',[region]),
    ],'nested-form');
  }
  for(const columns of [2,3]){
    const region=scope('planner','region','Resource planner'),article=scope('loan','article','Loan request'),table=scope('slots','table','Equipment slots',{rows:3,columns});
    add(`nested-table-${columns}-columns`,`<section aria-label="Resource planner"><article aria-label="Loan request"><table><caption>Equipment slots</caption><tr><th>Item</th>${columns===3?'<th>Slot</th>':''}<th>Action</th></tr><tr><td>Camera</td>${columns===3?'<td>Morning</td>':''}<td><button id="first">Reserve camera</button></td></tr><tr><td>Tripod</td>${columns===3?'<td>Afternoon</td>':''}<td><button id="second">Reserve tripod</button></td></tr></table><button id="third">Submit loan request</button></article><button id="fourth">Close resource planner</button></section>`,[
      ...['Reserve camera','Reserve tripod'].map((name,i)=>target(i?'second':'first',name,[region,article,table],{cell:{table:'slots',row:i+1,column:columns-1,rows:3,columns,header:'Action',rowSpan:1,columnSpan:1}})),target('third','Submit loan request',[region,article]),target('fourth','Close resource planner',[region]),
    ],'nested-table');
  }
  return {pages,cases,speechInputs};
}
