import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {launchTestBrowser} from './helpers/browser.js';
import {MockVoiceOverBackend} from '@rawstep/screenreaders/mock-voiceover/backend';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-checkbox-speech-2026-10-15.json',import.meta.url),'utf8')) as {
 pages:{id:string;html:string}[];profiles:{browser:'safari'|'chrome';rows:{caseId:string;chord:string;utterances:{text:string}[]}[]}[];
};
it.each(fixture.profiles)('shares controlled checkbox speech rules with the $browser Chromium adapter',async profile=>{
 const browser=await launchTestBrowser();
 for(const c of fixture.pages){
  const page=await browser.newPage(),backend=new MockVoiceOverBackend(undefined,850,profile.browser);
  try{
   await page.setContent(c.html);await page.locator('#before').focus();await backend.start();backend.attachSession({page});await backend.observe();
   for(const row of profile.rows.filter(r=>r.caseId===c.id)){
    await backend.execute(row.chord==='VO+Space'?{kind:'intent',intent:'activate'}:{kind:'key',key:row.chord});
    expect((await backend.observe()).speech).toEqual(row.utterances.map(u=>u.text));
   }
  }finally{await backend.close();await page.close();}
 }
},75000);
