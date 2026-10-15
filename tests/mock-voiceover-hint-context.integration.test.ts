import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {MockVoiceOverBackend} from 'rawstep/mock-voiceover';
import {replayAction} from '../packages/vo-corpus/src/replay.js';
import {launchTestBrowser} from './helpers/browser.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-hint-source-context-2026-10-16.json',import.meta.url),'utf8')) as {profiles:{browser:'safari'|'chrome';rows:any[]}[];pages:{id:string;html:string}[]};

it.each(fixture.profiles)('$browser replays all actual-input hint contrasts against literal Native receipts',async p=>{
 const browser=await launchTestBrowser();let compared=0;
 try{for(const c of fixture.pages){
  const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,900,p.browser);
  try{
   await page.setContent(c.html);await page.bringToFront();await page.locator('#before').focus();await backend.start();backend.attachSession({page});await backend.observe();await backend.execute({kind:'intent',intent:'readCurrent'});await backend.observe();
   for(const r of p.rows.filter((r:any)=>r.caseId===c.id)){
    expect(r.readingTarget.status).toBe('matched');const action=replayAction(r.chord,`stroke-${r.step}`);if(!action||action.kind!=='key'&&action.kind!=='intent')throw new Error('Fixture requires a key or intent');await backend.execute(action);
    const observation=await backend.observe(),diagnostic=backend.getSpeechInputObservation()!;expect(diagnostic.windowId).toBe(observation.windowId);expect(diagnostic.events).toHaveLength(1);
    const semantic=diagnostic.events[0]!.input.target.semantic;
    expect(semantic.name).toBe(r.verificationInput.target.semantic.name);
    expect(observation.speech,`${c.id} step ${r.step}`).toEqual(r.utterances.map((u:{text:string})=>u.text));compared++;
   }
  }finally{await backend.close();await context.close();}
 }}finally{await browser.close();}
 expect(compared).toBe(30);
},120000);
