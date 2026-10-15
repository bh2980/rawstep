import type {SimulatedSemanticNode} from './semantics.js';

export type HintContext={referenceBrowser?:'safari'|'chrome';parentRole?:string;dialogAsFocusContext?:boolean;inCell?:boolean;end?:boolean;forward?:boolean;textFragment?:boolean};
const click='press Control -Option -Space.',exitWeb='To exit this web area, press Control -Option -Shift -Up Arrow.';
const boundaries=new Set(['group','article','figure','list','descriptionlist','table','main','navigation','banner','contentinfo','complementary','region','form']);

/** English hints measured in the local Safari/VoiceOver profile, independent of element names. */
export function formatUsageHint(node:SimulatedSemanticNode,context:HintContext={}):string|undefined{
  if(node.protected)return undefined;
  const {role}=node,container=boundaries.has(role),parent=context.parentRole;
  const web=!parent&&!context.inCell,dialog=(parent==='dialog'||parent==='alertdialog')&&!context.dialogAsFocusContext;
  const location=context.inCell?', inside of a cell':dialog?`, inside of a ${context.referenceBrowser==='chrome'&&parent==='dialog'?'dialog':'web dialog'}`:web?', inside of web content':'';
  let label:string|undefined,article='a',action='';
  if(role==='heading'&&node.level!==undefined)label=`heading level ${node.level}`;
  else if(role==='button'||role==='DisclosureTriangle'){
    label=node.tagName==='summary'?'summary':node.pressed!==undefined?'toggle button':'button';
    action=node.tagName==='summary'?`To expand or collapse the contents of this item, ${click}`:node.pressed!==undefined?`To select or deselect this checkbox, ${click}`:node.hasPopup?`To display a list of options, ${click}`:`To click this button, ${click}`;
  }else if(role==='link'){label='link';action=`To click this link, ${click}`;}
  else if(role==='checkbox'){label='checkbox';action=`To select or deselect this checkbox, ${click}`;}
  else if(role==='switch'){label='switch';action=`To toggle this switch, ${click}`;}
  else if(['textbox','searchbox','spinbutton'].includes(role)){
    label=node.tagName==='textarea'?'text area':'text field';
    if(node.tagName!=='textarea')action='To enter text in this field, type.';
  }else if(role==='combobox'){label='combo box';action=`Type text or, to display a list of choices, ${click}`;}
  else if(role==='slider'){label='slider';action='To start interacting with the slider, press Control -Option -Shift -Down Arrow.';}
  else if(role==='radio'){
    label=`${node.checked?'selected ':''}radio button${node.position&&node.setSize?`, ${node.position} of ${node.setSize}`:''}`;
    if(!node.checked)action=`To select this option, ${click}`;
  }
  else if(role==='tab'){
    label=`${node.selected?'selected ':''}tab${node.position&&node.setSize?`, ${node.position} of ${node.setSize}`:''}`;
    if(!node.selected)action=`To select this option, ${click}`;
  }else if(role==='menuitem'){label='menu item';action=`To choose this menu item, ${click} To close this menu, press Escape.`;}
  else if(role==='option')label='selectable list item';
  else if(role==='listbox'&&node.listboxSummary){label='list box';action='To begin interacting with the items in this list, press Control -Option -Shift -Down Arrow.';}
  else if(role==='image'){label='image';article='an';action='To begin interacting with the contents of this image, press Control -Option -Shift -Down Arrow.';}
  else if(role==='StaticText'||context.inCell&&['cell','columnheader','rowheader'].includes(role))label=context.textFragment?'text element':'selectable text';
  else if(role==='listitem')label=node.name?'text element':'list marker';
  else if(role==='descriptionitem')label='text element';
  else if(container)label=role==='descriptionlist'?'description list':role;
  if(!label)return undefined;
  if(node.disabled)action='This item is dimmed.';
  const position=container&&!context.end&&parent?'in':'on';
  if(container){
    if(role==='table'&&(!context.end||!context.forward))action='To navigate the cells within this table press Control -Option, and then Up Arrow, Down Arrow, Left Arrow, or Right Arrow.';
    if(['list','descriptionlist'].includes(role)&&context.end&&context.forward)action='To move between items in this list, press Control -Option -Right Arrow or Control -Option -Left Arrow.';
  }
  // Container entry and reverse entry at an end stop do not offer the forward exit instruction.
  const exit=web&&(!container||context.end&&context.forward)?exitWeb:dialog?'To exit this group, press Control -Option -Shift -Up Arrow.':'';
  const more=node.hasMoreContent?'Press Control -Option -Command -Slash to bring up the more content menu.':'';
  const hint=[`You are currently ${position} ${article} ${label}${location}.`,action,more,exit].filter(Boolean).join(' ');
  return node.help?`${node.help}  ${hint}`:hint;
}
