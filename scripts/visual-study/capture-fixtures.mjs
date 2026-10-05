#!/usr/bin/env node
/** Controlled evaluation only: independent labels/DOM diagnostics are never model inputs. */
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createBrowserSession} from '@rawstep/browser/browser';
import {collectBrowserDiagnostics} from '@rawstep/browser/profiles';
import {screenshotChoices} from '@rawstep/policies/screenshot/policy';
const out=resolve(process.argv[2]??'runs/visual-fixtures');await mkdir(out,{recursive:true});
const definitions=[
{id:'search-unfocused',family:'local-search-form',split:'development',scenario:'search',defect:'normal',keys:[],focus:'focus:none',acceptable:['key:Tab','stop:uncertain']},
{id:'search-focused',family:'local-search-form',split:'development',scenario:'search',defect:'normal',keys:['Tab'],focus:'focus:editable-target',acceptable:['type:query','replace:query']},
{id:'search-invisible',family:'local-search-form',split:'development',scenario:'search',defect:'invisible',keys:['Tab'],focus:'focus:none',acceptable:['key:Tab','key:Shift+Tab','stop:uncertain','stop:stuck']},
{id:'settings-normal',family:'local-dialog-settings',split:'evaluation',scenario:'settings',defect:'normal',keys:['Tab','Tab'],focus:'focus:activation-target',acceptable:['key:Enter','key:Space']},
{id:'settings-trap',family:'local-dialog-settings',split:'evaluation',scenario:'settings',defect:'trap',keys:['Tab','Tab'],focus:'focus:other',acceptable:['key:Tab','key:Shift+Tab','key:Escape','stop:uncertain','stop:stuck']},
{id:'settings-occluded',family:'local-dialog-settings',split:'evaluation',scenario:'settings',defect:'occluded',keys:['Tab','Tab'],focus:'focus:none',acceptable:['key:Tab','key:Shift+Tab','key:Escape','stop:uncertain','stop:stuck']},
];
const cases=[];
for(const c of definitions){
 const file=pathToFileURL(resolve('fixtures/visual-study/controls.html'));file.search=new URLSearchParams({scenario:c.scenario,defect:c.defect}).toString();
 const s=await createBrowserSession(file.href,{headless:true,...(process.env.RAWSTEP_TEST_BROWSER_PATH?{executablePath:process.env.RAWSTEP_TEST_BROWSER_PATH}:{})});
 try{
  await s.page.evaluate(()=>document.fonts.ready);let previous;const history=[];const historyScreenshotHashes=[];
  const screen=async()=>({pngBase64:(await s.page.screenshot({animations:'disabled'})).toString('base64'),viewport:{w:s.page.viewportSize().width,h:s.page.viewportSize().height}});
  for(const key of c.keys){previous=await screen();historyScreenshotHashes.push(createHash('sha256').update(Buffer.from(previous.pngBase64,'base64')).digest('hex'));await s.page.keyboard.press(key);history.push({step:history.length+1,decision:{action:{kind:'key',key}}})}
  const screenshot=await screen(),png=Buffer.from(screenshot.pngBase64,'base64');
  const sha256=createHash('sha256').update(png).digest('hex');
  let unchangedTransitions=0;for(let i=historyScreenshotHashes.length-1;i>=0&&historyScreenshotHashes[i]===sha256;i--)unchangedTransitions++;
  const request={protocol:'rawstep-screenshot-choice-v1',goal:c.scenario==='search'?'Enter the named query input into Search books.':'Activate Apply settings to save the reading preferences.',screenshot,...(previous?{previousScreenshot:previous}:{}),choices:screenshotChoices({intents:[],keys:['Tab','Shift+Tab','Enter','Space','Escape'],inputKeys:c.scenario==='search'?['query']:[],replaceText:true}),history,visualState:{sha256,visits:historyScreenshotHashes.filter(h=>h===sha256).length+1,unchangedTransitions}};
  const diagnostic=await collectBrowserDiagnostics(s.page);
  const focusEvidence=await s.page.evaluate(()=>{const e=document.activeElement,style=getComputedStyle(e);return {id:e.id||null,tag:e.tagName,outlineWidth:style.outlineWidth,outlineStyle:style.outlineStyle,outlineColor:style.outlineColor}});
  const focusedBefore=focusEvidence.id;await s.page.keyboard.press('Tab');const focusedAfter=await s.page.evaluate(()=>document.activeElement.id||null);
  const repeatedFocus=focusedBefore===focusedAfter;
  const independent={...c,historyScreenshotHashes,diagnostic,focusEvidence,afterAdditionalTab:focusedAfter,repeatedFocus,seededDefect:c.defect!=='normal',policyVisible:false};
  await writeFile(join(out,c.id+'.png'),png);await writeFile(join(out,c.id+'-request.json'),JSON.stringify(request,null,2));await writeFile(join(out,c.id+'-oracle.json'),JSON.stringify(independent,null,2));
  cases.push({...c,request:c.id+'-request.json',oracle:c.id+'-oracle.json',sha256});
 }finally{await s.close()}
}
await writeFile(join(out,'manifest.json'),JSON.stringify({schema:'rawstep-seeded-fixtures-v1',cases,limits:'Synthetic controls, CSS overlap only (not genuine browser zoom), no native AT or WCAG conformance claim. Request payloads contain pixels and actual keyboard history only.'},null,2));console.log(JSON.stringify({captured:cases.length,out}));
