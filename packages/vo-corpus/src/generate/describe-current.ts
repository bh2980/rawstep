import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,SimulatedSemanticNode} from 'rawstep/mock-voiceover';
import {generateButtonStateSpeech} from './button-state-speech.js';
import {generateCheckboxSpeech} from './checkbox-speech.js';

/** Protocol calibration: known targets first, then VO+F3 without moving the cursor. */
export function generateDescribeCurrent(){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,VoiceOverSpeechInput[]>={};
 const add=(variant:string,html:string,entry:VoiceOverSpeechInput,sourceGroup:string)=>{
  const id=`describe-current-v1.${variant}`,chord=entry.command==='next_item'?'VO+Right':'Tab';
  pages[variant]=html;cases.push({id,page:`pages/${variant}.html`,chords:[chord,'VO+F3'],captureAxAfterSteps:true,listen:{minWaitMs:2200,quietMs:1200,maxWaitMs:8500},axes:{family:'describe-current-calibration',role:entry.target.semantic.role,command:'entry-then-describe-current',templateGroup:sourceGroup,contrastGroup:'describe-current-v1',siteGroup:'synthetic-describe-current-v1',partition:'train',exposure:'calibration'}});
  speechInputs[id]=[structuredClone(entry),{...structuredClone(entry),command:'read_current'}];
 };
 const buttons=generateButtonStateSpeech();
 for(const variant of ['plain','toggle','mixed-toggle','disclosure'])add(variant,buttons.pages[variant]!,buttons.speechInputs[`button-state-speech-v1.${variant}`]![0]!,'button-state-speech-v1');
 const checkbox=generateCheckboxSpeech();
 add('described-checkbox',checkbox.pages['native-description-physical']!,checkbox.speechInputs['checkbox-speech-v1.native-description-physical']![0]!,'checkbox-speech-v1');
 const described=structuredClone(buttons.speechInputs['button-state-speech-v1.toggle']![0]!);
 Object.assign(described.target.semantic,{description:'Saved locally, for this account.',hasMoreContent:true});
 add('described-toggle',buttons.pages.toggle!.replace('id="target"','id="target" aria-describedby="detail"').replace('</body>','<p id="detail" hidden>Saved locally, for this account.</p></body>'),described,'button-state-speech-v1');
 for(const role of ['link','heading']){
  const name=role==='link'?'Reference details':'Current checkpoint';
  const body=role==='link'?`<a id="target" href="#destination">${name}</a>`:`<h2 id="target">${name}</h2>`;
  const semantic:SimulatedSemanticNode={role,name,tagName:role==='link'?'a':'h2',...(role==='heading'?{level:2}:{}),protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false};
  add(role,`<!doctype html><html lang="en"><meta charset="utf-8"><title>Current item description</title><style>body{font:18px system-ui;padding:24px}button,a,h2{display:block;margin:18px}</style><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`,{target:{identity:'target',semantic,containers:[]},command:'next_item'},'describe-current-v1.link-heading');
 }
 return {pages,cases,speechInputs};
}
