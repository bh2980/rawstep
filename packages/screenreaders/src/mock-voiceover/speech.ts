import {formatSimulatedSpeech, type SimulatedSemanticNode} from './semantics.js';
import {formatUsageHint} from './usage-hints.js';

// Recognized caller contexts, not a claim of Native coverage for every target/command combination.
const speechCommands=new Set([
  'next_item','previous_item','next_focusable_item','previous_focusable_item','next_heading','previous_heading',
  'next_form_control','read_current','read_focused','activate_button','activate_form_control','enter','escape','enter_text',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Shift+Home','Shift+End','Backspace','Delete','ControlOrMeta+A',
]);

/** Keep Native-exposed landmark roles even when their accessible name is empty. */
export type VoiceOverContainer = {id:string;name:string;inferredName?:boolean;/** Native exposed first-child name, used for an unnamed dialog summary. */ firstChildName?:string;/** Name of the immediate exposed AX child on the path to the target; empty is meaningful. */ entryChildName?:string;role:string;items:number;rows?:number;columns?:number};
export type VoiceOverCell = {table:string;row:number;column:number;rows:number;columns:number;header:string;rowSpan:number;columnSpan:number};
export type VoiceOverEditState = {value:string;start:number;end:number;multiline:boolean};
export type VoiceOverSpeechTarget = {
  identity:string;axId?:string;semantic:SimulatedSemanticNode;end?:boolean;
  /** Outer to inner; IDs only need to be stable within this document/session. */
  containers?:readonly VoiceOverContainer[];cell?:VoiceOverCell;hintInCell?:boolean;hintTextFragment?:boolean;
};
/** The speech history used by the existing rules, independent of a browser or navigation cursor. */
export type VoiceOverSpeechContext = {
  containers:readonly string[];focusContext?:string;cell?:VoiceOverCell;column?:Pick<VoiceOverCell,'table'|'column'>;
};
export type VoiceOverSpeechInput = {
  target:VoiceOverSpeechTarget;
  /** Describes the action already performed by the caller; this function never performs it. */
  command:string;referenceBrowser?:'safari'|'chrome';checkedStateChanged?:boolean;
  focused?:boolean;focusEntry?:boolean;edit?:VoiceOverEditState;
};
export type VoiceOverSpeechResult = {
  /** A candidate for caller-supplied inputs, never per-call Native verification or a coverage certificate. */
  status:'approximation';evidenceProvenance:'simulation';nativeParityEstablished:false;
  speech:string;usageHint?:string;context:VoiceOverSpeechContext;
};

