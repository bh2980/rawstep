import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { runScriptCheck } from '@rawstep/browser/verify';
import { CASES } from '../experiments/native-voiceover/cases.js';
import { directory, taskFor } from '../experiments/native-voiceover/suite.js';

/** Fixture/oracle validation only. These browser actions never count as Native VoiceOver evidence. */
describe('native experiment fixtures and independent oracles', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser?.close(); });
  it.each(['button', 'heading', 'form', 'replace', 'two-fields', 'dialog', 'link', 'onward', 'delayed', 'late', 'silent'])('starts %s fresh and verifies its real completion state', async mode => {
    const page = await browser.newPage();
    try {
      const url = pathToFileURL(join(directory, 'page.html')); url.searchParams.set('case', mode);
      const rule = taskFor(CASES.find(c => c.page === mode)!, directory).verify.all[0]!;
      if (!('script' in rule)) throw new Error('Missing fixture oracle');
      await page.goto(url.href);
      expect(await page.locator('html').getAttribute('data-completed')).toBe('false');
      expect(await runScriptCheck(page, rule.script.source, {})).toEqual({ result: false });
      if (['form', 'replace', 'two-fields'].includes(mode)) {
        if (mode === 'replace') expect(await page.locator('#query').inputValue()).toBe('OLD');
        await page.getByRole('button', { name: 'Submit check' }).click();
        expect(await page.locator('html').getAttribute('data-completed')).toBe('false');
        await page.getByLabel('Query').fill('TEST42');
        if (mode === 'two-fields') await page.getByLabel('Code', { exact: true }).fill('CODE7');
        await page.getByRole('button', { name: 'Submit check' }).click();
      } else if (mode === 'dialog') {
        await page.getByRole('button', { name: 'Open dialog' }).click();
        expect(await page.locator('dialog').evaluate((d: HTMLDialogElement) => d.open)).toBe(true);
        await page.getByRole('button', { name: 'Close dialog' }).click();
        expect(await page.locator('dialog').evaluate((d: HTMLDialogElement) => d.open)).toBe(false);
      } else if (mode === 'link') {
        await page.getByRole('link', { name: 'Open destination' }).click(); await page.waitForURL(/case=destination/);
      } else if (mode === 'onward') {
        await page.getByRole('link', { name: 'Open next page' }).click(); await page.waitForURL(/case=onward-target/);
        expect(await page.locator('html').getAttribute('data-completed')).toBe('false');
        await page.getByRole('button', { name: 'Finish check' }).click();
        await page.waitForFunction(() => document.documentElement.dataset.completed === 'true');
      } else {
        await page.clock.install();
        await page.getByRole('button', { name: 'Finish check' }).click();
        const delay = mode === 'late' ? 4500 : mode === 'delayed' ? 1500 : 0;
        if (delay) {
          await page.clock.runFor(delay - 1);
          expect(await page.locator('html').getAttribute('data-completed')).toBe('false');
        }
        await page.clock.runFor(1);
        if (mode === 'silent') expect(await page.locator('#status').getAttribute('role')).toBeNull();
      }
      expect(await page.locator('html').getAttribute('data-completed')).toBe('true');
      expect(await page.locator('#status').textContent()).toBe('Completed');
      expect(await runScriptCheck(page, rule.script.source, {})).toEqual({ result: true });
      await page.goto(url.href);
      expect(await page.locator('html').getAttribute('data-completed')).toBe('false');
      expect(await runScriptCheck(page, rule.script.source, {})).toEqual({ result: false });
    } finally { await page.close(); }
  });
});
