import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {comparePageState,fixturePageState,nativePageState} from '../src/state.js';
import type {AxDump} from '../src/axdump.js';

test('anonymous DOM controls match recorded native AX state and a changed value fails independently of speech',async()=>{
  const evidence=JSON.parse(await readFile(new URL('./native-control-state.json',import.meta.url),'utf8'));
  const browser=await chromium.launch({headless:true});
  try{
    for(const item of evidence.cases){
      assert.equal(createHash('sha256').update(item.html).digest('hex'),item.htmlSha256);
      const page=await browser.newPage();
      try{
        await page.setContent(item.html);
        await page.locator('input').focus();
        for(const sample of item.observations){
          if(sample.step)await page.locator('input').press('Space');
          const native=nativePageState(sample.ax as AxDump)!;
          const model=await fixturePageState(page),result=comparePageState(native,model);
          assert.equal(result.matched,true,JSON.stringify(result.differences));
          assert.equal(result.coverage.focusComparable,true);
          assert.ok(result.coverage.comparedProperties>0);
          assert.ok(result.coverage.roleNameJoins>0);
          await page.locator('input').evaluate((e:HTMLInputElement)=>{e.checked=!e.checked;});
          assert.equal(comparePageState(native,await fixturePageState(page)).matched,false);
          await page.locator('input').evaluate((e:HTMLInputElement)=>{e.checked=!e.checked;});
        }
      }finally{await page.close();}
    }
  }finally{await browser.close();}
});

test('state observations record actual caret and disabled state while withholding password values and selection',async()=>{
  const browser=await chromium.launch({headless:true}),page=await browser.newPage();
  try{
    await page.setContent('<label>Note <input id="note" value="Dock"></label><label>Secret <input type="password" value="private"></label><button disabled>Unavailable</button>');
    await page.locator('#note').evaluate((e:HTMLInputElement)=>{e.focus();e.setSelectionRange(1,3);});
    const state=await fixturePageState(page);
    const note=state.objects!.find(o=>o.name==='Note')!,secret=state.objects!.find(o=>o.name==='Secret')!;
    assert.equal(note.focused,true);
    assert.deepEqual(note.state,{value:'Dock',selectionStart:1,selectionEnd:3,disabled:false});
    assert.equal(state.objects!.find(o=>o.name==='Unavailable')!.state.disabled,true);
    assert.equal(secret.state.value,undefined);
    assert.equal(secret.state.selectionStart,undefined);
    assert.ok(!JSON.stringify(state).includes('private'));
  }finally{await browser.close();}
});


test('recorded native table aliases are one control and caret differences fail the independent state oracle',async()=>{
  const evidence=JSON.parse(await readFile(new URL('./native-table-state.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(evidence.html).digest('hex'),evidence.htmlSha256);
  const browser=await chromium.launch({headless:true}),page=await browser.newPage();
  try{
    await page.setContent(evidence.html);
    for(const sample of evidence.observations){
      await page.locator('input').evaluate((e:HTMLInputElement,range:number[])=>{e.focus();e.setSelectionRange(range[0]!,range[1]!);},sample.expectedSelection);
      const native=nativePageState(sample.ax as AxDump)!;
      assert.equal(native.objects!.filter(o=>o.role==='textbox').length,1);
      const result=comparePageState(native,await fixturePageState(page));
      assert.equal(result.matched,true,JSON.stringify(result.differences));
      assert.equal(result.coverage.focusComparable,true);
      assert.equal(result.coverage.ambiguousObjects,0);
      assert.ok(result.coverage.comparedProperties>=6);
      await page.locator('input').evaluate((e:HTMLInputElement)=>e.setSelectionRange(3,3));
      assert.equal(comparePageState(native,await fixturePageState(page)).matched,false);
    }
  }finally{await browser.close();}
});
