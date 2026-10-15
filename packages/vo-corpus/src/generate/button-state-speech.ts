import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,SimulatedSemanticNode} from 'rawstep/mock-voiceover';

/** Same button and handler; vary only pressed/expanded attributes, then activate and return. */
export function generateButtonStateSpeech(){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,VoiceOverSpeechInput[]>={};
 const semantic=(name:string,extra:Partial<SimulatedSemanticNode>={}):SimulatedSemanticNode=>({role:'button',name,tagName:'button',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false,...extra});
 const conditions:{id:string;pressed?:boolean|'mixed';expanded?:boolean}[]=[{id:'plain'},{id:'toggle',pressed:false},{id:'mixed-toggle',pressed:'mixed'},{id:'disclosure',expanded:false},{id:'toggle-disclosure',pressed:false,expanded:false}];
 for(const condition of conditions){
  const {id:variant,...initial}=condition,id=`button-state-speech-v1.${variant}`;
  const attributes=[initial.pressed!==undefined?` aria-pressed="${initial.pressed}"`:'',initial.expanded!==undefined?` aria-expanded="${initial.expanded}"`:''].join('');
  pages[variant]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Catalog filter preferences</title><style>body{font:18px system-ui;padding:24px}button{display:block;margin:18px}</style><body><button id="before" autofocus>Before marker</button><button id="target"${attributes} onclick="this.dataset.activations=String(Number(this.dataset.activations||0)+1);for(const attribute of ['aria-pressed','aria-expanded'])if(this.hasAttribute(attribute))this.setAttribute(attribute,String(this.getAttribute(attribute)!=='true'))">Catalog filters</button><button id="after">After marker</button></body></html>`;
  cases.push({id,page:`pages/${variant}.html`,chords:['Tab','Space','Tab','Shift+Tab','Space'],captureAxAfterSteps:true,listen:{minWaitMs:2000,quietMs:1200,maxWaitMs:7500},axes:{family:'button-state-speech',role:'button',pressed:String(initial.pressed??'absent'),expanded:String(initial.expanded??'absent'),command:'physical-Space-and-return',templateGroup:'button-state-speech-v1',contrastGroup:'button-state-speech-v1',siteGroup:'synthetic-button-state-speech-v1',partition:'train',exposure:'calibration'}});
  const state={...initial};
  const target=(command:string):VoiceOverSpeechInput=>({target:{identity:'target',containers:[],semantic:semantic('Catalog filters',{...state})},command});
  const activate=()=>{if(state.pressed!==undefined)state.pressed=state.pressed!==true;if(state.expanded!==undefined)state.expanded=!state.expanded;return target('activate_form_control');};
  speechInputs[id]=[target('next_focusable_item'),activate(),{target:{identity:'after',containers:[],semantic:semantic('After marker')},command:'next_focusable_item'},target('previous_focusable_item'),activate()];
 }
 return {pages,cases,speechInputs};
}
