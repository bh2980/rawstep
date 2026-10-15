import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {MockVoiceOverBackend,type VoiceOverSpeechTarget} from 'rawstep/mock-voiceover';
import {fixturePageState} from '../packages/vo-corpus/src/state.js';
import {evaluateTaskOutcome,type TaskOutcome} from '../packages/vo-corpus/src/task-outcomes.js';
import {launchTestBrowser} from './helpers/browser.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-dialog-transfer-2026-10-15.json',import.meta.url),'utf8')) as {
 pages:{id:string;html:string;taskOutcome:TaskOutcome}[];
 profiles:{browser:'safari'|'chrome';rows:{caseId:string;step:number;chord:string;rendererDOMId:string;utterances:{text:string}[];stateFields:{role:string;name:string;key:string;native:unknown}[];evaluation:{inputVerification:{observedScopes:unknown[]}}}[]}[];
};
it.each(fixture.profiles)('checks current $browser actual inputs, full receipts and task states against Native regression',async profile=>{
 const browser=await launchTestBrowser();let actions=0,fields=0;
 for(const c of fixture.pages){const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,900,profile.browser);
  try{
   await page.setContent(c.html);await page.bringToFront();await page.locator('#before').focus();await backend.start();backend.attachSession({page});await backend.observe();await backend.execute({kind:'intent',intent:'readCurrent'});await backend.observe();
   const cdp=await context.newCDPSession(page);
   for(const row of profile.rows.filter(r=>r.caseId===c.id)){
    await backend.execute({kind:'key',key:row.chord});const observation=await backend.observe(),diagnostic=backend.getSpeechInputObservation()!;
    expect(diagnostic.windowId).toBe(observation.windowId);expect(diagnostic.events).toHaveLength(1);const input=diagnostic.events[0]!.input;
    const target=input.target as VoiceOverSpeechTarget&{backendDOMNodeId:number},resolved=await cdp.send('DOM.resolveNode',{backendNodeId:target.backendDOMNodeId});
    expect(resolved.object.objectId).toBeTruthy();const result=await cdp.send('Runtime.callFunctionOn',{objectId:resolved.object.objectId!,functionDeclaration:'function(){return this.id}',returnByValue:true});await cdp.send('Runtime.releaseObject',{objectId:resolved.object.objectId!});
    expect(result.result.value).toBe(row.rendererDOMId);
    expect((target.containers??[]).map(c=>({role:c.role,name:c.name,...c.role==='dialog'?{items:c.items}:{}}))).toEqual(row.evaluation.inputVerification.observedScopes);
    expect(observation.speech,`${c.id} ${row.step}`).toEqual(row.utterances.map(u=>u.text));
    const state=await fixturePageState(page);expect(state.objectErrors??[]).toEqual([]);
    for(const f of row.stateFields){const controls=state.objects!.filter(o=>o.role===f.role&&o.name===f.name);expect(controls).toHaveLength(1);expect((controls[0]!.state as Record<string,unknown>)[f.key]).toEqual(f.native);fields++;}actions++;
   }
   expect(evaluateTaskOutcome(c.taskOutcome,await fixturePageState(page)).status).toBe('success');await cdp.detach();
  }finally{await backend.close();await context.close();}
 }
 expect({actions,fields}).toEqual({actions:40,fields:82});
},90000);
