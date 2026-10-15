import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {MockVoiceOverBackend,type VoiceOverSpeechInput} from 'rawstep/mock-voiceover';
import {checkSpeechInput} from '../packages/vo-corpus/src/speech-input.js';
import type {AxDump} from '../packages/vo-corpus/src/axdump.js';
import {launchTestBrowser} from './helpers/browser.js';
type Row={caseId:string;step:number;chord:string;rendererDOMId:string;verificationInput:VoiceOverSpeechInput;utterances:{text:string}[];nativeInputObservation:{dump:AxDump;before:AxDump}};
for(const cohort of ['source','transfer']){
const fixture=JSON.parse(readFileSync(new URL(`./fixtures/voiceover-evidence/native-button-disable-${cohort}-v1-2026-10-16.json`,import.meta.url),'utf8')) as {pages:{id:string;html:string}[];profiles:{browser:'safari'|'chrome';rows:Row[]}[]};

it.each(fixture.profiles)(`$browser actual plain-button inputs reproduce ${cohort} Native receipts`,async p=>{
 const browser=await launchTestBrowser();let compared=0;
 try{for(const c of fixture.pages){
  const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,900,p.browser);
  try{
   await page.setContent(c.html);await page.bringToFront();await page.locator('#before').focus();await backend.start();backend.attachSession({page});
   await backend.observe();await backend.execute({kind:'intent',intent:'readCurrent'});await backend.observe();const cdp=await context.newCDPSession(page);
   for(const row of p.rows.filter(r=>r.caseId===c.id)){
    if(!['Tab','Shift+Tab','Space'].includes(row.chord))throw new Error('Unexpected action in button-disable fixture');
    await backend.execute({kind:'key',key:row.chord});
    const observation=await backend.observe(),diagnostic=backend.getSpeechInputObservation()!;
    expect(diagnostic.windowId).toBe(observation.windowId);expect(diagnostic.events).toHaveLength(1);
    const event=diagnostic.events[0]!;if(event.kind==='activation'){expect(event.status).toBe('modeled');expect(observation.speech).toEqual([]);}
    const target=event.input.target as typeof event.input.target&{backendDOMNodeId:number};
    const {object}=await cdp.send('DOM.resolveNode',{backendNodeId:target.backendDOMNodeId});
    const resolved=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId!,functionDeclaration:'function(){return this.id}',returnByValue:true});
    const originalEvent=(row as any).verifiedInputs?.find((e:any)=>e.kind===event.kind);
    await cdp.send('Runtime.releaseObject',{objectId:object.objectId!});expect(resolved.result.value).toBe(originalEvent?.rendererDOMId??row.rendererDOMId);
    const input=structuredClone(event.input);input.target.identity=resolved.result.value;
    const original=(row as any).verifiedInputs?.find((e:any)=>e.kind===event.kind)?.input??row.verificationInput;expect(target.semantic).toEqual(original.target.semantic);
    expect(checkSpeechInput(input,row.nativeInputObservation.dump,{buttonSpaceEvent:event.kind==='activation'}).status,`${c.id} ${row.step}`).toBe('verified');
    if('beforeTarget' in input&&input.beforeTarget){input.beforeTarget.identity=resolved.result.value;expect(checkSpeechInput({...input,target:input.beforeTarget},row.nativeInputObservation.before,{buttonSpaceEvent:true}).status).toBe('verified');}
    expect(observation.speech).toEqual(row.utterances.map(u=>u.text));compared++;
   }
   await cdp.detach();
  }finally{await backend.close();await context.close();}
 }}finally{await browser.close();}
 expect(compared).toBe(cohort==='source'?8:14);
},60000);

}
