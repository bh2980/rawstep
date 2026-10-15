import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {MockVoiceOverBackend} from 'rawstep/mock-voiceover';
import {launchTestBrowser} from './helpers/browser.js';
type Row={caseId:string;step:number;chord:string;rendererDOMId:string;utterances:{text:string}[];readingTarget:{status:string};keyboardFocus:{native:string}};
type InputRow={caseId:string;step:number;observedSemantic:Record<string,unknown>;observedScopes:unknown[]};
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-list-profile-geometry-2026-10-16.json',import.meta.url),'utf8')) as {pages:{id:string;html:string}[];profiles:{browser:'safari'|'chrome';rows:Row[]}[]};
const audit=JSON.parse(readFileSync(new URL('../packages/vo-corpus/test/list-profile-input-audit.json',import.meta.url),'utf8')) as {profiles:{browser:string;rows:InputRow[]}[]};
it.each(fixture.profiles)('replays corrected $browser list inputs, entry/return history and Native receipts',async profile=>{
 const browser=await launchTestBrowser();let actions=0;
 try{for(const c of fixture.pages){const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,900,profile.browser);
  try{await page.setContent(c.html);await page.bringToFront();await page.locator('#before').focus();await backend.start();backend.attachSession({page});await backend.observe();await backend.execute({kind:'intent',intent:'readCurrent'});await backend.observe();const cdp=await context.newCDPSession(page);
   for(const row of profile.rows.filter(r=>r.caseId===c.id)){
    expect(row.readingTarget.status).toBe('matched');await backend.execute({kind:'key',key:row.chord});const observation=await backend.observe(),diagnostic=backend.getSpeechInputObservation()!;expect(diagnostic.windowId).toBe(observation.windowId);expect(diagnostic.events).toHaveLength(1);
    const event=diagnostic.events[0]!;const target=event.input.target as typeof event.input.target & {backendDOMNodeId:number};
    const {object}=await cdp.send('DOM.resolveNode',{backendNodeId:target.backendDOMNodeId}),result=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId!,functionDeclaration:'function(){return this.id}',returnByValue:true});await cdp.send('Runtime.releaseObject',{objectId:object.objectId!});expect(result.result.value).toBe(row.rendererDOMId);
    const observed=audit.profiles.find(p=>p.browser===profile.browser)!.rows.find(r=>r.caseId===c.id&&r.step===row.step)!;
    for(const [key,value]of Object.entries(observed.observedSemantic))expect(target.semantic[key as keyof typeof target.semantic]??(key==='hasMoreContent'?false:undefined),`${c.id} ${row.step} ${key}`).toEqual(value);
    expect((target.containers??[]).map(s=>({role:s.role,name:s.name,...s.role==='list'?{items:s.items}:{}}))).toEqual(observed.observedScopes);
    expect(observation.speech,`${c.id} ${row.step}`).toEqual(row.utterances.map(u=>u.text));expect(await page.evaluate(()=>document.activeElement?.id)).toBe(row.keyboardFocus.native);actions++;
   }await cdp.detach();
  }finally{await backend.close();await context.close();}
 }}finally{await browser.close();}expect(actions).toBe(18);
},90000);
