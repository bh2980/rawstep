import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ScreenshotKeyboardBackend } from '@rawstep/browser/screenshot';
import type { BrowserSession } from '@rawstep/browser/browser';
import { createTestBrowserSession } from './helpers/browser.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const secret = 'Secret value 42';
async function page(fieldAttributes = 'id="f" type="text" autofocus') {
  const dir = await mkdtemp(join(tmpdir(), 'rawstep-input-masking-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'page.html');
  await writeFile(file, `<!doctype html><title>Mask</title><body style="font:20px monospace"><p>Some page text</p><input ${fieldAttributes}><p>More text below</p></body>`);
  return pathToFileURL(file).href;
}
async function start(url: string) {
  const session = await createTestBrowserSession(url);
  const backend = new ScreenshotKeyboardBackend();
  backend.attachSession(session);
  await backend.start();
  cleanup.push(() => backend.close());
  await session.page.focus('#f');
  return { session, backend };
}
const png = (base64: string) => Buffer.from(base64, 'base64');
const unmasked = (session: BrowserSession) => session.page.screenshot({ type: 'png', caret: 'hide' });
const security = (session: BrowserSession) => session.page.locator('#f').evaluate(element => (element as HTMLElement).style.getPropertyValue('-webkit-text-security'));

describe('sensitive text entry masking in real Chromium', () => {
  it('marks the field, masks only the observation screenshot, and restores the inline style', async () => {
    const { session, backend } = await start(await page());
    await backend.execute({ kind: 'typeText', text: secret, sensitive: true });
    expect(await session.page.locator('#f').getAttribute('data-rawstep-mask')).not.toBeNull();
    expect(await session.page.locator('#f').inputValue()).toBe(secret);
    const observation = await backend.observe();
    expect(await security(session)).toBe('');
    // The field returns to its original markup: no leftover style attribute.
    expect(await session.page.locator('#f').evaluate(element => element.getAttribute('style'))).toBeNull();
    const plain = await unmasked(session);
    expect(png(observation.screenshot.pngBase64).subarray(1, 4).toString()).toBe('PNG');
    expect(png(observation.screenshot.pngBase64).equals(plain)).toBe(false);
    // The page itself still renders the real value once the mask is gone.
    expect(await session.page.locator('#f').inputValue()).toBe(secret);
  });

  it('masks every observation after a sensitive entry, identically, and keeps restoring', async () => {
    const { session, backend } = await start(await page());
    await backend.execute({ kind: 'typeText', text: secret, sensitive: true });
    const first = await backend.observe();
    const second = await backend.observe();
    expect(await security(session)).toBe('');
    expect(png(second.screenshot.pngBase64).equals(png(first.screenshot.pngBase64))).toBe(true);
    expect(png(second.screenshot.pngBase64).equals(await unmasked(session))).toBe(false);
  });

  it('restores a pre-existing inline -webkit-text-security value', async () => {
    const { session, backend } = await start(await page('id="f" type="text" style="-webkit-text-security: square"'));
    await backend.execute({ kind: 'typeText', text: secret, sensitive: true });
    await backend.observe();
    expect(await security(session)).toBe('square');
    expect(await session.page.locator('#f').evaluate(element => (element as HTMLElement).style.getPropertyPriority('-webkit-text-security'))).toBe('');
  });

  it('masks a replaceText entry as well', async () => {
    const { session, backend } = await start(await page('id="f" type="text" value="old value here"'));
    await backend.execute({ kind: 'replaceText', text: secret, sensitive: true });
    const observation = await backend.observe();
    expect(await session.page.locator('#f').inputValue()).toBe(secret);
    expect(png(observation.screenshot.pngBase64).equals(await unmasked(session))).toBe(false);
  });

  it('leaves the screenshot unmasked for sensitive:false and never marks the field', async () => {
    const { session, backend } = await start(await page());
    await backend.execute({ kind: 'typeText', text: secret, sensitive: false });
    expect(await session.page.locator('#f').getAttribute('data-rawstep-mask')).toBeNull();
    const observation = await backend.observe();
    expect(await security(session)).toBe('');
    expect(png(observation.screenshot.pngBase64).equals(await unmasked(session))).toBe(true);
  });

  it('leaves the screenshot unmasked when the sensitive flag is absent (backend-level default)', async () => {
    const { session, backend } = await start(await page());
    await backend.execute({ kind: 'typeText', text: secret });
    expect(await session.page.locator('#f').getAttribute('data-rawstep-mask')).toBeNull();
    expect(png((await backend.observe()).screenshot.pngBase64).equals(await unmasked(session))).toBe(true);
  });

  it('shows different pixels for masked and unmasked entry of the same text in fresh sessions', async () => {
    const url = await page();
    const masked = await start(url);
    await masked.backend.execute({ kind: 'typeText', text: secret, sensitive: true });
    const maskedPng = png((await masked.backend.observe()).screenshot.pngBase64);
    await masked.session.close(); // The test helper owns one browser at a time.
    const plain = await start(url);
    await plain.backend.execute({ kind: 'typeText', text: secret, sensitive: false });
    const plainPng = png((await plain.backend.observe()).screenshot.pngBase64);
    expect(maskedPng.equals(plainPng)).toBe(false);
  });
  it('masks a sensitive field inside a shadow root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rawstep-input-masking-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'shadow.html');
    await writeFile(file, `<!doctype html><title>Shadow</title><body style="font:20px monospace"><div id="host"></div><script>const root=document.getElementById('host').attachShadow({mode:'open'});root.innerHTML='<input id="inner" type="text">';</script></body>`);
    const session = await createTestBrowserSession(pathToFileURL(file).href);
    const backend = new ScreenshotKeyboardBackend(); backend.attachSession(session); await backend.start(); cleanup.push(() => backend.close());
    await session.page.locator('#host >> #inner').focus();
    await backend.execute({ kind: 'typeText', text: secret, sensitive: true });
    const observation = await backend.observe();
    // Checked before Playwright's own caret-hiding screenshot, which can touch inline styles itself.
    expect(await session.page.locator('#host >> #inner').evaluate(element => element.getAttribute('style'))).toBeNull();
    expect(png(observation.screenshot.pngBase64).equals(await unmasked(session))).toBe(false);
  });
});
