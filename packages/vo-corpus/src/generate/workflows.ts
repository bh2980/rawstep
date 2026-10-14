import { END_MARKER, START_MARKER, type Case } from "../cases.js";

/** Working, local fixtures. Their DOM behavior is tested independently of VoiceOver speech. */
export function generateWorkflows() {
  const pages: Record<string, string> = {};
  const cases: Case[] = [];
  const add = (id: string, family: string, role: string, body: string, script: string,
    programs: { command: string; chords: string[] }[], options: Pick<Case, "listen"> = {}) => {
    pages[id] = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${id}</title>
<style>body{font:18px system-ui;padding:24px;max-width:800px}button,input,summary{font:inherit;margin:6px;padding:8px}:focus{outline:3px solid #175fe6}label{display:block}dialog{padding:24px}dialog::backdrop{background:#0006}[hidden]{display:none!important}[aria-pressed=true],[aria-checked=true],[aria-selected=true]{background:#dce9ff;border:2px solid #175fe6}</style></head>
<body><button id="before" type="button" autofocus>${START_MARKER}</button>${body}<button id="after" type="button">${END_MARKER}</button>
<script>"use strict";const byId=id=>document.getElementById(id);${script}</script></body></html>`;
    for (const p of programs) cases.push({
      id: `${id}.${p.command}`, page: `pages/${id}.html`, chords: p.chords,
      axes: { family, role, command: p.command, state: ["names", "context", "content"].includes(family) ? "static-reference" : "measured-transition" },
      captureAxAfterSteps: true, ...options,
    });
  };
  const sequence = (chords: string[]) => [{ command: "workflow", chords }];
  const read = sequence(["VO+Right", "VO+Right", "VO+Left"]);

  // Matched names: visible text stays "Save"; only the naming/description mechanism changes.
  for (const [id, attributes, extra] of [
    ["content", "", ""],
    ["aria-label", 'aria-label="Save changes"', ""],
    ["labelledby-conflict", 'aria-label="Save changes" aria-labelledby="name"', '<span id="name">Save profile settings</span>'],
    ["description", 'aria-label="Save changes" aria-describedby="hint"', '<p id="hint">Only affects this account</p>'],
  ]) add(`name-${id}`, "names", "button", `<button id="target" type="button" ${attributes}>Save</button>${extra}`, "", read);
  for (const [id, body] of [
    ["fieldset", '<fieldset><legend>Billing address</legend><button id="target" type="button">Save</button></fieldset>'],
    ["group", '<div role="group" aria-label="Billing address"><button id="target" type="button">Save</button></div>'],
  ]) add(`context-${id}`, "context", "group", body!, "", sequence(["VO+Right", "VO+Right", "VO+Right", "VO+Left"]));

  add("checkbox-toggle", "state", "checkbox", '<label><input id="target" type="checkbox">Email updates</label>', "", sequence(["Tab", "Space", "Space"]));
  add("switch-toggle", "state", "switch", '<button id="target" type="button" role="switch" aria-checked="false">Email updates</button>',
    'byId("target").onclick=()=>{const b=byId("target");b.setAttribute("aria-checked",String(b.getAttribute("aria-checked")!=="true"))}', sequence(["Tab", "Space", "Space"]));
  add("favorite-toggle", "state", "button", '<button id="target" type="button" aria-pressed="false">Favorite Cat toy</button>',
    'byId("target").onclick=()=>{const b=byId("target");b.setAttribute("aria-pressed",String(b.getAttribute("aria-pressed")!=="true"))}', sequence(["Tab", "Space", "Space"]));

  add("faq-native", "disclosure", "group", '<details id="details"><summary id="target">Shipping information</summary><p id="answer">Delivery takes three days.</p></details>',
    "", sequence(["Tab", "Enter", "Enter"]));
  add("faq-aria", "disclosure", "button", '<button id="target" type="button" aria-expanded="false" aria-controls="answer">Shipping information</button><div id="answer" hidden><p>Delivery takes three days.</p><button id="inside" type="button">Track delivery</button></div>',
    'byId("target").onclick=()=>{const b=byId("target"),open=b.getAttribute("aria-expanded")!=="true";b.setAttribute("aria-expanded",String(open));byId("answer").hidden=!open}',
    sequence(["Tab", "Space", "Tab", "Shift+Tab", "Space"]));

  add("modal-settings", "modal", "dialog", `<button id="opener" type="button">Edit delivery name</button>
<dialog id="dialog" aria-labelledby="dialog-title"><h2 id="dialog-title">Delivery settings</h2><label>Delivery name<input id="delivery" value="Alex"></label>
<button id="save" type="button">Save settings</button><button id="cancel" type="button">Cancel</button></dialog>`,
    `const dialog=byId("dialog"),opener=byId("opener");opener.onclick=()=>{dialog.showModal();byId("delivery").focus()};
byId("save").onclick=byId("cancel").onclick=()=>dialog.close();dialog.addEventListener("close",()=>opener.focus());
dialog.addEventListener("keydown",e=>{if(e.key!=="Tab")return;const ids=["delivery","save","cancel"],i=ids.indexOf(document.activeElement.id);
if(e.shiftKey&&i===0){e.preventDefault();byId("cancel").focus()}else if(!e.shiftKey&&i===2){e.preventDefault();byId("delivery").focus()}});`,
    sequence(["Tab", "Enter", "Tab", "Tab", "Tab", "Shift+Tab", "Escape"]));

  for (const mode of ["manual", "automatic"]) {
    const labels = ["Overview", "Reviews", "Shipping"];
    const body = `<div id="tabs" role="tablist" aria-label="Product information">${labels.map((label, i) =>
      `<button id="tab${i}" role="tab" type="button" aria-selected="${i === 0}" aria-controls="panel${i}" tabindex="${i === 0 ? 0 : -1}">${label}</button>`).join("")}</div>` +
      labels.map((label, i) => `<div id="panel${i}" role="tabpanel" aria-labelledby="tab${i}" tabindex="0" ${i ? "hidden" : ""}><p>${label} for Cat toy.</p></div>`).join("");
    add(`tabs-${mode}`, "tabs", "tablist", body,
      `const tabs=[0,1,2].map(i=>byId("tab"+i));const select=i=>tabs.forEach((t,j)=>{t.setAttribute("aria-selected",String(i===j));t.tabIndex=i===j?0:-1;byId("panel"+j).hidden=i!==j});
byId("tabs").addEventListener("focusout",e=>{if(!byId("tabs").contains(e.relatedTarget))tabs.forEach(t=>t.tabIndex=t.getAttribute("aria-selected")==="true"?0:-1)});
tabs.forEach((t,i)=>{t.onclick=()=>select(i);t.onkeydown=e=>{let j;if(e.key==="ArrowRight")j=(i+1)%3;else if(e.key==="ArrowLeft")j=(i+2)%3;else if(e.key==="Home")j=0;else if(e.key==="End")j=2;else return;
e.preventDefault();tabs.forEach((b,k)=>b.tabIndex=k===j?0:-1);tabs[j].focus();${mode === "automatic" ? "select(j);" : ""}}});`,
      [{ command: "move", chords: ["Tab", "Right"] }, { command: "select-return", chords: ["Tab", "Right", "Space", "Left"] }]);
  }

  const colors = ["Red", "Green", "Blue"];
  add("radio-native", "radio", "radiogroup", `<fieldset><legend>Product color</legend>${colors.map((c, i) =>
    `<label><input id="radio${i}" type="radio" name="color" ${i ? "" : "checked"}>${c}</label>`).join("")}</fieldset>`,
    "", sequence(["Tab", "Down", "Down", "Up"]));
  add("radio-aria", "radio", "radiogroup", `<div role="radiogroup" aria-label="Product color">${colors.map((c, i) =>
    `<button id="radio${i}" type="button" role="radio" aria-checked="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${c}</button>`).join("")}</div>`,
    `const radios=[0,1,2].map(i=>byId("radio"+i)),select=i=>radios.forEach((r,j)=>{r.setAttribute("aria-checked",String(i===j));r.tabIndex=i===j?0:-1});
radios.forEach((r,i)=>{r.onclick=()=>select(i);r.onkeydown=e=>{let j;if(e.key==="ArrowDown"||e.key==="ArrowRight")j=(i+1)%3;else if(e.key==="ArrowUp"||e.key==="ArrowLeft")j=(i+2)%3;else return;e.preventDefault();select(j);radios[j].focus()}});`,
    sequence(["Tab", "Down", "Down", "Up"]));
  add("slider-volume", "slider", "slider", '<label>Player volume<input id="target" type="range" min="0" max="10" value="5"></label>',
    "", sequence(["Tab", "Right", "Right", "Left", "End", "Home"]));
  add("text-editing", "editing", "input-text", '<label>Product note<input id="target" type="text"></label>',
    "", sequence(["Tab", "c", "a", "t", "Left", "Backspace", "Cmd+A", "b", "e", "e"]));

  add("search-results", "search", "input-search", '<form id="form"><label>Search products<input id="query" type="search"></label><button id="submit" type="submit">Search</button></form><p id="count" role="status"></p><ul id="results"></ul>',
    `const products=["Cat food","Cat toy","Dog bowl"];byId("form").onsubmit=e=>{e.preventDefault();const q=byId("query").value.toLowerCase(),matches=products.filter(p=>p.toLowerCase().includes(q));
byId("results").replaceChildren(...matches.map(p=>{const li=document.createElement("li");li.textContent=p;return li}));byId("count").textContent=matches.length?matches.length+" results":"No results"};`,
    [{ command: "matches", chords: ["Tab", "c", "a", "t", "Enter"] }, { command: "empty", chords: ["Tab", "z", "Enter"] }]);

  add("search-autocomplete", "autocomplete", "combobox", `<label>Search products<input id="query" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="choices"></label>
<ul id="choices" role="listbox" aria-label="Product suggestions" hidden></ul>`,
    `const input=byId("query"),list=byId("choices"),products=["Cat food","Cat toy","Dog bowl"];let matches=[],active=-1;
const close=()=>{list.hidden=true;input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant");active=-1};
const show=()=>{matches=products.filter(p=>p.toLowerCase().includes(input.value.toLowerCase()));active=-1;
list.replaceChildren(...matches.map((p,i)=>{const li=document.createElement("li");li.id="option"+i;li.setAttribute("role","option");li.setAttribute("aria-selected","false");li.textContent=p;
li.onpointerdown=e=>{e.preventDefault();input.value=p;close();input.focus()};return li}));
list.hidden=matches.length===0;input.setAttribute("aria-expanded",String(matches.length>0));input.removeAttribute("aria-activedescendant")};
input.oninput=show;input.onblur=close;input.onkeydown=e=>{if(e.key==="Escape"){e.preventDefault();close();return}
if(e.key==="Enter"&&active>=0){e.preventDefault();input.value=matches[active];close();return}
if(e.key!=="ArrowDown"&&e.key!=="ArrowUp")return;e.preventDefault();if(list.hidden)show();if(!matches.length)return;
active=e.key==="ArrowDown"?Math.min(active+1,matches.length-1):(active<0?matches.length-1:Math.max(0,active-1));
Array.from(list.children).forEach((li,i)=>li.setAttribute("aria-selected",String(i===active)));input.setAttribute("aria-activedescendant","option"+active)};`,
    [{ command: "choose", chords: ["Tab", "c", "Down", "Down", "Enter"] }, { command: "dismiss", chords: ["Tab", "c", "Down", "Escape"] }]);

  add("form-correction", "form", "input-text", `<form id="form" novalidate><label>Username<input id="username" required aria-describedby="hint"></label><p id="hint">Use at least three characters.</p>
<p id="error" role="alert" hidden></p><button id="submit" type="submit">Create test account</button></form><p id="status" role="status"></p>`,
    `byId("form").onsubmit=e=>{e.preventDefault();const input=byId("username"),invalid=input.value.length<3;input.setAttribute("aria-invalid",String(invalid));byId("error").hidden=!invalid;
byId("error").textContent=invalid?"Username needs three characters.":"";input.setAttribute("aria-describedby",invalid?"hint error":"hint");
byId("status").textContent=invalid?"":"Test account ready";if(invalid)input.focus()};`,
    sequence(["Tab", "Tab", "Enter", "c", "a", "t", "Tab", "Enter"]));

  add("cart-update", "cart", "button", '<p>Cat toy costs 10 dollars.</p><button id="add" type="button">Add Cat toy to cart</button><button id="remove" type="button" disabled>Remove Cat toy</button><p id="cart" role="status" aria-atomic="true">Cart empty</p>',
    `let count=0;const render=()=>{byId("cart").textContent=count?count+" items, total "+count*10+" dollars":"Cart empty";byId("remove").disabled=count===0};
byId("add").onclick=()=>{count++;render()};byId("remove").onclick=()=>{count--;render();if(count===0)byId("add").focus()};`,
    sequence(["Tab", "Enter", "Enter", "Tab", "Enter", "Enter"]));

  add("blog-headings", "content", "heading", '<main><h1 id="article">Cat care</h1><p>Practical advice for pet owners.</p><h2 id="feeding">Feeding</h2><p>Offer fresh water.</p><h2 id="play">Play time</h2><p>Choose safe toys.</p></main>',
    "", sequence(["VO+Cmd+H", "VO+Cmd+H", "VO+Cmd+H", "VO+Cmd+Shift+H"]));

  // The same text update and unchanged focus, varying live semantics and delay. No synthetic speech oracle.
  for (const semantics of ["off", "polite", "assertive", "status", "alert"]) {
    for (const delay of semantics === "status" || semantics === "alert" ? [700] : [0, 1500]) {
      const attributes = semantics === "status" || semantics === "alert" ? `role="${semantics}"` : `aria-live="${semantics}"`;
      add(`live-${semantics}-${delay}`, "live", semantics, `<button id="trigger" type="button">Refresh delivery status</button><div id="message" ${attributes} aria-atomic="true"></div>`,
        `byId("trigger").onclick=()=>setTimeout(()=>{byId("message").textContent="Delivery arrives tomorrow"},${delay});`,
        sequence(["Tab", "Enter", "Enter"]), { listen: { minWaitMs: 2300, maxWaitMs: 7000 } });
    }
  }
  return { pages, cases };
}
