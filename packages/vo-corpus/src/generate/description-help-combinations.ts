import type {Case} from '../cases.js';

/** Calibration: only the source attributes change, including equal title/description text. */
export function generateDescriptionHelpCombinations(){
 const pages:Record<string,string>={},cases:Case[]=[],focusTargets:Record<string,string[]>={};
 const note='Available for future bookings.',help='Review booking schedules';
 for(const [variant,attributes]of Object.entries({
  'reference-only':'aria-describedby="note"',
  'reference-title':`aria-describedby="note" title="${help}"`,
  'attribute-title':`aria-description="${note}" title="${help}"`,
  'title-only':`title="${help}"`,
  'reference-equal-title':`aria-describedby="note" title="${note}"`,
 })){
  const id='description-help-combinations-v1.'+variant;
  pages[variant]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Booking notices</title><style>body{font:17px system-ui;padding:16px}button{margin:5px}</style><body><button id="before" autofocus>Before marker</button><span id="note" hidden>${note}</span><button id="first" ${attributes}>Inspect booking notices</button><button id="after">After marker</button></body></html>`;
  cases.push({id,page:'pages/'+variant+'.html',chords:['Tab','Shift+Tab','Tab'],captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},taskOutcome:{controls:[{role:'button',name:'Inspect booking notices',state:{disabled:false}}],texts:[]},axes:{family:'description-help-source-calibration',role:'button',partition:'train',exposure:'calibration',templateGroup:'description-help-combinations-v1',contrastGroup:'description-help-combinations-v1',sourceCondition:variant,command:'focus-entry-return'}});
  focusTargets[id]=['first','before','first'];
 }
 return {pages,cases,focusTargets};
}
