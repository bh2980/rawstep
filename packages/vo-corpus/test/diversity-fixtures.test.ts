import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { generateDiversity } from "../src/generate/diversity.js";

test("diversity fixtures implement their declared behavior and preserve intentional defects",async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const {pages,cases}=generateDiversity();
    for(const c of cases){
      const page=await browser.newPage();
      try {
        await page.setContent(pages[c.page.slice(6,-5)]!);
        const family=c.axes.family,value=c.axes.contrastValue;
        if(family==='role-handler'){
          await page.locator('#target').focus();await page.keyboard.press('Enter');
          assert.equal(await page.locator('#status').textContent(),value==='present'?'Timetable refreshed':'');
        }else if(family==='aria-disabled'||family==='hidden-focus'){
          await page.locator('#target').focus();assert.equal(await page.evaluate(()=>document.activeElement?.id),'target');
          await page.keyboard.press('Space');
          assert.equal(await page.locator('#status').textContent(),family==='aria-disabled'?'Sample seat reserved':'Route inspected');
        }else if(family==='focus-return'){
          await page.locator('#opener').click();await page.locator('#close').click();
          assert.equal(await page.evaluate(()=>document.activeElement?.id),value);
        }else if(family==='focus-mutation'){
          await page.locator('#target').click();
          assert.equal(await page.locator('#target').count(),value==='remove'?0:1);
          if(value==='hidden')assert.equal(await page.locator('#target').isVisible(),false);
        }else if(family==='label-reference'){
          assert.equal(await page.getByRole('button',{name:value==='label'?'Harbor schedule':'Open schedule',exact:true}).count(),1);
        }else if(family==='atomic-live'){
          await page.locator('#target').click();assert.equal(await page.locator('#count').textContent(),'1');
        }else if(family==='busy-live'){
          await page.locator('#target').click();await page.waitForFunction(()=>document.getElementById('live')?.getAttribute('aria-busy')==='false');
          assert.equal(await page.locator('#availability').textContent(),'Seats available');
        }else{
          await page.locator('#target').check();assert.equal(await page.locator('#target').isChecked(),true);
        }
      }finally{await page.close();}
    }
  }finally{await browser.close();}
});
