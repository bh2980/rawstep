import type {Case} from '../cases.js';
import type {VoiceOverSpeechInput,VoiceOverContainer,SimulatedSemanticNode} from 'rawstep/mock-voiceover';

/** Minimal real-page reduction: preserve Native-exposed landmark role even when its name is empty. */
export function generateLandmarkSpeech(){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,VoiceOverSpeechInput[]>={};
 const conditions=[{role:'banner',tag:'header',name:''},{role:'banner',tag:'header',name:'Site gateway'},{role:'navigation',tag:'nav',name:''},{role:'main',tag:'main',name:''},{role:'complementary',tag:'aside',name:''},{role:'contentinfo',tag:'footer',name:''}];
 const semantic=(name:string):SimulatedSemanticNode=>({role:'button',name,tagName:'button',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false});
 for(const c of conditions){
  const variant=c.role+(c.name?'-named':'-unnamed'),id='landmark-speech-v1.'+variant;
  pages[variant]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Library request workspace</title><style>body{font:18px system-ui;padding:24px}button{display:block;margin:16px}</style><body><button id="before" autofocus>Before marker</button><${c.tag} id="landmark"${c.name?' aria-label="'+c.name+'"':''}><button id="first">Open catalog</button><button id="second">Review request</button></${c.tag}><button id="outside">Outside area</button><button id="after">After marker</button></body></html>`;
  const chords=['Tab','Tab','Tab','Shift+Tab','Shift+Tab'];
  cases.push({id,page:'pages/'+variant+'.html',chords,captureAxAfterSteps:true,listen:{minWaitMs:2000,quietMs:1200,maxWaitMs:7500},axes:{family:'landmark-speech',role:c.role,name:c.name?'named':'unnamed',command:'Tab-entry-within-exit-reentry',templateGroup:'landmark-speech-v1',contrastGroup:'landmark-speech-v1',siteGroup:'synthetic-landmark-speech-v1',partition:'train',exposure:'calibration'}});
  const container:VoiceOverContainer={id:'landmark',role:c.role,name:c.name,items:2};
  speechInputs[id]=['first','second','outside','second','first'].map((identity,step)=>({target:{identity,semantic:semantic(identity==='first'?'Open catalog':identity==='second'?'Review request':'Outside area'),containers:identity==='outside'?[]:[container]},command:step<3?'next_focusable_item':'previous_focusable_item'}));
 }
 return {pages,cases,speechInputs};
}
