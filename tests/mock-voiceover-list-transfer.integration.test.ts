import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {MockVoiceOverBackend} from 'rawstep/mock-voiceover';
import {fixturePageState} from '../packages/vo-corpus/src/state.js';
import {evaluateTaskOutcome,type TaskOutcome} from '../packages/vo-corpus/src/task-outcomes.js';
import {launchTestBrowser} from './helpers/browser.js';
type Row={caseId:string;step:number;chord:string;rendererDOMId:string;verificationInput:{target:{semantic:unknown;containers?:{role:string;name:string;items:number}[]}};utterances:{text:string}[];stateFields:{role:string;name:string;key:string;status:string;native:unknown}[];controlPresence:{role:string;name:string;status:string;native:boolean}[];readingTarget:{status:string};keyboardFocus:{native:string}};
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-list-profiles-transfer-2026-10-16.json',import.meta.url),'utf8')) as {pages:{id:string;html:string;taskOutcome:TaskOutcome}[];profiles:{browser:'safari'|'chrome';rows:Row[]}[]};
const audit=JSON.parse(readFileSync(new URL('../packages/vo-corpus/test/list-profiles-transfer-input-audit.json',import.meta.url),'utf8')) as {profiles:{browser:string;rows:{caseId:string;step:number;evaluation:{eligible:boolean}}[]}[]};
it.each(fixture.profiles)('replays $browser dynamic-list tasks while retaining unmeasured Native target windows',async profile=>{
 const browser=await launchTestBrowser();let actions=0,eligible=0,unmeasuredTargets=0,fields=0,presence=0;
 try{for(const c of fixture.pages){const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,900,profile.browser);
  try{await page.setContent(c.html);await page.bringToFront();await page.locator('#before').focus();await backend.start();backend.attachSession({page});await backend.observe();await backend.execute({kind:'intent',intent:'readCurrent'});await backend.observe();
   expect(evaluateTaskOutcome(c.taskOutcome,await fixturePageState(page)).status).not.toBe('success');const cdp=await context.newCDPSession(page);
   for(const row of profile.rows.filter(r=>r.caseId===c.id)){
    await backend.execute({kind:'key',key:row.chord});const observation=await backend.observe(),diagnostic=backend.getSpeechInputObservation()!;expect(diagnostic.windowId).toBe(observation.windowId);expect(diagnostic.events).toHaveLength(1);
    const event=diagnostic.events[0]!;if(event.kind==='activation')expect(event.status).toBe('modeled');
    const target=event.input.target as typeof event.input.target & {backendDOMNodeId:number};
    const {object}=await cdp.send('DOM.resolveNode',{backendNodeId:target.backendDOMNodeId}),resolved=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId!,functionDeclaration:'function(){return this.id}',returnByValue:true});await cdp.send('Runtime.releaseObject',{objectId:object.objectId!});expect(resolved.result.value).toBe(row.rendererDOMId);
    expect(target.semantic).toEqual(row.verificationInput.target.semantic);
    const scopes=(target:{containers?:readonly {role:string;name:string;items:number}[]})=>(target.containers??[]).map(s=>({role:s.role,name:s.name,...s.role==='list'?{items:s.items}:{}}));expect(scopes(target)).toEqual(scopes(row.verificationInput.target));
    const valid=audit.profiles.find(p=>p.browser===profile.browser)!.rows.find(r=>r.caseId===c.id&&r.step===row.step)!.evaluation.eligible;
    // Equality on unmeasured Native windows is a diagnostic regression, never an added accuracy success.
    expect(observation.speech,`${c.id} ${row.step}${valid?' scored':' diagnostic only'}`).toEqual(row.utterances.map(u=>u.text));if(valid)eligible++;if(row.readingTarget.status==='unmeasured')unmeasuredTargets++;
    const state=await fixturePageState(page);expect(state.objectErrors??[]).toEqual([]);expect(state.focusId).toBe(row.keyboardFocus.native);
    for(const f of row.stateFields.filter(f=>f.status==='matched')){const controls=state.objects!.filter(o=>o.role===f.role&&o.name===f.name);expect(controls).toHaveLength(1);expect((controls[0]!.state as Record<string,unknown>)[f.key]).toEqual(f.native);fields++;}
    for(const f of row.controlPresence){expect(f.status).toBe('matched');expect(state.objects!.some(o=>o.role===f.role&&o.name===f.name)).toBe(f.native);presence++;}actions++;
   }
   expect(evaluateTaskOutcome(c.taskOutcome,await fixturePageState(page)).status).toBe('success');await cdp.detach();
  }finally{await backend.close();await context.close();}
 }}finally{await browser.close();}
 expect({actions,eligible,unmeasuredTargets,fields,presence}).toEqual({actions:28,eligible:24,unmeasuredTargets:2,fields:50,presence:56});
},120000);
