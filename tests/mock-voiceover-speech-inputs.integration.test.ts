import {expect,it} from 'vitest';
import {MockVoiceOverBackend,formatVoiceOverSpeech,formatVoiceOverActivation} from '@rawstep/screenreaders/mock-voiceover';
import {launchTestBrowser} from './helpers/browser.js';

it.each(['safari','chrome'] as const)('retains actual %s speech inputs per window outside policy observations',async referenceBrowser=>{
 const browser=await launchTestBrowser(),page=await browser.newPage(),backend=new MockVoiceOverBackend(undefined,0,referenceBrowser);
 const policyEvents:unknown[]=[];backend.subscribe(event=>policyEvents.push(event));
 try{
  await page.setContent('<button id="before">Before</button><section aria-label="Preferences"><button id="save">Save</button><label><input id="updates" type="checkbox">Updates</label><input id="password" type="password" aria-label="Password" value="private-secret"></section>');
  await page.bringToFront();await page.locator('#before').focus();await backend.start();backend.attachSession({page});
  expect(backend.getSpeechInputObservation()).toBeUndefined();await backend.observe();
  await backend.execute({kind:'key',key:'Tab'});const first=await backend.observe(),entry=backend.getSpeechInputObservation()!;
  expect(entry.windowId).toBe(first.windowId);expect(entry.events).toHaveLength(1);
  const reading=entry.events[0]!;expect(reading.kind).toBe('reading');if(reading.kind!=='reading')throw new Error('reading input missing');
  expect(reading.input.target.semantic.name).toBe('Save');expect(reading.input.command).toBe('next_focusable_item');expect(reading.emitted).toBe(true);
  expect(reading.previousContext.containers).toEqual([]);expect(reading.input.target.containers).toEqual([expect.objectContaining({role:'region',name:'Preferences'})]);
  expect(first.speech).toContain(formatVoiceOverSpeech(reading.input,reading.previousContext).speech);
  reading.input.target.semantic.name='mutated';reading.previousContext.containers=['mutated'];
  expect(JSON.stringify(backend.getSpeechInputObservation())).not.toContain('mutated');
  await backend.execute({kind:'key',key:'Tab'});await backend.observe();await backend.execute({kind:'key',key:'Space'});
  const changed=await backend.observe(),activation=backend.getSpeechInputObservation()!;
  expect(activation.windowId).toBe(changed.windowId);expect(activation.events).toHaveLength(1);
  const event=activation.events[0]!;if(event.kind!=='activation')throw new Error('activation input missing');
  expect(event.status).toBe('modeled');expect(event.input.beforeTarget?.semantic.checked).toBe(false);expect(event.input.target.semantic.checked).toBe(true);
  const prediction=formatVoiceOverActivation(event.input,event.previousContext);if(prediction.status!=='modeled')throw new Error('activation unsupported');
  expect(changed.speech).toEqual(prediction.utterances);
  await backend.execute({kind:'key',key:'Tab'});const secure=await backend.observe(),secureInput=backend.getSpeechInputObservation();
  expect(JSON.stringify(secureInput)).not.toContain('private-secret');expect(JSON.stringify(secure)).not.toContain('private-secret');
  expect(JSON.stringify(policyEvents)).not.toContain('mock-speech-inputs-v1');
  expect(secure).not.toHaveProperty('events');
  await backend.close();expect(backend.getSpeechInputObservation()).toBeUndefined();
 }finally{await backend.close();await page.close();}
});
