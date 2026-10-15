import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {launchTestBrowser} from './helpers/browser.js';
import {MockVoiceOverBackend} from '@rawstep/screenreaders/mock-voiceover/backend';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-dialog-observed-inputs-2026-10-15.json',import.meta.url),'utf8')) as {
 pages:{id:string;html:string}[];profiles:{browser:'safari'|'chrome';rows:{caseId:string;step:number;chord:string;changedFromAuthoredTarget:boolean;originalTarget:{identity:string};baselineEvaluation:{nativeMain:string}}[]}[];
};
it.each(fixture.profiles)('checks $browser dialog speech and explicitly retains Safari native-dialog target differences',async profile=>{
 const browser=await launchTestBrowser();let matches=0;const differences:{caseId:string;step:number}[]=[];
 for(const c of fixture.pages){
  const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,0,profile.browser);
  try{
   await page.setContent(c.html);await page.bringToFront();await backend.start();backend.attachSession({page});await backend.observe();await page.locator('#before').focus();await backend.observe();
   for(const row of profile.rows.filter(r=>r.caseId===c.id)){
    await backend.execute({kind:'key',key:row.chord});const observation=await backend.observe();
    expect(await page.evaluate(()=>document.activeElement?.id)).toBe(row.originalTarget.identity);
    const main=observation.outputs.filter(o=>(o.raw as {announcement?:string})?.announcement!=='usage-hint').map(o=>o.text).join(' ');
    if(row.changedFromAuthoredTarget){expect(main).not.toBe(row.baselineEvaluation.nativeMain);differences.push({caseId:row.caseId,step:row.step});}
    else{expect(main,`${c.id} ${row.step}`).toBe(row.baselineEvaluation.nativeMain);matches++;}
   }
  }finally{await backend.close();await context.close();}
 }
 expect(matches).toBe(profile.browser==='safari'?24:29);
 expect(differences).toEqual(profile.browser==='safari'?[0,1,2,3,4].map(step=>({caseId:'dialog-speech-v1.native-open',step})):[]);
});
