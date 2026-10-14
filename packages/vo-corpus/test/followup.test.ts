import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { generateFollowup } from "../src/generate/followup.js";
import { chordKeys } from "../src/session.js";

test("followup fixtures isolate cursor/focus and focus-return questions with working controls", async () => {
  const generated = generateFollowup(), browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    for (const c of generated.cases) {
      for (const chord of c.chords) assert.ok(chordKeys(chord).length);
      await page.goto("data:text/html," + encodeURIComponent(generated.pages[c.page.slice(6,-5)]!));
      if (c.id.endsWith("button-space") || c.id.endsWith("group-space")) {
        await page.locator("#target").focus(); await page.keyboard.press("Space");
        assert.match(await page.locator("#feedback").innerText(), /activated/);
      }
      if (c.id.endsWith("link-enter")) {
        await page.locator("#target").focus(); await page.keyboard.press("Enter");
        assert.equal(await page.locator("#feedback").innerText(), "Link activated");
      }
      if (c.id.includes("menu-")) {
        await page.locator("#opener").focus(); await page.keyboard.press("Enter");
        assert.equal(await page.evaluate(() => document.activeElement?.id), "option0");
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#menu").isHidden(), true);
        assert.equal(await page.evaluate(() => document.activeElement?.id), "opener");
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
