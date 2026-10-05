import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import { launchTestBrowser } from './helpers/browser.js';
import {chromium,type Browser} from 'playwright';
import {createCorpusMockBackend,UnsupportedCorpusPatternError} from '@rawstep/screenreaders/evidence';
let browser:Browser;
beforeEach(async()=>{browser=await launchTestBrowser();});
afterEach(async()=>{await browser?.close();});
const config={profile:{at:'nvda' as const,browser:'chrome' as const,atVersion:'2025.3.1',browserVersion:'143',osVersion:'Windows 11 version 21H2'},sourceFixturePath:'data/tests/html/html/buttons.html'};
describe('strict corpus wording in an actual Chromium mock',()=>{
 it('computes speech from live semantics and real Tab while retaining reference/source provenance',async()=>{
  const page=await browser.newPage();const backend=createCorpusMockBackend(config);
  try{await page.setContent('<input type="button" value="Apply"><input type="button" value="Save">');backend.attachSession({ page: page });const metadata=await backend.start();expect(metadata).toMatchObject({evidenceProvenance:'simulation',wordingEvidenceProfile:{referenceEnvironment:config.profile}});
   const initial=await backend.observe();expect(initial.speech).toEqual(['button Apply']);
   await backend.execute({kind:'key',key:'Tab'});const focused=await backend.observe();expect(focused.speech).toEqual(['Apply button']);expect(await page.locator('input').first().evaluate(n=>n===document.activeElement)).toBe(true);
   expect(focused.outputs[0]?.raw).toMatchObject({wordingEvidence:{evidenceProvenance:'simulation',sourceCommand:'next_focusable_item',scope:'source-bounded-training-rule'}});
   await backend.execute({kind:'intent',intent:'next'});expect((await backend.observe()).speech).toEqual(['button Save']);
  }finally{await backend.close();await page.close();}
 });
 it('refuses unmodeled activation before dispatch, and unmodeled nodes without fallback speech',async()=>{
  const page=await browser.newPage();const backend=createCorpusMockBackend(config);
  try{await page.setContent('<button onclick="document.title=\'changed\'">Apply</button><button aria-pressed="false">Toggle</button>');backend.attachSession({ page: page });await backend.start();await backend.observe();
   await expect(backend.execute({kind:'intent',intent:'activate'})).rejects.toThrow('Unsupported mock VoiceOver intent');expect(await page.title()).toBe('');
   await expect(backend.execute({kind:'intent',intent:'next'})).rejects.toBeInstanceOf(UnsupportedCorpusPatternError);
  }finally{await backend.close();await page.close();}
 });
 it('does not ignore popup or group semantics that the learned template did not model',async()=>{
  for(const html of ['<button aria-haspopup="menu">Apply</button>','<fieldset><legend>Context</legend><button autofocus>Apply</button></fieldset>']){
   const page=await browser.newPage();const backend=createCorpusMockBackend(config);
   try{await page.setContent(html);backend.attachSession({ page: page });await backend.start();await expect(backend.observe()).rejects.toBeInstanceOf(UnsupportedCorpusPatternError);}finally{await backend.close();await page.close();}
  }
 });
});

describe('uncaptured state changes are not relabeled navigation speech',()=>{
 it('abstains on an asynchronous rename after an initial observation',async()=>{
  const page=await browser.newPage();const backend=createCorpusMockBackend(config);
  try{await page.setContent('<button>Apply</button>');backend.attachSession({ page: page });await backend.start();await backend.observe();await page.locator('button').evaluate(n=>n.textContent='Changed');await expect(backend.observe()).rejects.toBeInstanceOf(UnsupportedCorpusPatternError);}finally{await backend.close();await page.close();}
 });
});
