import type { Case } from "../cases.js";

/** Regression questions found by independent focus/value validation, collected before changing focus rules. */
export function generateFollowup() {
  const pages: Record<string, string> = {}, cases: Case[] = [];
  const add = (id: string, body: string, chords: string[], script = "") => {
    pages[id] = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Focus followup ${id}</title><style>body{font:18px system-ui;padding:20px}button,input,a{margin:10px}</style><body>
<button id="before" autofocus onclick="status.textContent='Start activated'">Before marker</button>${body}<button id="after">After marker</button><p id="feedback" role="status"></p>
<script>const status=document.getElementById('feedback');${script}</script></body></html>`;
    cases.push({ id: `focus-followup.${id}`, page: `pages/${id}.html`, chords, captureAxAfterSteps: true, axes: { family: "focus", role: "focus", command: "workflow", partition: "training", reference: "working" } });
  };
  add("button-space", '<button id="target" onclick="status.textContent=\'Target activated\'">Choose seat</button>', ["VO+Right","Space","Tab","Shift+Tab"]);
  add("link-enter", '<a id="target" href="#destination" onclick="event.preventDefault();status.textContent=\'Link activated\'">Open timetable</a>', ["VO+Right","Enter","Tab","Shift+Tab"]);
  add("input-type", '<label>Reference<input id="target"></label>', ["VO+Right","a","Tab","Shift+Tab","b"]);
  add("static-space", '<h2 id="heading">Timetable</h2><button id="target">Choose route</button>', ["VO+Right","Space","Tab"]);
  add("group-space", '<div role="group" aria-label="Booking"><button id="target" onclick="status.textContent=\'Group target activated\'">Choose ticket</button></div>', ["VO+Right","VO+Right","Space"]);
  add("edit-focus-return", '<label>Reference<input id="target"></label><button id="next">Review</button>', ["Tab","a","Tab","Shift+Tab","b"]);
  add("tab-links", '<a id="link" href="#destination">Timetable</a><button id="target">Choose route</button><label>Name<input id="name"></label>', ["Tab","Tab","Shift+Tab","Shift+Tab"]);
  for (const count of [1,3]) add(`menu-${count}`, `<button id="opener" aria-haspopup="menu" aria-expanded="false">Ticket actions</button><div id="menu" role="menu" hidden>${Array.from({length:count},(_,i)=>`<button role="menuitem" tabindex="-1" id="option${i}">Ticket option ${i+1}</button>`).join('')}</div>`, ["Tab","Enter","Escape"],
    `const opener=document.getElementById('opener'),menu=document.getElementById('menu');opener.onclick=()=>{menu.hidden=false;opener.setAttribute('aria-expanded','true');document.getElementById('option0').focus()};menu.onkeydown=e=>{if(e.key==='Escape'){menu.hidden=true;opener.setAttribute('aria-expanded','false');opener.focus()}};`);
  return {pages,cases};
}
