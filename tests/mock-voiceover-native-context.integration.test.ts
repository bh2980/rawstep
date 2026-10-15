import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {MockVoiceOverBackend,type MockVoiceOverReferenceBrowser} from '@rawstep/screenreaders/mock-voiceover';
import {normalize} from '../packages/vo-corpus/src/compare.js';

type Fixture={
  inputs:{id:string;html:string;htmlSha256:string}[];
  nativeProfiles:{referenceBrowser:MockVoiceOverReferenceBrowser;sourceRecordsSha256:string;
    cases:{id:string;assertFullSpeech:boolean;steps:{chord:string;keyboardFocusId:string;utterances:{text:string}[]}[]}[]}[];
};
const fixture=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-context-return-2026-10-15.json',import.meta.url),'utf8')) as Fixture;
const cases=fixture.nativeProfiles.flatMap(p=>p.cases.map(c=>({...c,referenceBrowser:p.referenceBrowser,sourceHash:p.sourceRecordsSha256,input:fixture.inputs.find(i=>i.id===c.id)!})));
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.RAWSTEP_TEST_BROWSER_PATH?{executablePath:process.env.RAWSTEP_TEST_BROWSER_PATH}:{})});});
afterAll(async()=>{await browser?.close();});

describe('native nearest-context calibration workflows',()=>{
  it.each(cases)('$referenceBrowser $id preserves keyboard focus and calibrated context receipts',async c=>{
    expect(createHash('sha256').update(c.input.html).digest('hex')).toBe(c.input.htmlSha256);
    expect(c.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,undefined,c.referenceBrowser);
    try{
      await page.setContent(c.input.html);await page.bringToFront();await page.locator('#before').focus();
      await backend.start();backend.attachSession({page});await backend.observe();
      await backend.execute({kind:'intent',intent:'readCurrent'});await backend.observe();
      for(const [index,step]of c.steps.entries()){
        await backend.execute({kind:'key',key:step.chord});
        const actual=await backend.observe();
        expect(await page.evaluate(()=>document.activeElement?.id),`${c.id} focus ${index}`).toBe(step.keyboardFocusId);
        // Chrome's unnamed-article naming is unresolved; retain its raw receipts and failures in corpus reports.
        if(c.assertFullSpeech)expect(normalize(actual.speech.join(' ')),`${c.id} speech ${index}`).toBe(normalize(step.utterances.map(u=>u.text).join(' ')));
      }
    }finally{await backend.close();await context.close();}
  },30000);
});
