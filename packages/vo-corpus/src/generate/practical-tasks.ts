import type {Case} from '../cases.js';
import type {TaskOutcome} from '../task-outcomes.js';

/** New compositions with final-state targets fixed before native or simulator observation. */
export function generatePracticalTasks(){
  const pages:Record<string,string>={},cases:Case[]=[];
  const add=(id:string,body:string,script:string,chords:string[],taskOutcome:TaskOutcome)=>{
    pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Community service desk</title><style>body{font:18px system-ui;padding:20px}label{display:block}button,input,summary{margin:8px}td,th{padding:12px}</style><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button><script>const byId=id=>document.getElementById(id);${script}</script></body></html>`;
    cases.push({id:`practical-tasks-v1.${id}`,page:`pages/${id}.html`,chords,taskOutcome,captureAxAfterSteps:true,listen:{minWaitMs:1000,quietMs:800,maxWaitMs:6000},
      axes:{family:'practical-composition',role:'compound-task',partition:'test',exposure:'unseen',templateGroup:`practical-tasks-v1.${id}`,siteGroup:`synthetic-practical-v1.${id}`,command:'object-keyboard-and-state'}});
  };
  add('bulletin-registration','<main><h2>Bulletin settings</h2><form aria-label="Bulletin preferences"><label><input id="bulletin" type="checkbox">Bulletin updates</label><label>Contact name<input id="contact" autocomplete="off"></label><button id="save" type="button">Save contact</button></form><p id="receipt" role="status"></p></main>',
    'byId("save").onclick=()=>byId("receipt").textContent="Saved contact: "+byId("contact").value+"; bulletin "+(byId("bulletin").checked?"enabled":"disabled")',
    ['VO+Right','VO+Right','Tab','Space','Tab','n','o','a','Tab','Enter','VO+Right','VO+Left'],
    {controls:[{role:'checkbox',name:'Bulletin updates',state:{checked:true}},{role:'textbox',name:'Contact name',state:{value:'noa'}}],texts:['Saved contact: noa; bulletin enabled']});
  add('delivery-reservation','<section aria-label="Delivery scheduling"><h2>Delivery slot</h2><details><summary id="disclosure">Delivery details</summary><fieldset><legend>Time window</legend><label><input id="morning" type="radio" name="slot" value="morning" checked>Morning slot</label><label><input id="evening" type="radio" name="slot" value="evening">Evening slot</label></fieldset><button id="reserve">Save delivery slot</button></details><p id="receipt" role="status"></p></section>',
    'byId("reserve").onclick=()=>byId("receipt").textContent="Delivery saved: "+document.querySelector("input[name=slot]:checked").value',
    ['Tab','Enter','Tab','Down','Tab','Space','VO+Right','VO+Left'],
    {controls:[{role:'disclosuretriangle',name:'Delivery details',state:{expanded:true}},{role:'radio',name:'Morning slot',state:{checked:false}},{role:'radio',name:'Evening slot',state:{checked:true}}],texts:['Delivery saved: evening']});
  add('basket-checkout','<article><h2>Basket review</h2><table><caption>Current basket</caption><tr><th>Item</th><th>Action</th></tr><tr><td>Canvas tote<input id="quantity" aria-label="Basket quantity" value="1" readonly tabindex="-1"></td><td><button id="add">Add one tote</button><button id="remove" disabled>Remove one tote</button></td></tr></table><button id="checkout">Confirm basket</button><p id="receipt" role="status"></p></article>',
    'const update=delta=>{byId("quantity").value=String(Number(byId("quantity").value)+delta);byId("remove").disabled=Number(byId("quantity").value)<=1};byId("add").onclick=()=>update(1);byId("remove").onclick=()=>update(-1);byId("checkout").onclick=()=>byId("receipt").textContent="Order confirmed: "+byId("quantity").value+" items"',
    ['Tab','Space','Space','Tab','Enter','Tab','Enter','VO+Right','VO+Left'],
    {controls:[{role:'textbox',name:'Basket quantity',state:{value:'2'}},{role:'button',name:'Remove one tote',state:{disabled:false}}],texts:['Order confirmed: 2 items']});
  return {pages,cases};
}
