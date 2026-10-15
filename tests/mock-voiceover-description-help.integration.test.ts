import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {MockVoiceOverBackend,type VoiceOverSpeechTarget} from 'rawstep/mock-voiceover';
import {fixturePageState} from '../packages/vo-corpus/src/state.js';
import {evaluateTaskOutcome,type TaskOutcome} from '../packages/vo-corpus/src/task-outcomes.js';
import {launchTestBrowser} from './helpers/browser.js';
type Row={caseId:string;step:number;chord:string;rendererDOMId:string;keyboardFocus:{native:string};utterances:{text:string}[];stateFields:{role:string;name:string;key:string;native:unknown}[];evaluation:{inputVerification:{observedScopes:unknown[]}}};
type Fixture={pages:{id:string;html:string;taskOutcome:TaskOutcome}[];profiles:{browser:'safari'|'chrome';rows:Row[]}[]};
const audit=JSON.parse(readFileSync(new URL('../packages/vo-corpus/test/description-help-input-audit.json',import.meta.url),'utf8')) as {cohorts:{name:string;profiles:{browser:string;rows:{caseId:string;step:number;observedSemantic:{description:string;help:string;hasMoreContent:boolean}}[]}[]}[]};

for(const name of ['dialog-compositions','description-help-combinations']){
 const fixture=JSON.parse(readFileSync(new URL(`./fixtures/voiceover-evidence/native-${name}-2026-10-16.json`,import.meta.url),'utf8')) as Fixture;
 it.each(fixture.profiles)(`checks corrected $browser actual inputs and Native receipts for ${name}`,async profile=>{
  const browser=await launchTestBrowser();let actions=0,literalFull=0,fields=0;
  const source=audit.cohorts.find(c=>c.name===name)!.profiles.find(p=>p.browser===profile.browser)!;
  try{for(const c of fixture.pages){const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,900,profile.browser);
   try{
    await page.setContent(c.html);await page.bringToFront();await page.locator('#before').focus();await backend.start();backend.attachSession({page});await backend.observe();await backend.execute({kind:'intent',intent:'readCurrent'});await backend.observe();
    const cdp=await context.newCDPSession(page);
    for(const row of profile.rows.filter(r=>r.caseId===c.id)){
     await backend.execute({kind:'key',key:row.chord});const observation=await backend.observe(),diagnostic=backend.getSpeechInputObservation()!;
     expect(diagnostic.windowId).toBe(observation.windowId);expect(diagnostic.events).toHaveLength(1);
     const event=diagnostic.events[0]!;if(event.kind==='activation')expect(event.status).toBe('modeled');
     const target=event.input.target as VoiceOverSpeechTarget&{backendDOMNodeId:number},resolved=await cdp.send('DOM.resolveNode',{backendNodeId:target.backendDOMNodeId});
     expect(resolved.object.objectId).toBeTruthy();const result=await cdp.send('Runtime.callFunctionOn',{objectId:resolved.object.objectId!,functionDeclaration:'function(){return this.id}',returnByValue:true});await cdp.send('Runtime.releaseObject',{objectId:resolved.object.objectId!});
     expect(result.result.value).toBe(row.rendererDOMId);
     const observed=source.rows.find(r=>r.caseId===c.id&&r.step===row.step)!.observedSemantic;
     expect({role:target.semantic.role,name:target.semantic.name,description:target.semantic.description??'',help:target.semantic.help??'',hasMoreContent:target.semantic.hasMoreContent??false}).toEqual(observed);
     expect((target.containers??[]).map(s=>({role:s.role,name:s.name,...s.role==='dialog'?{items:s.items}:{}}))).toEqual(row.evaluation.inputVerification.observedScopes);
     const native=row.utterances.map(u=>u.text);
     if(JSON.stringify(observation.speech)===JSON.stringify(native))literalFull++;
     // Known Native title-help receipt space remains in the separate literal Full count.
     expect(observation.speech,`${c.id} ${row.step}`).toEqual(native.map(s=>s.trimEnd()));
     const state=await fixturePageState(page);expect(state.objectErrors??[]).toEqual([]);expect(state.focusId).toBe(row.keyboardFocus.native);
     for(const f of row.stateFields){const controls=state.objects!.filter(o=>o.role===f.role&&o.name===f.name);expect(controls).toHaveLength(1);expect((controls[0]!.state as Record<string,unknown>)[f.key]).toEqual(f.native);fields++;}actions++;
    }
    expect(evaluateTaskOutcome(c.taskOutcome,await fixturePageState(page)).status).toBe('success');await cdp.detach();
   }finally{await backend.close();await context.close();}
  }}finally{await browser.close();}
  const expected=name==='dialog-compositions'?{actions:39,literalFull:profile.browser==='safari'?36:39,fields:97}:{actions:15,literalFull:profile.browser==='safari'?7:13,fields:15};
  expect({actions,literalFull,fields}).toEqual(expected);
  process.stdout.write('VO_PROJECTION_REGRESSION '+JSON.stringify({cohort:name,browser:profile.browser,...expected,fullContent:actions,actualInputVerified:actions})+'\n');
 },120000);
}
