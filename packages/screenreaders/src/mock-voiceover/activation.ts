import {formatVoiceOverSpeech,type VoiceOverSpeechInput,type VoiceOverSpeechTarget,type VoiceOverSpeechContext} from './speech.js';
import {formatSimulatedSpeech} from './semantics.js';

export type VoiceOverActivationInput = Pick<VoiceOverSpeechInput,'command'|'referenceBrowser'> & {
  /** Independently observed targets before and after an action already performed by Rawstep. */
  beforeTarget?:VoiceOverSpeechTarget;target:VoiceOverSpeechTarget;
};
export type VoiceOverActivationResult = ({
  status:'modeled';utterances:string[];context:VoiceOverSpeechContext;
} | {status:'unsupported';reason:string;context:VoiceOverSpeechContext}) & {
  evidenceProvenance:'simulation';nativeParityEstablished:false;
};

/** Ordered receipt candidates for measured activation events, without executing actions or scheduling speech. */
export function formatVoiceOverActivation(input:VoiceOverActivationInput,previous:VoiceOverSpeechContext={containers:[]}):VoiceOverActivationResult{
  const context=structuredClone(previous),browser=input.referenceBrowser??'safari',before=input.beforeTarget,after=input.target;
  const provenance={evidenceProvenance:'simulation' as const,nativeParityEstablished:false as const};
  if(browser!=='safari'&&browser!=='chrome')throw new Error('Reference browser must be safari or chrome');
  const unsupported=(reason:string):VoiceOverActivationResult=>({...provenance,status:'unsupported',reason,context});
  if(!['activate_form_control','activate_button'].includes(input.command))return unsupported('Command is not a measured activation');
  if(!before)return unsupported('Before target is unmeasured');
  const a=before.semantic,b=after.semantic;
  if(before.identity!==after.identity||a.role!==b.role||a.name!==b.name)return unsupported('Activation target changed');
  if(a.protected||b.protected||a.disabled||b.disabled)return unsupported('Protected or disabled activation is not modeled');
  const changedExcept=(keys:string[])=>[...new Set([...Object.keys(a),...Object.keys(b)])].some(key=>!keys.includes(key)&&JSON.stringify(a[key as keyof typeof a])!==JSON.stringify(b[key as keyof typeof b]));
  if(b.role==='checkbox'){
    if(typeof a.checked!=='boolean'||typeof b.checked!=='boolean'||a.checked===b.checked||changedExcept(['checked']))return unsupported('Checkbox event needs an isolated boolean checked transition');
    const formatted=formatVoiceOverSpeech({target:after,command:input.command,referenceBrowser:browser,checkedStateChanged:true},previous);
    return {...provenance,status:'modeled',utterances:[formatted.speech],context:formatted.context};
  }
  if(b.role!=='button'||a.tagName!=='button'||b.tagName!=='button'||input.command!=='activate_form_control')return unsupported('Only physical Space on native buttons and changed checkboxes is modeled');
  if([a,b].some(n=>n.pressed!==undefined&&typeof n.pressed!=='boolean'&&n.pressed!=='mixed'||n.expanded!==undefined&&typeof n.expanded!=='boolean'))return unsupported('Button states are not observed boolean/mixed values');
  if(changedExcept(['pressed','expanded']))return unsupported('Other button semantics changed');
  if((a.pressed===undefined)!==(b.pressed===undefined)||(a.expanded===undefined)!==(b.expanded===undefined))return unsupported('Button state attributes appeared or disappeared');
  const pressedChanged=a.pressed!==b.pressed,expandedChanged=a.expanded!==b.expanded;
  if(pressedChanged&&typeof b.pressed!=='boolean')return unsupported('Transition to mixed pressed state is unmeasured');
  const utterances:string[]=[];
  // Chrome emits a pressed-value receipt; Safari does not. Expansion independently emits two object receipts.
  if(browser==='chrome'&&pressedChanged){
    const object=formatSimulatedSpeech({...b,pressed:false},false,input.command,' ');
    utterances.push([b.pressed?'selected':'',object].filter(Boolean).join(' '));
  }
  if(expandedChanged){
    const object=formatSimulatedSpeech(b,false,input.command,' ');
    utterances.push(object,object);
  }
  return {...provenance,status:'modeled',utterances,context};
}
