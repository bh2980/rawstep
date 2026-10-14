import type { Case } from "../cases.js";

export const DIVERSITY_SEED = "rawstep-diversity-2026-10-15-v1";
// V1 assignments were frozen before native capture; planner upgrades must never repartition this observed cohort.
const partitions:Record<string,string>={"entry-history":"train","role-handler":"train","aria-disabled":"train","focus-return":"train","focus-mutation":"validation","label-reference":"train","hidden-focus":"test","atomic-live":"test","busy-live":"test","group-context":"train"};
/** Matched questions: retain broken behavior and reserve complete scenario pairs before observation. */
export function generateDiversity() {
  const pages:Record<string,string>={},cases:Case[]=[];
  const add=(group:string,value:string,factor:string,body:string,chords:string[],script="",defect="none",delayed=false)=>{
    const id=`${group}-${value}`;
    pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Diversity ${id}</title>
<style>body{font:18px system-ui;padding:20px}button,input,a,[role=button]{margin:8px}</style><body>
<button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button><p id="status" role="status"></p>
<script>const byId=id=>document.getElementById(id);${script}</script></body></html>`;
    cases.push({id:`diversity.${id}`,page:`pages/${id}.html`,chords,captureAxAfterSteps:true,
      ...(delayed?{listen:{minWaitMs:1100,maxWaitMs:6000}}:{}),
      axes:{family:group,role:group,command:"workflow",templateGroup:`diversity.${group}`,contrastGroup:`diversity.${group}`,contrastFactor:factor,contrastValue:value,exposure:"unseen",partition:"pending",defect,reference:defect==='none'?'working':'intentional-defect'}});
  };
  for(const entry of ["vo","tab"])add("entry-history",entry,"entry-command",'<label><input id="target" type="checkbox">Receive harbor notices</label>',[entry==='vo'?'VO+Right':'Tab',"Space","VO+Right","VO+Left"]);
  for(const handler of ["present","missing"])add("role-handler",handler,"keyboard-handler",'<div id="target" role="button" tabindex="0">Refresh timetable</div>',["Tab","Enter","VO+Right"],`byId('target').onclick=()=>byId('status').textContent='Timetable refreshed';${handler==='present'?"byId('target').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();byId('target').click()}};":""}`,handler==='missing'?'missing-keyboard-handler':'none');
  for(const state of ["false","true"])add("aria-disabled",state,"aria-disabled",`<button id="target" aria-disabled="${state}">Reserve sample seat</button>`,["VO+Right","Space","VO+Right"],"byId('target').onclick=()=>byId('status').textContent='Sample seat reserved';",state==='true'?'handler-ignores-aria-disabled':'none');
  for(const target of ["opener","detour"])add("focus-return",target,"return-target",'<button id="opener">Open harbor options</button><dialog id="dialog" aria-label="Harbor options"><button id="inside">First option</button><button id="close">Close options</button></dialog><button id="detour">Unrelated action</button>',["Tab","Enter","Tab","Enter","VO+Right"],`byId('opener').onclick=()=>{byId('dialog').showModal();byId('inside').focus()};byId('close').onclick=()=>{byId('dialog').close();byId('${target}').focus()};`,target==='detour'?'incorrect-focus-return':'none');
  for(const mutation of ["remove","hidden"])add("focus-mutation",mutation,"mutation-type",'<button id="target">Dismiss sample item</button><button id="next">Next sample item</button>',["Tab","Space","VO+Right","Tab"],`byId('target').onclick=()=>{${mutation==='remove'?"byId('target').remove()":"byId('target').hidden=true"}};`);
  for(const ref of ["label","missing"])add("label-reference",ref,"label-reference",`<span id="label">Harbor schedule</span><button id="target" aria-labelledby="${ref}">Open schedule</button>`,["VO+Right","VO+Right","Space","VO+Left"],"byId('target').onclick=()=>byId('status').textContent='Schedule opened';",ref==='missing'?'dangling-labelledby':'none');
  for(const hidden of ["false","true"])add("hidden-focus",hidden,"aria-hidden",`<div aria-hidden="${hidden}"><button id="target">Inspect sample route</button></div><button id="next">Continue route</button>`,["Tab","Space","Tab","Shift+Tab"],"byId('target').onclick=()=>byId('status').textContent='Route inspected';",hidden==='true'?'focusable-aria-hidden':'none');
  for(const atomic of ["false","true"])add("atomic-live",atomic,"aria-atomic",`<button id="target">Add notification</button><div role="status" aria-atomic="${atomic}"><span id="count">0</span><span> notifications</span></div>`,["Tab","Space","VO+Right","VO+Right"],"byId('target').onclick=()=>byId('count').textContent='1';","none",true);
  for(const busy of ["false","true"])add("busy-live",busy,"aria-busy",`<button id="target">Update route availability</button><div id="live" role="status" aria-busy="${busy}"><span id="availability">Not checked</span></div>`,["Tab","Space","VO+Right"],"byId('target').onclick=()=>{byId('availability').textContent='Seats available';setTimeout(()=>byId('live').setAttribute('aria-busy','false'),700)};","none",true);
  for(const name of ["unnamed","named"])add("group-context",name,"group-name",`<div role="group" aria-label="${name==='named'?'Harbor preferences':''}"><label><input id="target" type="checkbox">Include ferry routes</label></div>`,["Tab","Space","VO+Left","VO+Right"]);
  for(const c of cases)c.axes.partition=partitions[c.axes.family!]!;
  return {pages,cases};
}
