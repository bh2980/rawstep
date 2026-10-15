import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,SimulatedSemanticNode} from 'rawstep/mock-voiceover';

/** Controlled native/custom × inline-description × physical/VO activation contrasts. */
export function generateCheckboxSpeech(){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,VoiceOverSpeechInput[]>={};
 const semantic=(name:string,extra:Partial<SimulatedSemanticNode>={}):SimulatedSemanticNode=>({role:'button',name,protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false,...extra});
 for(const custom of [false,true])for(const described of [false,true])for(const gesture of ['Space','VO+Space']){
  const variant=`${custom?'aria':'native'}-${described?'description':'plain'}-${gesture==='Space'?'physical':'vo'}`,id=`checkbox-speech-v1.${variant}`;
  const description=described?' aria-describedby="detail"':'';
  const attributes=`id="target" aria-labelledby="label"${description}`;
  const target=custom?`<div ${attributes} role="checkbox" tabindex="0" aria-checked="false" onclick="this.setAttribute('aria-checked',String(this.getAttribute('aria-checked')!=='true'))" onkeydown="if(event.key===' ')event.preventDefault()" onkeyup="if(event.key===' '){event.preventDefault();this.click()}"></div>`:`<input ${attributes} type="checkbox">`;
  pages[variant]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Backup notification preferences</title><style>body{font:18px system-ui;padding:24px}button{display:block;margin:16px}input,[role=checkbox]{display:inline-block;width:24px;height:24px;border:2px solid #555;margin:12px;vertical-align:middle}[role=checkbox][aria-checked=true]{background:#174}</style><body><button id="before" autofocus>Before marker</button>${target}<span id="label">Backup reminders</span><p id="detail" hidden>Sent once a week, when enabled.</p><button id="after">After marker</button></body></html>`;
  const chords=['Tab',gesture,'Tab','Shift+Tab',gesture];
  cases.push({id,page:`pages/${variant}.html`,chords,captureAxAfterSteps:true,listen:{minWaitMs:1800,quietMs:1200,maxWaitMs:7000},axes:{family:'checkbox-speech-contrast',role:'checkbox',implementation:custom?'aria':'native',description:described?'inline':'none',command:gesture,templateGroup:'checkbox-speech-v1',contrastGroup:'checkbox-speech-v1',siteGroup:'synthetic-checkbox-speech-v1',partition:'train',exposure:'calibration'}});
  const input=(checked:boolean,command:string,changed=false):VoiceOverSpeechInput=>({target:{identity:'target',containers:[],semantic:semantic('Backup reminders',{role:'checkbox',tagName:custom?'div':'input',...(!custom?{inputType:'checkbox'}:{}),checked,...(described?{description:'Sent once a week, when enabled.',hasMoreContent:true}:{})})},command,...(changed?{checkedStateChanged:true}:{})});
  const activate=gesture==='Space'?'activate_form_control':'activate_button';
  speechInputs[id]=[input(false,'next_focusable_item'),input(true,activate,true),{target:{identity:'after',semantic:semantic('After marker'),containers:[]},command:'next_focusable_item'},input(true,'previous_focusable_item'),input(false,activate,true)];
 }
 return {pages,cases,speechInputs};
}
