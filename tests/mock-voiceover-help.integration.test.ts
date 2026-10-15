import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {launchTestBrowser} from './helpers/browser.js';
import {MockVoiceOverBackend} from '@rawstep/screenreaders/mock-voiceover/backend';
const evidence=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-additional-content-2026-10-15.json',import.meta.url),'utf8')) as {
 pages:{id:string;html:string}[];profiles:{browser:'safari'|'chrome';rows:{caseId:string;chord:string;utterances:{text:string}[]}[]}[];
};
it.each(evidence.profiles)('projects DOM description sources into the $browser speech profile using Native calibration pages',async profile=>{
 const browser=await launchTestBrowser();
 for(const fixture of evidence.pages){
  const page=await browser.newPage(),backend=new MockVoiceOverBackend(undefined,850,profile.browser);
  try{
   await page.setContent(fixture.html);await page.locator('#before').focus();
   await backend.start();backend.attachSession({page});await backend.observe();
   for(const row of profile.rows.filter(r=>r.caseId===fixture.id)){
    await backend.execute({kind:'key',key:row.chord});
    const actual=(await backend.observe()).speech;
    expect(actual).toEqual(row.utterances.map(u=>u.text));
   }
  }finally{await backend.close();await page.close();}
 }
},30000);
