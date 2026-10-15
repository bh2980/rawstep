import type {Case} from '../cases.js';

/** Calibrate nearest-context changes separately from task success or new-feature support. */
export function generateContextReturn(){
  const pages:Record<string,string>={},cases:Case[]=[];
  const add=(id:string,body:string,contrast:string)=>{
    pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Publishing preferences</title><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
    cases.push({id:`context-return-v1.${id}`,page:`pages/${id}.html`,chords:['Tab','Tab','Shift+Tab','Tab','Tab','Shift+Tab'],captureAxAfterSteps:true,listen:{minWaitMs:1000,quietMs:800,maxWaitMs:6000},
      axes:{family:'nearest-context-return',role:'compound-boundary',partition:'train',exposure:'calibration',templateGroup:`context-return-v1.${contrast}`,contrastGroup:'context-return-v1.boundary-and-article-name',command:'focus-context-entry-exit'}});
  };
  for(const grouped of [false,true])add(`region-${grouped?'group':'flat'}`,`<section aria-label="Account preferences"><div${grouped?' role="group" aria-label="Alerts"':''}><button id="inner">Change alerts</button></div><button id="outer">Save preferences</button></section>`,'region-group');
  for(const table of [false,true])for(const named of [false,true]){
    const inner='<button id="inner">Review draft</button>';
    add(`article-${table?'table':'flat'}-${named?'named':'inferred'}`,`<article${named?' aria-label="Story tools"':''}><h2>Editorial desk</h2>${table?`<table><caption>Draft actions</caption><tr><th>Action</th></tr><tr><td>${inner}</td></tr></table>`:`<div>${inner}</div>`}<button id="outer">Publish draft</button></article>`,`article-${table?'table':'flat'}`);
  }
  return {pages,cases};
}
