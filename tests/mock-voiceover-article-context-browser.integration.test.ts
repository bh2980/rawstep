import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {launchTestBrowser} from './helpers/browser.js';
import {MockVoiceOverBackend} from '@rawstep/screenreaders/mock-voiceover/backend';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-article-entry-child-v2-2026-10-15.json',import.meta.url),'utf8')) as {
 pages:{id:string;html:string}[];profiles:{browser:'safari'|'chrome';rows:{caseId:string;chord:string;input:{target:{identity:string;semantic:{checked?:boolean;pressed?:boolean|'mixed';expanded?:boolean}}};evaluation:{nativeMain:string}}[]}[];
};
it.each(fixture.profiles)('passes the calibrated $browser article speech through actual browser controls',async profile=>{
 const browser=await launchTestBrowser();
 for(const scenario of fixture.pages){
  const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,0,profile.browser);
  try{
   await page.setContent(scenario.html);await page.bringToFront();await backend.start();backend.attachSession({page});await backend.observe();
   await page.locator('#before').focus();await backend.observe();
   for(const row of profile.rows.filter(r=>r.caseId===scenario.id)){
    await backend.execute({kind:'key',key:row.chord});const observation=await backend.observe();
    const main=observation.outputs.filter(o=>(o.raw as {announcement?:string})?.announcement!=='usage-hint').map(o=>o.text).join(' ');
    expect(main,`${scenario.id} ${row.chord}`).toBe(row.evaluation.nativeMain);
    expect(await page.evaluate(()=>document.activeElement?.id)).toBe(row.input.target.identity);
    const target=page.locator('#'+row.input.target.identity),state=row.input.target.semantic;
    if(state.checked!==undefined)expect(await target.isChecked()).toBe(state.checked);
    for(const key of ['pressed','expanded'] as const)if(state[key]!==undefined)expect(await target.getAttribute('aria-'+key)).toBe(String(state[key]));
   }
  }finally{await backend.close();await context.close();}
 }
});
