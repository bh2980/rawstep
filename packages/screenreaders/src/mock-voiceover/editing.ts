import type {VoiceOverSpeechInput,VoiceOverSpeechContext,VoiceOverEditState} from './speech.js';

export type VoiceOverEditingInput=Pick<VoiceOverSpeechInput,'target'|'command'|'referenceBrowser'>&{
  /** Before/after observations of an action already performed by the caller; offsets use UTF-16. */
  before?:VoiceOverEditState;after:VoiceOverEditState;
  beforeFocus?:string;focus?:string;text?:string;
};
export type VoiceOverEditingResult=({status:'approximation';utterances:string[]}|{status:'unsupported';reason:string})&{
  context:VoiceOverSpeechContext;evidenceProvenance:'simulation';nativeParityEstablished:false;
};

/** Existing editing receipt candidates, independent of DOM actions, focus movement and speech scheduling. */
export function formatVoiceOverEditing(input:VoiceOverEditingInput,previous:VoiceOverSpeechContext={containers:[]}):VoiceOverEditingResult{
  const {target,command,before,after}=input,context=structuredClone(previous),browser=input.referenceBrowser??'safari';
  if(browser!=='safari'&&browser!=='chrome')throw new Error('Reference browser must be safari or chrome');
  const provenance={context,evidenceProvenance:'simulation' as const,nativeParityEstablished:false as const};
  const unsupported=(reason:string):VoiceOverEditingResult=>({...provenance,status:'unsupported',reason});
  if(target.semantic.protected)return unsupported('Protected editing is not modeled');
  if(!['textbox','searchbox','spinbutton','combobox'].includes(target.semantic.role))return unsupported('Target is not an editable field');
  if(input.focus!==target.identity||input.beforeFocus!==input.focus)return unsupported('Stable editing focus is unmeasured');
  const valid=(s:VoiceOverEditState|undefined):s is VoiceOverEditState=>!!s&&typeof s.value==='string'&&typeof s.multiline==='boolean'&&Number.isSafeInteger(s.start)&&Number.isSafeInteger(s.end)&&s.start>=0&&s.end>=s.start&&s.end<=s.value.length;
  if(!before||!valid(before)||!valid(after)||before.multiline!==after.multiline)return unsupported('Before/after edit values or ranges are unmeasured');
  const utterances:string[]=[],emit=(text:string)=>{if(text)utterances.push(text);};
  if(command==='enter_text'&&input.text?.length===1){
    if(before.end>before.start)emit(`selection replaced ${input.text}`);
    else{emit(input.text);emit(after.value.slice(0,after.start).split(/\s/).at(-1)??'');}
  }else if(command==='ControlOrMeta+A'){
    emit('Select All');const selected=after.value.slice(after.start,after.end);if(selected)emit(`${selected} selected`);
  }else if(['Shift+Home','Shift+End'].includes(command)){
    const selected=after.value.slice(after.start,after.end);if(selected)emit(`${selected} selected`);
  }else if(command==='Home'||command==='End'){
    // Existing receipt candidate is silence; no Native queue-completion claim.
  }else if(command==='ArrowLeft'||command==='ArrowRight'){
    const index=before.end>before.start?command==='ArrowRight'?before.end-1:before.start:command==='ArrowLeft'?before.start-1:before.start;
    emit(before.value[index]??'');
  }else if(command==='Backspace'||command==='Delete'){
    const removed=before.end>before.start?before.value.slice(before.start,before.end):before.value[command==='Backspace'?before.start-1:before.start]??'';
    if(removed==='\n'&&after.multiline){
      const word=after.value.slice(0,after.start).split(/\s/).at(-1)!+after.value.slice(after.start).split(/\s/)[0];
      emit(`${target.semantic.name} text entry area ${after.value} Insertion on word: ${word} , between characters: ${after.value[after.start-1]??''} and ${after.value[after.start]??''}`);
    }else emit(removed);
  }else if(command==='Enter'&&after.multiline){emit('new line');emit(before.value.slice(0,before.start).split('\n').at(-1)??'');}
  else return unsupported('Editing command is outside the existing receipt rules; focus entry uses the reading formatter');
  return {...provenance,status:'approximation',utterances};
}
