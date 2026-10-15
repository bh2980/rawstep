import type {Case} from '../cases.js';

/** One-factor label/cell contrasts and separately authored compositions. No condition IDs enter page titles. */
export function generateReadingUnits(partition:'train'|'test'){
  const pages:Record<string,string>={},cases:Case[]=[],setId=partition==='train'?'reading-units-v1':'reading-units-transfer-v1';
  const walk=(n:number)=>[...Array.from({length:n},()=>'VO+Right'),'VO+Left','VO+Right'];
  const add=(id:string,family:string,body:string,chords:string[],contrast?:string)=>{
    pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Coastal interface study</title><style>body{font:18px system-ui;padding:20px}button,a,input{margin:8px}td,th{padding:10px}</style><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
    cases.push({id:`${setId}.${id}`,page:`pages/${id}.html`,chords,captureAxAfterSteps:true,listen:{minWaitMs:1000,quietMs:800,maxWaitMs:6000},
      axes:{family,role:family==='labels'?'labelled-control':'table-cell',partition,exposure:partition==='train'?'calibration':'unseen',templateGroup:`${setId}.${id}`,command:'object-and-keyboard',...(contrast?{contrastGroup:`${setId}.${contrast}`}:{})}});
  };
  const table=(content:string)=>`<table><caption>Departure options</caption><tr><th>Day</th><th>Action</th></tr><tr><td>Monday</td><td>${content}</td></tr></table>`;
  if(partition==='train'){
    for(const type of ['checkbox','radio','text'])for(const after of [false,true]){
      const input=`<input type="${type}"${type==='text'?' autocomplete="off"':''}>`;
      add(`wrap-${type}-${after?'after':'before'}`,'labels',`<label>${after?input+'Travel updates':'Travel updates'+input}</label>`,walk(3),`wrap-${type}-order`);
    }
    for(const after of [false,true])add(`for-checkbox-${after?'after':'before'}`,'labels',after?'<input id="updates" type="checkbox"><label for="updates">Travel updates</label>':'<label for="updates">Travel updates</label><input id="updates" type="checkbox">',walk(3),'for-checkbox-order');
    add('aria-checkbox','labels','<input type="checkbox" aria-label="Travel updates">',walk(2));
    add('checkbox-state-history','labels','<label><input type="checkbox">Travel updates</label>',['Tab','Space','VO+Right','VO+Left','Space','VO+Right','VO+Left']);
    add('cell-text','cells',table('Reserve seat'),walk(7),'cell-content');
    add('cell-button','cells',table('<button>Reserve seat</button>'),walk(7),'cell-content');
    add('cell-link','cells',table('<a href="#seat">Reserve seat</a>'),walk(7),'cell-content');
    add('cell-input','cells',table('<input aria-label="Travel note" autocomplete="off">'),walk(7),'cell-content');
    add('cell-text-button','cells',table('Available <button>Reserve seat</button> today'),walk(9));
    add('cell-two-buttons','cells',table('<button>Reserve seat</button><button>More information</button>'),walk(8));
    add('cell-wrapped-button','cells',table('<div><span><button>Reserve seat</button></span></div>'),walk(7));
    add('cell-heading-link','cells',table('<h3><a href="#seat">Reserve seat</a></h3>'),walk(7));
    add('cell-column-span','cells','<table><caption>Departure options</caption><tr><th colspan="2">Service</th></tr><tr><td>Monday</td><td><button>Reserve seat</button></td></tr></table>',walk(6));
    add('cell-row-span','cells','<table><caption>Departure options</caption><tr><th>Day</th><th>Action</th></tr><tr><td rowspan="2">Monday</td><td><button>Reserve seat</button></td></tr><tr><td><a href="#details">More information</a></td></tr></table>',walk(8));
  }else{
    add('preferences-dialog','labels','<button onclick="document.querySelector(\'dialog\').showModal()">Open journey preferences</button><dialog aria-label="Journey preferences"><h3>Notices</h3><label><input type="checkbox">Departure alerts</label><button onclick="this.closest(\'dialog\').close()">Done</button></dialog>',['VO+Right','VO+Space','Tab','Space','VO+Right','VO+Left','Tab','Enter']);
    add('newsletter-card','labels','<main><article aria-label="Weekly notes"><h3>Stay informed</h3><label><input type="checkbox"><span>Weekly dispatch</span></label><p>Choose your topics.</p><button>Save subscriptions</button></article></main>',walk(11));
    add('radio-fieldset','labels','<form aria-label="Ticket options"><fieldset><legend>Seat preference</legend><label><input type="radio" name="seat" checked>Window</label><label>Aisle<input type="radio" name="seat"></label></fieldset><button>Review tickets</button></form>',walk(12));
    add('labelled-reference','labels','<section aria-label="Order lookup"><h3>Find a parcel</h3><input id="reference" autocomplete="off"><label for="reference"><span>Order reference</span></label><button>Find parcel</button></section>',walk(8));
    add('booking-table','cells','<main><h3>Bookings</h3><table><caption>Upcoming visits</caption><tr><th>Visit</th><th>Options</th></tr><tr><td>Gallery tour</td><td><button>Change time</button><a href="#receipt">Receipt</a></td></tr></table></main>',walk(12));
    add('inventory-table','cells','<section aria-label="Stock check"><table><caption>Warehouse stock</caption><tr><th>Item</th><th>Quantity</th><th>Action</th></tr><tr><th scope="row">Canvas bag</th><td><label>Units<input value="2" autocomplete="off"></label></td><td><button>Update stock</button></td></tr></table></section>',walk(13));
    add('resource-directory','cells','<article><h3>Learning resources</h3><table><caption>Reading list</caption><tr><th>Topic</th><th>Resource</th></tr><tr><td>Harbor history</td><td><div><h4><a href="#guide">Visitor guide</a></h4><p>Read the illustrated edition.</p></div></td></tr></table></article>',walk(13));
    add('delivery-table','cells','<form aria-label="Delivery choices"><table><caption>Parcel deliveries</caption><tr><th>Parcel</th><th>Notice</th></tr><tr><td>Summer order</td><td><label><input type="checkbox">Text updates</label><button>Apply choice</button></td></tr></table></form>',walk(12));
  }
  return {pages,cases};
}