/** Existing English wording rules. Returns a hint candidate, not a native speech queue or completion signal. */
export function formatVoiceOverSpeech(input:VoiceOverSpeechInput, previous:VoiceOverSpeechContext={containers:[]}):VoiceOverSpeechResult {
  const {target:node,command,focused,edit,checkedStateChanged}=input;
  if(!speechCommands.has(command))throw new RangeError(`Unsupported VoiceOver speech command: ${command}`);
  const referenceBrowser=input.referenceBrowser??'safari';
  if(referenceBrowser!=='safari'&&referenceBrowser!=='chrome')throw new Error('Reference browser must be safari or chrome');
  const provenance={status:'approximation' as const,evidenceProvenance:'simulation' as const,nativeParityEstablished:false as const};
  const context:VoiceOverSpeechContext={...previous,containers:[...previous.containers],cell:previous.cell&&{...previous.cell},column:previous.column&&{...previous.column}};
  const checkboxChange=checkedStateChanged&&!node.semantic.protected&&node.semantic.role==='checkbox'&&typeof node.semantic.checked==='boolean'&&['activate_form_control','activate_button'].includes(command);
  // Chrome VO activation emits a value-change receipt without reading the object or its structure.
  if(referenceBrowser==='chrome'&&checkboxChange&&command==='activate_button')return {...provenance,speech:node.semantic.checked?'checked':'unchecked',usageHint:undefined,context};
  const focusMove=['next_focusable_item','previous_focusable_item'].includes(command);
  const focusLink=focusMove&&node.semantic.role==='link';
  let speech=formatSimulatedSpeech(focusLink?{...node.semantic,position:undefined,setSize:undefined}:node.semantic,checkedStateChanged,command,' ');
  const focusEntry=focused&&edit?.value&&!node.semantic.protected&&input.focusEntry;
  if(focusEntry&&edit){
    const selection=edit.value.slice(edit.start,edit.end),role=edit.multiline?'text entry area':'edit text';
    const caret=selection.length===edit.value.length?'contents selected':edit.start===0?'Insertion at beginning of text.':edit.start===edit.value.length?'Insertion at end of text.':'';
    speech=`${edit.value} ${caret} ${node.semantic.name} ${role}`.replace(/\s+/g,' ').trim();
  }else if(referenceBrowser==='chrome'&&node.cell&&['next_item','previous_item'].includes(command)&&focused&&edit?.value&&edit.start===edit.end&&!node.semantic.protected){
    const left=edit.value.slice(0,edit.start).match(/[A-Za-z]+$/)?.[0],right=edit.value.slice(edit.start).match(/^[A-Za-z]+/)?.[0];
    const caret=edit.start===0?'Insertion at beginning of text.':edit.start===edit.value.length?'Insertion at end of text.'
      :left&&right?`Insertion on word: ${left}${right} , between characters: ${left.at(-1)} and ${right[0]}`:undefined;
    if(caret)speech=[edit.value,caret,node.semantic.name,edit.multiline?'text entry area':'edit text'].filter(Boolean).join(' ');
  }
  if(node.cell&&!node.end&&!['next_focusable_item','previous_focusable_item'].includes(command)){
    const c=node.cell,row=c.row>0&&(context.cell?.table!==c.table||context.cell?.row!==c.row)?`row ${c.row+1} of ${c.rows}`:'';
    const entered=context.cell?.table!==c.table||context.cell?.row!==c.row||context.cell?.column!==c.column;
    const columnChanged=context.column?.table!==c.table||context.column?.column!==c.column;
    if(!checkboxChange)speech=[row,columnChanged&&c.row>0?c.header:'',entered&&c.rowSpan>1?`spans ${c.rowSpan} rows`:'',entered&&c.columnSpan>1?`spans ${c.columnSpan} columns`:'',['cell','columnheader','rowheader'].includes(node.semantic.role)?node.semantic.name:speech,entered?`column ${c.column+1} of ${c.columns}`:''].filter(Boolean).join(' ');
    context.cell={...c};context.column={table:c.table,column:c.column};
  }else context.cell=referenceBrowser==='chrome'&&node.cell&&focused&&edit?{...node.cell}:undefined;
  const scopes=(node.containers??[]).filter(c=>c.id!==node.axId);
  const entered=scopes.filter(c=>!context.containers.includes(c.id)&&c.name);
  const groupWords:Record<string,string>={group:'group',radiogroup:'radio group',tablist:'tab group'};
  const landmarks=['main','navigation','banner','contentinfo','complementary','region','form'];
  const focusScope=(c:VoiceOverContainer)=>node.semantic.role==='link'&&c.role==='list'||c.role==='article'||c.role==='table'||landmarks.includes(c.role)||!!c.name&&!!groupWords[c.role];
  // In measured Tab moves, named dialogs inside an exposed focus context use nearest-context wording.
  const focusDialogs=new Set(focusMove?scopes.filter((c,i)=>c.role==='dialog'&&c.name&&scopes.slice(0,i).some(focusScope)).map(c=>c.id):[]);
  const dialogWord=referenceBrowser==='chrome'?'dialog':'web dialog';
  for(const c of scopes.filter(c=>c.role==='dialog'&&!focusDialogs.has(c.id)&&!context.containers.includes(c.id))){
    const remaining=c.items-1;
    const summary=c.name?[c.name,dialogWord,c.items>1?`with ${c.items} items`:'']
      :[c.firstChildName,c.firstChildName&&remaining>0?`and ${remaining} more ${remaining===1?'item':'items'}`:'',dialogWord];
    speech=[...summary,speech].filter(Boolean).join(' ');
  }
  for(const c of entered.filter(c=>c.role==='alertdialog'))speech=`${c.name} web dialog with ${c.items} items ${speech}`;
  const nearest=scopes.filter(c=>focusScope(c)||focusDialogs.has(c.id)).at(-1);
  const contexts=focusMove?nearest&&nearest.id!==context.focusContext?[nearest]:[]:entered;
  for(const c of contexts.filter(c=>groupWords[c.role]))speech+=` ${c.name} ${groupWords[c.role]}`;
  for(const c of contexts.filter(c=>landmarks.includes(c.role)))speech+=` ${[c.name,c.role==='contentinfo'?referenceBrowser==='chrome'?'footer':'content information':c.role].filter(Boolean).join(' ')}`;
  for(const c of contexts.filter(c=>focusDialogs.has(c.id)))speech+=` ${c.name} ${dialogWord}`;
  if(focusLink)for(const c of contexts.filter(c=>c.role==='list'))speech+=` ${[c.name,'list',Number.isSafeInteger(c.items)&&c.items>0?`${c.items} ${c.items===1?'item':'items'}`:''].filter(Boolean).join(' ')}`;
  for(const c of contexts.filter(c=>c.role==='table'))speech+=` ${[c.name,'table',`${c.columns} ${c.columns===1?'column':'columns'}, ${c.rows} ${c.rows===1?'row':'rows'}`].filter(Boolean).join(' ')}`;
  if(focusMove)for(const c of contexts.filter(c=>c.role==='article'))speech+=` ${[(referenceBrowser==='chrome'&&c.inferredName?'':c.name)||c.entryChildName,'article'].filter(Boolean).join(' ')}`;
  context.containers=(node.containers??[]).map(c=>c.id);context.focusContext=nearest?.id;
  const parent=[...(node.containers??[])].reverse().find(c=>c.id!==node.axId&&(c.role!=='dialog'||!!c.name));
  const boundary=node.end?node.containers?.find(c=>c.id===node.axId):undefined;
  const usageHint=checkboxChange?undefined:formatUsageHint(boundary?{...node.semantic,role:boundary.role}:node.semantic,{referenceBrowser,parentRole:parent?.role,dialogAsFocusContext:!!parent&&focusDialogs.has(parent.id),inCell:(node.hintInCell||!!node.cell)&&!(node.semantic.role==='checkbox'&&parent?.role==='group'&&parent.name),end:node.end,forward:!['previous_item','previous_heading','previous_focusable_item'].includes(command),textFragment:node.hintTextFragment});
  return {...provenance,speech,usageHint,context};
}
