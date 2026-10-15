import type {Case} from '../cases.js';
import {generateContextReturn} from './context-return.js';
import type {VoiceOverSpeechInput,VoiceOverContainer} from 'rawstep/mock-voiceover';

/** Calibration: hold targets/history fixed while varying article naming and its nearest child scope. */
export function generateArticleContextSpeech(browser:'safari'|'chrome'='safari'){
 const pages:Record<string,string>={},cases:Case[]=[],speechInputs:Record<string,VoiceOverSpeechInput[]>={};
 const variants=[
  {id:'heading-before',heading:'before'},
  {id:'explicit-name',heading:'before',label:'Workshop actions'},
  {id:'no-heading',heading:'none'},
  {id:'heading-after',heading:'after'},
  {id:'inner-group',heading:'before',group:true},
 ];
 const trace=[['first','Tab'],['second','Tab'],['after','Tab'],['second','Shift+Tab'],['first','Shift+Tab'],['before','Shift+Tab'],['first','Tab']];
 for(const variant of variants){
  const id='article-context-speech-v1.'+variant.id,heading='<h2>Workshop bulletin</h2>';
  const controls=`${variant.group?'<div id="tools" role="group" aria-label="Editing tools">':''}<button id="first">Review notes</button>${variant.group?'</div>':''}<button id="second">Publish notes</button>`;
  pages[variant.id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Workshop controls</title><style>body{font:17px system-ui;padding:18px}button{display:block;margin:12px}article,[role=group]{padding:6px}</style><body><button id="before" autofocus>Before marker</button><article id="story"${variant.label?` aria-label="${variant.label}"`:''}>${variant.heading==='before'?heading:''}${controls}${variant.heading==='after'?heading:''}</article><button id="after">After marker</button></body></html>`;
  cases.push({id,page:'pages/'+variant.id+'.html',chords:trace.map(([,key])=>key!),captureAxAfterSteps:true,listen:{minWaitMs:2400,quietMs:1200,maxWaitMs:8500},axes:{family:'article-name-and-history',role:'button',partition:'train',exposure:'calibration',templateGroup:'article-context-speech-v1',contrastGroup:'article-context-speech-v1',command:'focus-entry-and-return'}});
  speechInputs[id]=trace.map(([identity,chord])=>{
   const containers:VoiceOverContainer[]=[];
   if(identity==='first'||identity==='second'){
    containers.push({id:'story',role:'article',name:variant.label??(browser==='safari'&&variant.heading!=='none'?'Workshop bulletin':''),inferredName:!variant.label,items:0});
    if(identity==='first'&&variant.group)containers.push({id:'tools',role:'group',name:'Editing tools',items:0});
   }
   return {command:chord==='Tab'?'next_focusable_item':'previous_focusable_item',target:{identity:identity!,semantic:{role:'button',tagName:'button',name:identity==='first'?'Review notes':identity==='second'?'Publish notes':identity==='before'?'Before marker':'After marker',protected:false,disabled:false,readonly:false,required:false,multiline:false,modal:false,hasMoreContent:false},containers}};
  });
 }
 return {pages,cases,speechInputs};
}

/** Update detection reuses all inspected contrasts; it is never a new independent evaluation. */
export function generateArticleEntryUpdate(){
 const base=generateArticleContextSpeech(),legacy=generateContextReturn().pages['article-flat-inferred']!;
 const pages:Record<string,string>={},cases:Case[]=[];
 const add=(sourceCaseId:string,html:string,chords:string[])=>{
  const key=sourceCaseId.replaceAll('.','-');pages[key]=html;
  cases.push({...base.cases[0]!,id:'article-entry-update-v1.'+key,page:'pages/'+key+'.html',chords,axes:{family:'article-entry-update',role:'button',partition:'regression',exposure:'inspected',templateGroup:'article-entry-update-v1',contrastGroup:'article-entry-update-v1',command:'focus-entry-and-return',sourceCaseId}});
 };
 for(const c of base.cases)add(c.id,base.pages[c.page.slice(6,-5)]!,c.chords);
 const original=base.pages['heading-before']!,legacyChords=['Tab','Tab','Shift+Tab','Tab','Tab','Shift+Tab'];
 for(const [experiment,newPage,oldPage] of [
  ['recheck',original.replace('<article id="story">','<article>'),legacy],
  ['layout',original.replace('display:block','display:inline-block'),legacy.replace('<body>','<style>button{display:block}</style><body>')],
  ['child',original.replace('<button id="first">Review notes</button>','<div><button id="first">Review notes</button></div>'),legacy.replace('<div><button id="inner">Review draft</button></div>','<button id="inner">Review draft</button>')],
 ]){
  add('article-context-'+experiment+'-v1.without-id',newPage!,base.cases[0]!.chords);
  add('article-context-'+experiment+'-v1.legacy-exact',oldPage!,legacyChords);
 }
 return {pages,cases};
}
