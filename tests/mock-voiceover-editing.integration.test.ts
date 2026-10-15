import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {MockVoiceOverBackend,formatVoiceOverEditing} from 'rawstep/mock-voiceover';
import {launchTestBrowser} from './helpers/browser.js';
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/voiceover-evidence/native-practical-speech-tasks-2026-10-16.json.gz',import.meta.url))).toString()) as {pages:any[];profiles:{browser:'safari'|'chrome';rows:any[]}[]};

it.each(fixture.profiles)('$browser external editing API reproduces actual adapter inputs without changing the search task receipts',async p=>{
 const browser=await launchTestBrowser(),context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,900,p.browser);
 const policyEvents:unknown[]=[];backend.subscribe(e=>policyEvents.push(e));let edits=0;
 try{
  const c=fixture.pages.find((c:any)=>c.id.endsWith('support-search'));
  await page.setContent(c.html);await page.bringToFront();await page.locator('#before').focus();await backend.start();backend.attachSession({page});await backend.observe();
  await backend.execute({kind:'intent',intent:'readCurrent'});await backend.observe();
  for(const row of p.rows.filter((r:any)=>r.caseId===c.id)){
   const key=row.chord==='Left'?'ArrowLeft':row.chord==='Right'?'ArrowRight':row.chord;
   await backend.execute(key.length===1?{kind:'typeText',text:key}:{kind:'key',key});
   const observation=await backend.observe(),diagnostic=backend.getSpeechInputObservation()!;
   expect(diagnostic.protocol).toBe('mock-speech-inputs-v2');expect(diagnostic.windowId).toBe(observation.windowId);
   expect(observation.speech,`original predicted receipts at ${row.step}`).toEqual(row.prediction.utterances);
   for(const event of diagnostic.events.filter(e=>e.kind==='editing')){
    expect(event.status).toBe('approximation');const result=formatVoiceOverEditing(event.input,event.previousContext);
    if(result.status!=='approximation')throw new Error(result.reason);
    expect(result.utterances).toEqual(observation.speech);edits++;
    event.input.after.value='mutated';expect(JSON.stringify(backend.getSpeechInputObservation())).not.toContain('mutated');
   }
  }
  expect(edits).toBe(5);expect(await page.locator('#query').inputValue()).toBe('map');
  expect(JSON.stringify(policyEvents)).not.toContain('mock-speech-inputs-');
  await backend.close();expect(backend.getSpeechInputObservation()).toBeUndefined();
 }finally{await backend.close();await context.close();await browser.close();}
},60000);

it('retains unsupported editing input when a page rewrites the typed value',async()=>{
 const browser=await launchTestBrowser(),page=await browser.newPage(),backend=new MockVoiceOverBackend(undefined,0);
 try{
  await page.setContent('<input aria-label="Code" oninput="this.value=this.value.toUpperCase()">');await page.bringToFront();
  await backend.start();backend.attachSession({page});await backend.observe();await backend.execute({kind:'key',key:'Tab'});await backend.observe();
  await backend.execute({kind:'typeText',text:'r'});await backend.observe();
  const event=backend.getSpeechInputObservation()!.events.find(e=>e.kind==='editing');
  expect(event).toMatchObject({kind:'editing',status:'unsupported',input:{text:'r',before:{value:''},after:{value:'R'}}});
  if(event?.kind!=='editing')throw new Error('Missing editing observation');
  expect(formatVoiceOverEditing(event.input,event.previousContext)).not.toHaveProperty('utterances');
 }finally{await backend.close();await browser.close();}
});
