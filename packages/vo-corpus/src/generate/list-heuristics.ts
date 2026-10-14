import type { Case } from "../cases.js";

/** Questions raised by MDN's actual skip-link and breadcrumb trees. */
export function generateListHeuristics() {
  const pages: Record<string,string>={},cases:Case[]=[];
  for (const tag of ["ul","ol"]) for (const nav of [false,true]) for (const explicit of [false,true]) {
    const id=`${tag}-${nav?"nav":"body"}-${explicit?"role":"implicit"}`;
    const list=`<${tag}${explicit?' role="list"':''} style="list-style:none;padding:0"><li><a href="#first">First route</a></li><li><a href="#second">Second route</a></li></${tag}>`;
    pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>List heuristic ${id}</title><style>body{font:18px system-ui;padding:20px}button,a{margin:8px}</style><body><button id="before" autofocus>Before marker</button>${nav?'<nav aria-label="Routes">'+list+'</nav>':list}<button id="after">After marker</button></body></html>`;
    cases.push({id:`list-heuristics.${id}`,page:`pages/${id}.html`,chords:[...Array.from({length:7},()=>"VO+Right"),"VO+Left"],captureAxAfterSteps:true,axes:{family:"list-heuristic",role:tag,context:nav?"navigation":"body",explicitRole:String(explicit),partition:"training",reference:"semantic-heuristic",command:"navigation",templateGroup:"unmarked-linked-list",exposure:"calibration",contrastGroup:`unmarked-list.${tag}.${nav}`,contrastFactor:"explicit-role",contrastValue:String(explicit)}});
  }
  return {pages,cases};
}
