import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {MockVoiceOverBackend} from 'rawstep/mock-voiceover';
import {observeModelCursor} from '../src/cursor-model.js';

test('model cursor observer records an independent inventory, rejects stale windows and preserves static reading separate from focus',async()=>{
  const browser=await chromium.launch({headless:true}),page=await browser.newPage(),backend=new MockVoiceOverBackend(undefined,0);
  try{
    assert.equal(backend.getReadingCursorObservation(),undefined);
    await page.setContent('<button id="start">Begin</button><h2 id="topic">Museum visit</h2><p>Arrival details</p><input type="password" value="private-secret">');await page.locator('#start').focus();
    await backend.start();backend.attachSession({page});const first=await backend.observe();
    const a=await observeModelCursor(page,backend.getReadingCursorObservation(),first.windowId);
    assert.equal(a.status,'observed');assert.equal(a.domId,'start');assert.equal(a.domIdCount,1);
    assert.equal((await observeModelCursor(page,backend.getReadingCursorObservation(),'stale')).status,'unavailable');
    await backend.execute({kind:'intent',intent:'next'});const next=await backend.observe();
    const b=await observeModelCursor(page,backend.getReadingCursorObservation(),next.windowId);
    assert.equal(b.status,'observed');assert.equal(b.cursor!.target!.role,'heading');assert.equal(b.domId,'topic');
    assert.equal(await page.evaluate(()=>document.activeElement?.id),'start');
    assert.ok(!JSON.stringify(b).includes('private-secret'));assert.ok(b.axNodes!.every(n=>!('value' in n)));
    const copy=backend.getReadingCursorObservation()!;copy.target!.name='Changed';assert.equal(backend.getReadingCursorObservation()!.target!.name,'Museum visit');
  }finally{await backend.close();await browser.close();}
  assert.equal(backend.getReadingCursorObservation(),undefined);
});
