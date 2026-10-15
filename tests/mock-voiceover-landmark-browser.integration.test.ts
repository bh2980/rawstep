import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {launchTestBrowser} from './helpers/browser.js';
import {MockVoiceOverBackend} from '@rawstep/screenreaders/mock-voiceover/backend';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-landmark-speech-2026-10-15.json',import.meta.url),'utf8')) as {
 pages:{id:string;html:string}[];profiles:{browser:'safari'|'chrome';rows:{caseId:string;chord:string;input:{target:{identity:string}};utterances:{text:string}[]}[]}[];
};
it.each(fixture.profiles)('preserves unnamed banner/footer input through the browser adapter for $browser speech',async profile=>{
 const browser=await launchTestBrowser();
 for(const scenario of fixture.pages.filter(p=>p.id.endsWith('banner-unnamed')||p.id.endsWith('contentinfo-unnamed'))){
  const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,0,profile.browser);
  try{
   await page.setContent(scenario.html);await page.bringToFront();await backend.start();backend.attachSession({page});await backend.observe();
   await page.locator('#before').focus();await backend.observe();
   for(const row of profile.rows.filter(r=>r.caseId===scenario.id)){
    await backend.execute({kind:'key',key:row.chord});const observation=await backend.observe();
    expect(observation.speech.filter(s=>!s.startsWith('You are currently')),scenario.id).toEqual([row.utterances[0]!.text]);
    expect(await page.evaluate(()=>document.activeElement?.id)).toBe(row.input.target.identity);
   }
  }finally{await backend.close();await context.close();}
 }
});
