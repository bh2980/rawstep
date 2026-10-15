import {generateTableStateSpeech} from './table-state-speech.js';

/** Isolate ordinary DOM wrapping, explicit grouping and group naming inside the same cell. */
export function generateTableGroupHints(){
 const source=generateTableStateSpeech('train'),parent=source.cases.find(c=>c.id.endsWith('.table'))!,base=source.pages.table!,checkbox='<label><input id=choice type=checkbox>Email reminders</label>',pages:Record<string,string>={},cases:typeof source.cases=[],focusTargets:Record<string,string[]>={};
 for(const [name,wrapped]of Object.entries({direct:checkbox,wrapper:`<div>${checkbox}</div>`,group:`<div role=group>${checkbox}</div>`,'named-group':`<div role=group aria-label='Notification choices'>${checkbox}</div>`})){
  const id='table-group-hints-v1.'+name;pages[name]=base.replace(checkbox,wrapped);cases.push({...parent,id,page:'pages/'+name+'.html',chords:['Tab','Tab','Shift+Tab','Tab'],axes:{...parent.axes,family:'table-group-hint-contrast',templateGroup:'table-group-hints-v1',siteGroup:'synthetic-table-group-hints',contrastGroup:'table-group-hints-v1',command:'focus-return',wrapper:name}});focusTargets[id]=['choice','save','choice','save'];
 }
 return {pages,cases,focusTargets};
}
