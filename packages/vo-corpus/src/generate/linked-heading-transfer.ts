import type {Case} from '../cases.js';

/** Reserve new transparent-wrapper compositions and reverse entry before Native calibration. */
export function generateLinkedHeadingTransfer(){
 const set='linked-heading-transfer-v1',pages:Record<string,string>={},cases:Case[]=[],targetIds:Record<string,string[]>={};
 for(const [variant,body]of Object.entries({
  'wrapped-outer-link':'<a id=first href="#after"><span><h3 id=heading>Route overview</h3></span></a>',
  'wrapped-outer-heading':'<h4 id=heading><span><a id=first href="#after"><strong>Route overview</strong></a></span></h4>',
 })){
  const id=set+'.'+variant;
  pages[variant]=`<!doctype html><html lang=en><meta charset=utf-8><title>Route reference</title><style>body{font:17px system-ui;padding:16px}button{margin:5px}a,h3,h4{display:inline-block;padding:7px;margin:5px}h3,h4{font-size:22px}span{display:inline-block}</style><body><button id=before autofocus>Before marker</button>${body}<button id=after>After marker</button></body></html>`;
  cases.push({id,page:'pages/'+variant+'.html',chords:['VO+Right','VO+Right','VO+Left','VO+Left','VO+Right','VO+Right','VO+Left'],captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},taskOutcome:{controls:[{role:'link',name:'Route overview',state:{disabled:false}}],texts:[]},axes:{family:'linked-heading-wrapper-transfer',role:'heading',partition:'test',exposure:'unseen',templateGroup:id,siteGroup:id,contrastGroup:id,command:'reverse-entry-after-return',oraclePurpose:'fixture-health'}});
  targetIds[id]=['first','after','first','before','first','after','first'];
 }
 return {pages,cases,targetIds};
}
