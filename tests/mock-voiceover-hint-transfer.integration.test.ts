import {readFileSync} from 'node:fs';import {expect,it} from 'vitest';
import {MockVoiceOverBackend,type VoiceOverSpeechTarget} from 'rawstep/mock-voiceover';
import {fixturePageState} from '../packages/vo-corpus/src/state.js';import {evaluateTaskOutcome,type TaskOutcome} from '../packages/vo-corpus/src/task-outcomes.js';import {replayAction} from '../packages/vo-corpus/src/replay.js';import {launchTestBrowser} from './helpers/browser.js';
type Row={caseId:string;step:number;chord:string;rendererDOMId:string;verificationInput:{target:VoiceOverSpeechTarget};utterances:{text:string}[];readingTarget:{status:string};keyboardFocus:{native:string};stateFields:{role:string;name:string;key:string;status:string;native:unknown}[]};
for(const cohort of ['transfer']){
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-hint-context-transfer-2026-10-16.json',import.meta.url),'utf8')) as {pages:{id:string;html:string;taskOutcome:TaskOutcome}[];profiles:{browser:'safari'|'chrome';rows:Row[]}[]};
 it.each(fixture.profiles)(`replays $browser actual hint/task inputs, state and Native receipts for ${cohort}`,async p=>{
  const browser=await launchTestBrowser();let actions=0;
  try{for(const c of fixture.pages){const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,900,p.browser);
   try{await page.setContent(c.html);await page.bringToFront();await page.locator('#before').focus();await backend.start();backend.attachSession({page});await backend.observe();await backend.execute({kind:'intent',intent:'readCurrent'});await backend.observe();const cdp=await context.newCDPSession(page);
    for(const r of p.rows.filter(r=>r.caseId===c.id)){
     expect(r.readingTarget.status).toBe('matched');const action=replayAction(r.chord,`stroke-${r.step}`);if(!action||action.kind!=='key'&&action.kind!=='intent')throw new Error('This corpus requires a declared key or intent');await backend.execute(action);const observation=await backend.observe(),diagnostic=backend.getSpeechInputObservation()!;expect(diagnostic.windowId).toBe(observation.windowId);expect(diagnostic.events).toHaveLength(1);
     const event=diagnostic.events[0]!;if(event.kind==='activation')expect(event.status).toBe('modeled');const target=event.input.target as typeof event.input.target&{backendDOMNodeId:number},original=r.verificationInput.target;
     const {object}=await cdp.send('DOM.resolveNode',{backendNodeId:target.backendDOMNodeId}),resolved=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId!,functionDeclaration:'function(){return this.id}',returnByValue:true});await cdp.send('Runtime.releaseObject',{objectId:object.objectId!});expect(resolved.result.value).toBe(r.rendererDOMId);
     expect(target.semantic).toEqual(original.semantic);const cell=(t:VoiceOverSpeechTarget)=>t.cell&&(({table,...fields})=>fields)(t.cell);expect(cell(target)).toEqual(cell(original));
     const scopes=(t:VoiceOverSpeechTarget)=>(t.containers??[]).map(s=>({role:s.role,name:s.name,...s.role==='table'?{rows:s.rows,columns:s.columns}:{}}));expect(scopes(target)).toEqual(scopes(original));
     expect(observation.speech,`${c.id} ${r.step}`).toEqual(r.utterances.map(u=>u.text));const state=await fixturePageState(page);expect(state.objectErrors??[]).toEqual([]);expect(state.focusId).toBe(r.keyboardFocus.native);
     for(const f of r.stateFields){expect(f.status).toBe('matched');const controls=state.objects!.filter(o=>o.role===f.role&&o.name===f.name);expect(controls).toHaveLength(1);expect((controls[0]!.state as Record<string,unknown>)[f.key]).toEqual(f.native);}actions++;
    }
    expect(evaluateTaskOutcome(c.taskOutcome,await fixturePageState(page)).status).toBe('success');await cdp.detach();
   }finally{await backend.close();await context.close();}
  }}finally{await browser.close();}expect(actions).toBe(24);
 },120000);
}
