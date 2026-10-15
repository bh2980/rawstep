import {formatSimulatedSpeech, type SimulatedSemanticNode} from './semantics.js';
import {formatUsageHint} from './usage-hints.js';

export type VoiceOverContainer = {id:string;name:string;inferredName?:boolean;role:string;items:number;rows?:number;columns?:number};
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

/** Existing English wording rules. Returns a hint candidate, not a native speech queue or completion signal. */
export function formatVoiceOverSpeech(input:VoiceOverSpeechInput, previous:VoiceOverSpeechContext={containers:[]}) {
  const {target:node,command,focused,edit,checkedStateChanged}=input;
  const referenceBrowser=input.referenceBrowser??'safari';
  if(referenceBrowser!=='safari'&&referenceBrowser!=='chrome')throw new Error('Reference browser must be safari or chrome');
  const context:VoiceOverSpeechContext={...previous,containers:[...previous.containers],cell:previous.cell&&{...previous.cell},column:previous.column&&{...previous.column}};
  let speech=formatSimulatedSpeech(node.semantic,checkedStateChanged,command,' ');
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
    speech=[row,columnChanged&&c.row>0?c.header:'',entered&&c.rowSpan>1?`spans ${c.rowSpan} rows`:'',entered&&c.columnSpan>1?`spans ${c.columnSpan} columns`:'',['cell','columnheader','rowheader'].includes(node.semantic.role)?node.semantic.name:speech,entered?`column ${c.column+1} of ${c.columns}`:''].filter(Boolean).join(' ');
    context.cell={...c};context.column={table:c.table,column:c.column};
  }else context.cell=referenceBrowser==='chrome'&&node.cell&&focused&&edit?{...node.cell}:undefined;
  const scopes=(node.containers??[]).filter(c=>c.id!==node.axId);
  const entered=scopes.filter(c=>!context.containers.includes(c.id)&&c.name);
  for(const c of entered.filter(c=>c.role==='dialog'||c.role==='alertdialog'))speech=`${c.name} web dialog with ${c.items} items ${speech}`;
  const groupWords:Record<string,string>={group:'group',radiogroup:'radio group',tablist:'tab group'};
  const landmarks=['main','navigation','banner','contentinfo','complementary','region','form'];
  const nearest=scopes.filter(c=>c.role==='article'||c.role==='table'||!!c.name&&(groupWords[c.role]||landmarks.includes(c.role))).at(-1);
  const focusMove=['next_focusable_item','previous_focusable_item'].includes(command);
  const contexts=focusMove?nearest&&nearest.id!==context.focusContext?[nearest]:[]:entered;
  for(const c of contexts.filter(c=>groupWords[c.role]))speech+=` ${c.name} ${groupWords[c.role]}`;
  for(const c of contexts.filter(c=>landmarks.includes(c.role)))speech+=` ${c.name} ${c.role}`;
  for(const c of contexts.filter(c=>c.role==='table'))speech+=` ${[c.name,'table',`${c.columns} ${c.columns===1?'column':'columns'}, ${c.rows} ${c.rows===1?'row':'rows'}`].filter(Boolean).join(' ')}`;
  if(focusMove)for(const c of contexts.filter(c=>c.role==='article'))speech+=` ${[referenceBrowser==='chrome'&&c.inferredName?'':c.name,'article'].filter(Boolean).join(' ')}`;
  context.containers=(node.containers??[]).map(c=>c.id);context.focusContext=nearest?.id;
  const parent=[...(node.containers??[])].reverse().find(c=>c.id!==node.axId);
  const boundary=node.end?node.containers?.find(c=>c.id===node.axId):undefined;
  const checkboxChange=input.checkedStateChanged&&command==='activate_form_control'&&node.semantic.role==='checkbox';
  const usageHint=checkboxChange?undefined:formatUsageHint(boundary?{...node.semantic,role:boundary.role}:node.semantic,{parentRole:parent?.role,inCell:node.hintInCell||!!node.cell,end:node.end,forward:!['previous_item','previous_heading','previous_focusable_item'].includes(command),textFragment:node.hintTextFragment});
  return {speech,usageHint,context};
}