/** Reuses calibration input groups for new reverse/activation/edit histories; never a new holdout. */
export function generateReadingReturns(){
  const source=generateReadingUnits('train'),pages:Record<string,string>={},cases:Case[]=[];
  const next=(n:number)=>Array.from({length:n},()=>'VO+Right');
  const add=(sourceId:string,id:string,chords:string[],change?:(html:string)=>string)=>{
    const parent=source.cases.find(c=>c.id===`reading-units-v1.${sourceId}`)!,html=source.pages[sourceId]!;
    pages[id]=change?change(html):html;
    cases.push({...parent,id:`reading-returns-v1.${id}`,page:`pages/${id}.html`,chords,axes:{...parent.axes,command:'reverse-and-action',...(change?{templateGroup:`reading-returns-v1.${id}`}:{})}});
  };
  add('cell-two-buttons','two-buttons-return',[...next(6),'VO+Left','VO+Left','VO+Right','VO+Right','VO+Left','Tab','Shift+Tab']);
  add('cell-text-button','text-button-return',[...next(7),'VO+Left','VO+Left','VO+Left','VO+Right','VO+Right','VO+Left']);
  add('cell-button','button-activation',[...next(5),'VO+Space','VO+Right','VO+Left','VO+Right'],html=>html.replace('<button>Reserve seat</button>','<button onclick="document.getElementById(\'receipt\').textContent=\'Reservation saved\'">Reserve seat</button>').replace('<button id="after">','<p id="receipt" role="status"></p><button id="after">'));
  add('cell-input','input-edit',[...next(5),'a','Left','VO+Left','VO+Right','Tab','Shift+Tab']);
  return {pages,cases};
}

