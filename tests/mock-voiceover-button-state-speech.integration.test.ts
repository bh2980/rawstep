import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {launchTestBrowser} from './helpers/browser.js';
import {MockVoiceOverBackend} from '@rawstep/screenreaders/mock-voiceover/backend';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-button-state-speech-2026-10-15.json',import.meta.url),'utf8')) as {
 pages:{id:string;html:string}[];profiles:{browser:'safari'|'chrome';rows:{caseId:string;chord:string;utterances:{text:string}[]}[]}[];
};
it.each(fixture.profiles)('shares ordered button activation receipts with the $browser adapter',async profile=>{
 const browser=await launchTestBrowser();
 for(const c of fixture.pages){
  const page=await browser.newPage(),backend=new MockVoiceOverBackend(undefined,850,profile.browser);
  try{
   await page.setContent(c.html);await page.locator('#before').focus();await backend.start();backend.attachSession({page});await backend.observe();
   for(const row of profile.rows.filter(r=>r.caseId===c.id)){
    await backend.execute({kind:'key',key:row.chord});
    const observed=await backend.observe();
    expect(observed.speech).toEqual(row.utterances.map(u=>u.text));
   }
  }finally{await backend.close();await page.close();}
 }
},60000);
