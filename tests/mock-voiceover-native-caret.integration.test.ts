import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {chromium,type Browser} from 'playwright';
import {MockVoiceOverBackend} from '@rawstep/screenreaders/mock-voiceover';
import {normalize,splitSpeech} from '../packages/vo-corpus/src/compare.js';

type Case={sourceCaseId:string;html:string;htmlSha256:string;assertedSteps:number[];steps:{chord:string;utterances:{text:string}[]}[]};
const native=JSON.parse(readFileSync(new URL('./fixtures/voiceover-evidence/native-chrome-caret-2026-10-15.json',import.meta.url),'utf8')) as {cases:Case[]};
let browser:Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.RAWSTEP_TEST_BROWSER_PATH?{executablePath:process.env.RAWSTEP_TEST_BROWSER_PATH}:{})});});
afterAll(async()=>{await browser?.close();});

it.each(native.cases)('reproduces observed caret context on Chrome field entry/return: $sourceCaseId',async c=>{
  expect(createHash('sha256').update(c.html).digest('hex')).toBe(c.htmlSha256);
  const context=await browser.newContext(),page=await context.newPage(),backend=new MockVoiceOverBackend(undefined,0,'chrome');
  try{
    await page.setContent(c.html);await page.bringToFront();await page.locator('#before').focus();
    await backend.start();backend.attachSession({page});await backend.observe();
    for(const [index,step]of c.steps.entries()){
      const chord=step.chord;
      if(chord==='VO+Right'||chord==='VO+Left')await backend.execute({kind:'intent',intent:chord==='VO+Right'?'next':'previous'});
      else if(chord.length===1)await backend.execute({kind:'typeText',text:chord});
      else await backend.execute({kind:'key',key:chord==='Left'?'ArrowLeft':chord==='Right'?'ArrowRight':chord});
      const actual=await backend.observe();
      if(c.assertedSteps.includes(index))expect(normalize(splitSpeech(actual.speech.map(text=>({text}))).main),`step ${index}`).toBe(normalize(splitSpeech(step.utterances).main));
    }
  }finally{await backend.close();await context.close();}
},30000);
