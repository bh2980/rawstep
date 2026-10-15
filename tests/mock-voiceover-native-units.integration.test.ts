import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {MockVoiceOverBackend,type MockVoiceOverReferenceBrowser} from '@rawstep/screenreaders/mock-voiceover';
import {normalize} from '../packages/vo-corpus/src/compare.js';

type NativeFixture={
  sourceRecordsSha256:string;cases:{sourceCaseId:string;html:string;htmlSha256:string;steps:{chord:string;utterances:{t:number;text:string}[]}[]}[];
};
const native=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-reading-units-2026-10-15.json',import.meta.url),'utf8')) as NativeFixture;
const chrome=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-chrome-controls-2026-10-15.json',import.meta.url),'utf8')) as NativeFixture;
const cases=([{fixture:native,referenceBrowser:'safari'},{fixture:chrome,referenceBrowser:'chrome'}] as const).flatMap(({fixture,referenceBrowser})=>fixture.cases.map(c=>({...c,referenceBrowser,sourceRecordsSha256:fixture.sourceRecordsSha256})));
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.RAWSTEP_TEST_BROWSER_PATH?{executablePath:process.env.RAWSTEP_TEST_BROWSER_PATH}:{})});});
afterAll(async()=>{await browser?.close();});

describe('native reading-unit workflow receipts replayed in real Chromium',()=>{
  it.each(cases)('preserves full speech for $referenceBrowser $sourceCaseId',async c=>{
    expect(createHash('sha256').update(c.html).digest('hex')).toBe(c.htmlSha256);
    expect(c.sourceRecordsSha256).toMatch(/^[a-f0-9]{64}$/);
    const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,undefined,c.referenceBrowser as MockVoiceOverReferenceBrowser);
    try{
      await page.setContent(c.html);await page.bringToFront();await backend.start();backend.attachSession({page});
      await backend.observe();await backend.execute({kind:'intent',intent:'readCurrent'});
      expect((await backend.observe()).speech.join(' ')).toContain('Before marker');
      for(const [index,step]of c.steps.entries()){
        if(step.chord==='Space')await backend.execute({kind:'key',key:'Space'});
        else if(['VO+Right','VO+Left','VO+Space'].includes(step.chord))await backend.execute({kind:'intent',intent:step.chord==='VO+Right'?'next':step.chord==='VO+Left'?'previous':'activate'});
        else throw new Error('Unmapped native fixture chord');
        const actual=await backend.observe();
        expect(normalize(actual.speech.join(' ')),`${c.sourceCaseId} step ${index}`).toBe(normalize(step.utterances.map(u=>u.text).join(' ')));
        for(const output of actual.outputs)expect(output.raw).toMatchObject({evidenceProvenance:'simulation'});
      }
    }finally{await backend.close();await context.close();}
  },30000);
});
