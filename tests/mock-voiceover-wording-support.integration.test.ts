import {expect,it} from 'vitest';
import {MockVoiceOverBackend} from 'rawstep/mock-voiceover';
import {launchTestBrowser} from './helpers/browser.js';

it.each(['safari','chrome'] as const)('distinguishes %s modeled activation from approximate fallback and Native parity',async referenceBrowser=>{
 const browser=await launchTestBrowser(),page=await browser.newPage(),backend=new MockVoiceOverBackend(undefined,850,referenceBrowser);
 try{
  await page.setContent(`<button id="before">Before</button><button aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">Enable notes</button><button aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');this.textContent='Close results'">Open results</button>`);
  await page.locator('#before').focus();await backend.start();backend.attachSession({page});await backend.observe();
  await backend.execute({kind:'key',key:'Tab'});const reading=await backend.observe();
  expect(reading.outputs.length).toBeGreaterThan(0);
  for(const output of reading.outputs)expect(output.raw).toMatchObject({wordingEvidence:{status:'approximation',nativeParityEstablished:false}});
  await backend.execute({kind:'key',key:'Space'});const activation=await backend.observe();
  expect(backend.getSpeechInputObservation()!.events[0]).toMatchObject({kind:'activation',status:'modeled'});
  expect(activation.speech).toEqual(referenceBrowser==='chrome'?['selected Enable notes toggle button']:[]);
  for(const output of activation.outputs)expect(output.raw).toMatchObject({wordingEvidence:{status:'modeled',nativeParityEstablished:false}});
  await backend.execute({kind:'key',key:'Tab'});await backend.observe();await backend.execute({kind:'key',key:'Space'});
  const fallback=await backend.observe(),event=backend.getSpeechInputObservation()!.events[0]!;
  expect(event).toMatchObject({kind:'activation',status:'unsupported',reason:'Activation target changed'});
  expect(fallback.speech.slice(0,2)).toEqual(['Close results expanded button','Close results expanded button']);
  for(const output of fallback.outputs)expect(output.raw).toMatchObject({wordingEvidence:{status:'approximation',nativeParityEstablished:false}});
  if(event.kind==='activation')event.reason='mutated';
  expect(JSON.stringify(backend.getSpeechInputObservation())).not.toContain('mutated');
 }finally{await backend.close();await page.close();}
},15000);
