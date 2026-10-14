import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { generateExpanded } from "../src/generate/expanded.js";
import { chordKeys } from "../src/session.js";

test("expanded training and validation fixtures have separate identifiers, context and working keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vo-expanded-")), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    const ids = new Set<string>();
    for (const partition of ["training", "validation"] as const) {
      const generated = generateExpanded(partition), pages = join(dir, partition);
      await mkdir(pages);
      assert.equal(generated.cases.length, 52);
      for (const [id, html] of Object.entries(generated.pages)) await writeFile(join(pages, id + ".html"), html);
      for (const c of generated.cases) {
        assert.ok(!ids.has(c.id)); ids.add(c.id);
        assert.equal(c.axes.partition, partition);
        assert.equal(c.captureAxAfterSteps, true);
        for (const chord of c.chords) assert.ok(chordKeys(chord).length);
        await page.goto(pathToFileURL(join(pages, c.page.slice(6))).href);
        await page.waitForFunction(() => document.activeElement?.id === "before");
        if (partition === "validation" && c.id.includes("name-content")) assert.equal(await page.locator('main[aria-label="Order workspace"]').count(), 1);
        for (const chord of c.chords) {
          if (chord.startsWith("VO+")) continue;
          await page.keyboard.press(chord.replace(/^Cmd\+/, "ControlOrMeta+").replace(/^(Left|Right|Up|Down)$/, "Arrow$1").replace(/^Shift\+Left$/, "Shift+ArrowLeft"));
        }
        if (c.id.endsWith("text-editing.workflow")) assert.equal(await page.locator("#target").inputValue(), partition === "training" ? "map" : "fox");
        if (c.id.endsWith("search-results.matches")) assert.equal(await page.locator("#results li").count(), 2);
        if (c.id.endsWith("search-results.empty")) assert.equal(await page.locator("#results li").count(), 0);
        if (c.id.endsWith("menu-select") || c.id.endsWith("menu-dismiss")) {
          assert.equal(await page.locator("#menu").isHidden(), true);
          assert.equal(await page.evaluate(() => document.activeElement?.id), "opener");
        }
        if (c.id.endsWith("input-prefilled")) assert.equal(await page.locator("#target").inputValue(), "n");
        if (c.id.endsWith("textarea-edit")) assert.equal(await page.locator("#target").inputValue(), "d");
        if (c.id.endsWith("dialog-checkbox")) {
          assert.equal(await page.locator("#check").isChecked(), true);
          assert.equal(await page.evaluate(() => document.activeElement?.id), "opener");
        }
        assert.deepEqual(errors, [], c.id);
      }
    }
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
