import type {Case} from '../cases.js';

/** Native reading-unit contrasts: keep the name, level, geometry separation and history fixed. */
export function generateLinkedHeadingSource(){
 const set='linked-heading-source-v1',pages:Record<string,string>={},cases:Case[]=[],targetIds:Record<string,string[]>={};
 const variants={
  'plain-link':'<a id=first href="#after">Harbor itinerary</a>',
  'plain-heading':'<h2 id=first>Harbor itinerary</h2>',
  'link-outside':'<a id=first href="#after"><h2 id=heading>Harbor itinerary</h2></a>',
  'heading-outside':'<h2 id=heading><a id=first href="#after">Harbor itinerary</a></h2>',
 };
 for(const [variant,body]of Object.entries(variants)){
  const id=set+'.'+variant;
  pages[variant]=`<!doctype html><html lang=en><meta charset=utf-8><title>Harbor guide</title><style>body{font:17px system-ui;padding:16px}button{margin:5px}a,h2{display:inline-block;padding:7px;margin:5px}h2{font-size:24px}</style><body><button id=before autofocus>Before marker</button>${body}<button id=after>After marker</button></body></html>`;
  cases.push({id,page:'pages/'+variant+'.html',chords:['VO+Right','VO+Left','VO+Right'],captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},taskOutcome:{controls:variant==='plain-heading'?[]:[{role:'link',name:'Harbor itinerary',state:{disabled:false}}],texts:variant==='plain-heading'?['Harbor itinerary']:[]},axes:{family:'linked-heading-unit-calibration',role:variant==='plain-link'?'link':'heading',partition:'train',exposure:'calibration',templateGroup:set,contrastGroup:set,sourceCondition:variant,command:'object-entry-return'}});
  targetIds[id]=['first','before','first'];
 }
 return {pages,cases,targetIds};
}
