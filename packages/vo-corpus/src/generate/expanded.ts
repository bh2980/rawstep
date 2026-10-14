import type { Case } from "../cases.js";
import { generateWorkflows } from "./workflows.js";

/** Fixed training/validation split. Validation adds containing context, changed labels and different input words. */
export function generateExpanded(partition: "training" | "validation") {
  const base = generateWorkflows(), pages: Record<string, string> = {}, cases: Case[] = [];
  const validation = partition === "validation";
  const renames = validation ? [
    ["Dog bowl", "Bird bowl"], ["Cat food", "Dog meal"], ["Cat toy", "Dog ball"], ["Cat care", "Outdoor journal"],
    ["Email updates", "Shipping reminders"], ["Billing address", "Office preferences"], ["Save changes", "Save invoice"],
    ["Save profile settings", "Save delivery options"], ["Only affects this account", "Applies to this order only"],
    ["Delivery settings", "Collection options"], ["Delivery name", "Recipient name"], ["Alex", "Morgan"],
    ["Product note", "Order instructions"], ["Player volume", "Notification volume"], ["Product color", "Cover finish"],
    ["Overview", "Features"], ["Reviews", "Questions"], ["Shipping", "Collection"],
    ["Delivery arrives tomorrow", "Collection opens Friday"], ["Feeding", "Equipment"], ["Play time", "Routes"],
  ] : [
    ["Dog bowl", "Horse brush"], ["Cat food", "Cat pellets"], ["Cat toy", "Cat ribbon"], ["Cat care", "Pet care notes"],
    ["Email updates", "Order updates"], ["Billing address", "Contact preferences"], ["Save changes", "Save draft"],
    ["Save profile settings", "Save workspace options"], ["Only affects this account", "Applies to this workspace only"],
    ["Delivery settings", "Pickup preferences"], ["Delivery name", "Pickup name"], ["Alex", "Jamie"],
    ["Product note", "Cart note"], ["Player volume", "Preview volume"], ["Product color", "Item finish"],
    ["Delivery arrives tomorrow", "Pickup is ready"],
  ];
  for (const [id, original] of Object.entries(base.pages)) {
    let html = original;
    for (const [from, to] of renames) html = html.replaceAll(from!, to!);
    if (validation) {
      const start = html.indexOf("</button>") + "</button>".length, end = html.indexOf('<button id="after"');
      html = html.slice(0, start) + '<main aria-label="Order workspace">' + html.slice(start, end) + '</main>' + html.slice(end);
    }
    pages[id] = html;
  }
  for (const c of base.cases) {
    let chords = [...c.chords];
    if (validation && c.id === "search-results.matches") chords = ["Tab", "d", "o", "g", "Enter"];
    if (validation && c.id.startsWith("search-autocomplete.")) chords[1] = "d";
    if (c.id === "text-editing.workflow") chords = ["Tab", ...(validation ? ["d", "o", "g"] : ["c", "u", "p"]), "Left", "Backspace", "Cmd+A", ...(validation ? ["f", "o", "x"] : ["m", "a", "p"])];
    cases.push({ ...c, id: `${partition}.${c.id}`, chords, axes: { ...c.axes, partition, reference: "working" } });
  }
  const add = (id: string, family: string, body: string, chords: string[], script = "") => {
    const title = validation ? "Weekend planning" : "Workshop planning";
    pages[id] = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${partition} ${id}</title>
<style>body{font:18px system-ui;padding:24px}button,input,textarea,summary{font:inherit;margin:6px}:focus{outline:3px solid blue}[hidden]{display:none!important}</style></head>
<body><button id="before" autofocus>Before marker</button>${body.replaceAll("SECTION", title)}<button id="after">After marker</button>
<script>"use strict";const byId=id=>document.getElementById(id);${script}</script></body></html>`;
    cases.push({ id: `${partition}.${id}`, page: `pages/${id}.html`, chords,
      axes: { family, role: family, command: "workflow", partition, reference: "working" }, captureAxAfterSteps: true });
  };
  const walk = (n: number) => [...Array.from({ length: n }, () => "VO+Right"), "VO+Left"];
  add("nested-groups", "context", '<div role="group" aria-label="SECTION"><button>Open notes</button><div role="group" aria-label="Details"><button>Apply choice</button></div><button>Close notes</button></div>', walk(9));
  add("fieldset-fields", "context", '<fieldset><legend>SECTION</legend><label>Reference<input id="reference"></label><label><input id="notify" type="checkbox">Send updates</label></fieldset>', ["Tab", "a", "Tab", "Space", "Shift+Tab"]);
  add("list-text", "list", '<ul aria-label="SECTION"><li>Morning session</li><li>Evening session</li></ul>', walk(7));
  add("list-ordered", "list", '<ol aria-label="SECTION" start="4"><li>Reserve tickets</li><li>Confirm guests</li></ol>', walk(7));
  add("list-links", "list", '<ul aria-label="SECTION"><li><a href="#details">Item details</a></li><li><a href="#reviews">Guest reviews</a></li></ul>', walk(8));
  add("list-nested", "list", '<ul aria-label="SECTION"><li>Schedule<ul><li>Preparation</li><li>Departure</li></ul></li><li>Budget</li></ul>', walk(11));
  add("table-simple", "table", '<table><caption>SECTION</caption><thead><tr><th scope="col">Item</th><th scope="col">Quantity</th></tr></thead><tbody><tr><th scope="row">Tickets</th><td>2</td></tr><tr><th scope="row">Rooms</th><td>1</td></tr></tbody></table>', walk(12));
  add("table-buttons", "table", '<table><caption>SECTION</caption><tr><th scope="col">Item</th><th scope="col">Action</th></tr><tr><th scope="row">Booking</th><td><button id="edit">Edit booking</button></td></tr></table>', ["Tab", "Enter", "Shift+Tab"], 'byId("edit").onclick=()=>byId("edit").textContent="Booking saved";');
  add("menu-select", "menu", '<button id="opener" aria-haspopup="menu" aria-expanded="false">SECTION options</button><div id="menu" role="menu" aria-label="SECTION" hidden><button id="choice0" role="menuitem" tabindex="-1">Print details</button><button id="choice1" role="menuitem" tabindex="-1">Download notes</button></div><p id="status" role="status"></p>',
    ["Tab", "Enter", "Down", "Enter"], `const opener=byId("opener"),menu=byId("menu"),close=()=>{menu.hidden=true;opener.setAttribute("aria-expanded","false");opener.focus()};opener.onclick=()=>{menu.hidden=false;opener.setAttribute("aria-expanded","true");byId("choice0").focus()};[0,1].forEach((i)=>{const b=byId("choice"+i);b.onclick=()=>{byId("status").textContent=b.textContent+" selected";close()};b.onkeydown=e=>{if(e.key==="Escape"){e.preventDefault();close()}if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();byId("choice"+(1-i)).focus()}}});`);
  add("menu-dismiss", "menu", '<button id="opener" aria-haspopup="menu" aria-expanded="false">SECTION options</button><div id="menu" role="menu" aria-label="SECTION" hidden><button id="choice" role="menuitem" tabindex="-1">Print notes</button></div>', ["Tab", "Enter", "Escape"], 'byId("opener").onclick=()=>{byId("menu").hidden=false;byId("opener").setAttribute("aria-expanded","true");byId("choice").focus()};byId("choice").onkeydown=e=>{if(e.key==="Escape"){byId("menu").hidden=true;byId("opener").setAttribute("aria-expanded","false");byId("opener").focus()}};');
  add("textarea-edit", "editing", '<label>SECTION notes<textarea id="target" rows="3"></textarea></label>', ["Tab", "a", "b", "Enter", "c", "Left", "Backspace", "Cmd+A", "d"]);
  add("input-prefilled", "editing", '<label>SECTION name<input id="target" value="Robin"></label>', ["Tab", "Right", "End", "Shift+Home", "Backspace", "n"]);
  add("heading-sections", "content", '<article><h1>SECTION</h1><p>Introduction</p><h2>Availability</h2><p>Places remain.</p><h3>Requirements</h3><button>Reserve now</button><h2>Refunds</h2></article>', ["VO+Cmd+H", "VO+Cmd+H", "VO+Cmd+H", "VO+Cmd+H", "VO+Cmd+Shift+H"]);
  add("definition-list", "list", '<dl aria-label="SECTION"><dt>Departure</dt><dd>Friday</dd><dt>Duration</dt><dd>Two days</dd></dl>', walk(10));
  add("disclosure-link", "disclosure", '<details><summary>SECTION details</summary><a href="#policy">Read policy</a><p>Refunds are available.</p></details>', ["Tab", "Enter", "Tab", "Shift+Tab", "Enter"]);
  add("dialog-checkbox", "modal", '<button id="opener">SECTION preferences</button><dialog id="dialog" aria-label="SECTION"><label><input id="check" type="checkbox">Send reminders</label><button id="close">Done</button></dialog>', ["Tab", "Enter", "Space", "Tab", "Enter"], 'byId("opener").onclick=()=>{byId("dialog").showModal();byId("check").focus()};byId("close").onclick=()=>byId("dialog").close();byId("dialog").onclose=()=>byId("opener").focus();');
  add("inline-context", "content", '<p>SECTION includes <a href="#policy">booking terms</a> and <strong>required notices</strong>.</p><blockquote>Keep this reference.</blockquote><button>Continue</button>', walk(9));
  return { pages, cases };
}