/** Fixed input pairs isolate HTML radio grouping and physical versus VO activation. */
export function generateReadingState(){
  const pages:Record<string,string>={},cases:Case[]=[];
  const add=(id:string,type:'radio'|'checkbox',named:boolean,gesture:'VO+Space'|'Space')=>{
    pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Coastal interface study</title><body><button id="before" autofocus>Before marker</button><label><input type="${type}"${named?' name="choice"':''}>Travel updates</label><button id="after">After marker</button></body></html>`;
    cases.push({id:`reading-state-v1.${id}`,page:`pages/${id}.html`,chords:['VO+Right',gesture,'VO+Right','VO+Left',gesture],captureAxAfterSteps:true,listen:{minWaitMs:1000,quietMs:800,maxWaitMs:6000},
      axes:{family:'control-state-history',role:type,state:type==='radio'?'unchecked-to-selected-to-reselected':'unchecked-to-checked-to-unchecked',partition:'train',exposure:'calibration',templateGroup:`reading-state-v1.${type}${named?'-named':''}`,contrastGroup:`reading-state-v1.${type}`,command:gesture==='Space'?'physical-activation':'vo-activation',name:named?'named-group':'anonymous'}});
  };
  add('radio-anonymous','radio',false,'VO+Space');
  add('radio-named','radio',true,'VO+Space');
  add('checkbox-vo','checkbox',false,'VO+Space');
  add('checkbox-physical','checkbox',false,'Space');
  return {pages,cases};
}

/** Focus-entry contrasts and caret return histories reuse existing calibration input groups. */
export function generateFocusContext(){
  const units=generateReadingUnits('train'),states=generateReadingState(),pages:Record<string,string>={},cases:Case[]=[];
  const next=(n:number)=>Array.from({length:n},()=>'VO+Right');
  const add=(source:ReturnType<typeof generateReadingUnits>,sourceId:string,id:string,chords:string[],change?:(html:string)=>string)=>{
    const parent=source.cases.find(c=>c.id.endsWith('.'+sourceId))!;
    pages[id]=change?change(source.pages[sourceId]!):source.pages[sourceId]!;
    cases.push({...parent,id:`focus-context-v1.${id}`,page:`pages/${id}.html`,chords,axes:{...parent.axes,family:'focus-entry-and-edit-return',command:'focus-and-edit-context',...(change?{templateGroup:`focus-context-v1.${id}`}:{})}});
  };
  add(states,'checkbox-vo','wrapped-tab',['Tab','Space','VO+Right','VO+Left','Space']);
  for(const entry of ['VO+Right','Tab']){
    add(units,'aria-checkbox',`aria-${entry==='Tab'?'tab':'vo'}`,[entry,'Space','VO+Right','VO+Left','Space']);
    add(units,'for-checkbox-after',`external-${entry==='Tab'?'tab':'vo'}`,[entry,'Space','VO+Right','VO+Left','Space']);
  }
  add(units,'cell-input','typed-return-end',[...next(5),'b','Left','Right','VO+Left','VO+Right','Tab','Shift+Tab']);
  const prefill=(html:string)=>html.replace('aria-label="Travel note"','aria-label="Travel note" value="Dock"');
  add(units,'cell-input','prefilled-vo',[...next(5),'Right','VO+Left','VO+Right','Tab','Shift+Tab'],prefill);
  add(units,'cell-input','prefilled-tab',['Tab','Right','Tab','Shift+Tab','Left','VO+Left','VO+Right'],prefill);
  return {pages,cases};
}

/** Separate outer object navigation from explicit interaction with composite controls. */
export function generateListboxInteraction(){
  const pages:Record<string,string>={},cases:Case[]=[];
  const options=['Coast','Forest','Harbor'];
  const variants=[
    {id:'native',body:'<label for="routes">Destination</label><select id="routes" size="3">'+options.map((name,i)=>`<option${i===1?' selected':''}>${name}</option>`).join('')+'</select>',entry:['VO+Right','VO+Right']},
    ...(['single','none','multiple'] as const).map(mode=>({id:`aria-${mode}`,body:`<div id="routes" role="listbox" aria-label="Destination" tabindex="0"${mode==='multiple'?' aria-multiselectable="true"':''}>`+options.map((name,i)=>`<div role="option" aria-selected="${mode==='none'?false:mode==='multiple'?i!==1:i===1}"><span>${name}</span></div>`).join('')+'</div>',entry:['VO+Right']})),
  ];
  for(const variant of variants)for(const interaction of [false,true]){
    const id=`${variant.id}-${interaction?'interact':'outer'}`;
    pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Destination preferences</title><body><button id="before" autofocus>Before marker</button>${variant.body}<button id="after">After marker</button></body></html>`;
    cases.push({id:`listbox-interaction-v1.${id}`,page:`pages/${id}.html`,
      chords:[...variant.entry,...(interaction?['VO+Shift+Down','VO+Right','VO+Left','VO+Shift+Up','VO+Right','VO+Left']:['VO+Right','VO+Left','Tab','Shift+Tab'])],
      captureAxAfterSteps:true,listen:{minWaitMs:1000,quietMs:800,maxWaitMs:6000},
      axes:{family:'composite-listbox',role:'listbox',state:variant.id,partition:'train',exposure:'calibration',templateGroup:`listbox-interaction-v1.${variant.id}`,contrastGroup:'listbox-interaction-v1.selection-and-interaction',command:interaction?'enter-exit-interaction':'outer-object-and-tab'}});
  }
  return {pages,cases};
}
