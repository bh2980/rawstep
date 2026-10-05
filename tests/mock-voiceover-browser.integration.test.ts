import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { launchTestBrowser } from './helpers/browser.js';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { MockVoiceOverBackend, MOCK_VOICEOVER_PROFILE } from '@rawstep/screenreaders/mock-voiceover/backend';

let browser: Browser;
const cleanup: (() => Promise<void>)[] = [];
beforeEach(async () => { browser = await launchTestBrowser(); });
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function fixture(html: string) {
  const context: BrowserContext = await browser.newContext();
  cleanup.push(() => context.close());
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html lang="en"><title>Simulation fixture</title>${html}</html>`);
  await page.bringToFront();
  const backend = new MockVoiceOverBackend();
  const events: unknown[] = [];
  backend.subscribe(event => events.push(event));
  const metadata = await backend.start();
  backend.attachPage(page);
  cleanup.push(() => backend.close());
  const initial = await backend.observe();
  async function intent(intent: string) { await backend.execute({ kind: 'intent', intent }); return (await backend.observe()).speech; }
  async function key(key: string) { await backend.execute({ kind: 'key', key }); return (await backend.observe()).speech; }
  return { backend, page, events, metadata, initial, intent, key };
}

describe('browser-backed simulated English VoiceOver profile in real Chromium', () => {
  it('uses actual AX names/roles, traverses exposed descendants and static/offscreen content without duplicate control text', async () => {
    const f = await fixture(`<div role="none"><h2>Welcome</h2><p>Read this introduction</p></div>
      <button><span>Continue</span></button><button style="opacity:0">Transparent</button>
      <p style="position:absolute;top:5000px">Far below</p><button disabled>Unavailable</button>
      <p hidden>Hidden secret</p><p aria-hidden="true">Aria hidden secret</p>`);
    expect(f.initial.speech).toEqual(['Welcome, heading, level 2']);
    const actual = [...f.initial.speech];
    for (let index = 0; index < 6; index++) actual.push(...await f.intent('next'));
    expect(actual).toEqual(['Welcome, heading, level 2', 'Read this introduction', 'Continue, button', 'Transparent, button', 'Far below', 'Unavailable, button, disabled', 'End of content']);
    expect(await f.page.evaluate(() => document.activeElement === document.body)).toBe(true);
    expect(f.metadata).toMatchObject({ backend: 'mock-voiceover', profile: MOCK_VOICEOVER_PROFILE, evidenceProvenance: 'simulation', environment: { nativeScreenReader: false } });
    expect(JSON.stringify(f.events)).not.toMatch(/backendDOMNodeId|childIds|Hidden secret/);
    expect(f.initial.outputs[0]?.raw).toMatchObject({ evidenceProvenance: 'simulation', semantic: { name: 'Welcome', role: 'heading' } });
  });

  it('keeps its cursor independent of unchanged DOM focus and follows real Tab/Shift+Tab focus changes', async () => {
    const f = await fixture('<input aria-label="Name"><p>Static explanation</p><button>Continue</button>');
    expect(f.initial.speech).toEqual(['Name, edit text']);
    expect(await f.intent('next')).toEqual(['Static explanation']);
    expect(await f.page.evaluate(() => document.activeElement === document.body)).toBe(true);
    expect(await f.key('Tab')).toEqual(['Name, edit text']);
    expect(await f.intent('next')).toEqual(['Static explanation']);
    expect((await f.backend.observe()).speech).toEqual([]);
    expect(await f.intent('readFocused')).toEqual(['Name, edit text']);
    expect(await f.intent('readCurrent')).toEqual(['Static explanation']);
    expect(await f.key('Tab')).toEqual(['Continue, button']);
    expect(await f.key('Shift+Tab')).toEqual(['Name, edit text']);
  });

  it('does not interpret aria-activedescendant changes as DOM focus movement', async () => {
    const f = await fixture('<input aria-label="Search" role="combobox" aria-controls="items" aria-expanded="true" aria-activedescendant="one"><div id="items" role="listbox"><div id="one" role="option">One</div><div id="two" role="option">Two</div></div><p>After choices</p>');
    await f.key('Tab');
    for (let index = 0; index < 4; index++) await f.intent('next');
    await f.page.locator('input').evaluate(node => node.setAttribute('aria-activedescendant', 'two'));
    expect(await f.intent('readCurrent')).toEqual(['After choices']);
    expect(await f.page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
  });

  it('preserves DOM node cursor identity across insertions and reconciles removed objects to surviving neighbors', async () => {
    const f = await fixture('<p id="one">First</p><p id="two">Second</p><p id="three">Third</p>');
    expect(await f.intent('next')).toEqual(['Second']);
    await f.page.locator('#one').evaluate(node => node.insertAdjacentHTML('beforebegin', '<p>Inserted</p>'));
    expect(await f.intent('readCurrent')).toEqual(['Second']);
    await f.page.locator('#two').evaluate(node => node.remove());
    expect((await f.backend.observe()).speech).toEqual(['Third']);
    expect(await f.intent('previous')).toEqual(['First']);
    await f.page.locator('#one').evaluate(node => { node.firstChild!.nodeValue = 'Renamed'; });
    expect((await f.backend.observe()).speech).toEqual(['Renamed']);
  });

  it('uses real native checkbox/radio state and never repairs a custom ARIA widget with no handler', async () => {
    const f = await fixture('<input type="checkbox" aria-label="Agree"><div role="checkbox" aria-checked="false" tabindex="0">Broken custom</div><input type="radio" name="group" aria-label="Choice A"><input type="radio" name="group" aria-label="Choice B">');
    expect(f.initial.speech).toEqual(['Agree, unchecked, checkbox']);
    expect(await f.intent('activate')).toEqual(['Agree, checked, checkbox']);
    expect(await f.page.locator('input[type=checkbox]').isChecked()).toBe(true);
    expect(await f.intent('next')).toEqual(['Broken custom, unchecked, checkbox']);
    expect(await f.intent('activate')).toEqual(['Broken custom, unchecked, checkbox']);
    expect(await f.page.locator('[role=checkbox]').getAttribute('aria-checked')).toBe('false');
    await f.intent('next');
    expect(await f.intent('activate')).toEqual(['Choice A, radio button, checked']);
    await f.intent('next');
    expect(await f.intent('activate')).toEqual(['Choice B, radio button, checked']);
    expect(await f.page.locator('input[type=radio]').first().isChecked()).toBe(false);
  });

  it('declares untrusted DOM activation, invokes actual handlers, and refuses disabled or static targets', async () => {
    const f = await fixture('<button aria-label="Run" onclick="this.dataset.trusted=String(event.isTrusted);this.textContent=\'Completed\'">Run</button><button disabled>Disabled</button><p>Static text</p>');
    const receipt = await f.backend.execute({ kind: 'intent', intent: 'activate' });
    expect(receipt).toMatchObject({ activation: 'dom-click-untrusted', evidenceProvenance: 'simulation' });
    expect(await f.page.locator('button').first().getAttribute('data-trusted')).toBe('false');
    expect(await f.page.locator('button').first().textContent()).toBe('Completed');
    await f.backend.observe();
    await f.intent('next');
    await expect(f.backend.execute({ kind: 'intent', intent: 'activate' })).rejects.toThrow('disabled');
    await f.intent('next');
    await expect(f.backend.execute({ kind: 'intent', intent: 'activate' })).rejects.toThrow('unsupported');
  });

  it('follows dialog autofocus and actual Escape close/focus behavior without implementing a dialog state machine', async () => {
    const f = await fixture('<button onclick="document.querySelector(\'dialog\').showModal()">Open</button><dialog aria-label="Settings"><h2>Preferences</h2><button autofocus onclick="this.closest(\'dialog\').close()">Close</button></dialog>');
    expect(await f.intent('activate')).toEqual(['Close, button']);
    expect(await f.page.locator('dialog').evaluate(node => (node as HTMLDialogElement).open)).toBe(true);
    expect(await f.key('Escape')).toEqual(['Open, button']);
    expect(await f.page.locator('dialog').evaluate(node => (node as HTMLDialogElement).open)).toBe(false);
  });

  it('only types into actually focused editables, supports real replacement, and never announces password values', async () => {
    const f = await fixture('<input aria-label="Name" value="Old"><input type="password" aria-label="Password" value="existing-secret"><button>Submit</button>');
    await expect(f.backend.execute({ kind: 'typeText', text: 'Must not type' })).rejects.toThrow('actually focused');
    expect(await f.page.locator('input').first().inputValue()).toBe('Old');
    expect(await f.backend.execute({ kind: 'intent', intent: 'activate' })).toMatchObject({ activation: 'dom-focus' });
    await f.backend.observe();
    await f.backend.execute({ kind: 'replaceText', text: 'New text' });
    expect((await f.backend.observe()).speech).toEqual(['Name, New text, edit text']);
    expect(await f.page.locator('input').first().inputValue()).toBe('New text');
    expect(await f.key('Tab')).toEqual(['Password, secure text field']);
    await f.backend.execute({ kind: 'replaceText', text: 'replacement-secret' });
    expect((await f.backend.observe()).speech).toEqual(['Password, secure text field']);
    expect(await f.page.locator('input[type=password]').inputValue()).toBe('replacement-secret');
    expect(JSON.stringify(f.events)).not.toMatch(/existing-secret|replacement-secret|••/);
    await f.key('Tab');
    await expect(f.backend.execute({ kind: 'typeText', text: 'Forbidden' })).rejects.toThrow('actually focused');
  });

  it.each([
    '<input aria-label="Read only" readonly>', '<textarea aria-label="Read only" readonly></textarea>',
    '<input type="checkbox" aria-label="Check">', '<div role="textbox" aria-label="Not actually editable" tabindex="0"></div>',
  ])('rejects text even when AX role/focus suggest editing but DOM is not editable: %s', async html => {
    const f = await fixture(html);
    await f.key('Tab');
    await expect(f.backend.execute({ kind: 'replaceText', text: 'Forbidden' })).rejects.toThrow('actually focused');
  });

  it('rechecks focus between typed characters and stops when the page moves focus', async () => {
    const f = await fixture('<input aria-label="First" oninput="document.querySelector(\'button\').focus()"><button>Stop typing</button>');
    await f.key('Tab');
    await expect(f.backend.execute({ kind: 'typeText', text: 'abc' })).rejects.toThrow('actually focused');
    expect(await f.page.locator('input').inputValue()).toBe('a');
  });

  it('does not continue entering a named value into another editable after an input handler redirects focus', async () => {
    const f = await fixture('<input id="first" aria-label="First" oninput="document.querySelector(\'#second\').focus()"><input id="second" aria-label="Second">');
    await f.key('Tab');
    await expect(f.backend.execute({ kind: 'typeText', text: 'abc' })).rejects.toThrow('actually focused');
    expect(await f.page.locator('#first').inputValue()).toBe('a');
    expect(await f.page.locator('#second').inputValue()).toBe('');
  });

  it('passes Enter and Space to the browser and reads the resulting state without inventing widget behavior', async () => {
    const f = await fixture('<a href="#destination">Details</a><input type="checkbox" aria-label="Agree"><button onclick="this.textContent=\'Ran\'">Run</button>');
    expect(f.initial.speech).toEqual(['link, Details']);
    await f.key('Tab');
    await f.key('Enter');
    expect(new URL(f.page.url()).hash).toBe('#destination');
    await f.key('Tab');
    expect(await f.key('Space')).toEqual(['Agree, checked, checkbox']);
    await f.key('Tab');
    expect(await f.key('Enter')).toEqual(['Ran, button']);
  });

  it('announces a browser-exposed dialog role and modal state when traversing its accessible content', async () => {
    const f = await fixture('<dialog aria-label="Settings"><h2>Preferences</h2><button autofocus>Save</button></dialog>');
    await f.page.locator('dialog').evaluate(node => (node as HTMLDialogElement).showModal());
    expect((await f.backend.observe()).speech).toEqual(['Save, button']);
    expect(await f.intent('previous')).toEqual(['Preferences, heading, level 2']);
    expect(await f.intent('previous')).toEqual(['Settings, dialog, modal']);
  });

  it('refuses Enter/Space activation of an actually focused AX-disabled custom control', async () => {
    const f = await fixture('<div role="button" tabindex="0" aria-disabled="true" onkeydown="this.textContent=\'Changed\'">Disabled custom</div>');
    expect(await f.key('Tab')).toEqual(['Disabled custom, button, disabled']);
    for (const key of ['Enter', 'Space']) await expect(f.backend.execute({ kind: 'key', key })).rejects.toThrow('disabled');
    expect(await f.page.locator('[role=button]').textContent()).toBe('Disabled custom');
  });

  it('honors cancellation between real keystrokes and rejects unsupported intents before browser mutations', async () => {
    const f = await fixture('<input aria-label="Name">');
    await f.key('Tab');
    const controller = new AbortController();
    const original = f.page.keyboard.type.bind(f.page.keyboard);
    const typed = vi.spyOn(f.page.keyboard, 'type').mockImplementation(async text => { await original(text); controller.abort(new Error('Stop now')); });
    await expect(f.backend.execute({ kind: 'typeText', text: 'abc' }, { signal: controller.signal })).rejects.toThrow('Stop now');
    expect(await f.page.locator('input').inputValue()).toBe('a');
    expect(typed).toHaveBeenCalledTimes(1);
    await expect(f.backend.execute({ kind: 'intent', intent: 'interact' })).rejects.toThrow('Unsupported');
    await expect(f.backend.execute({ kind: 'intent', intent: 'rotor' })).rejects.toThrow('Unsupported');
    await expect(f.backend.execute({ kind: 'key', key: 'ArrowDown' })).rejects.toThrow('Unsupported');
    expect(await f.page.locator('input').inputValue()).toBe('a');
  });

  it('refreshes from externally changed browser state on observe and labels every output as simulation', async () => {
    const f = await fixture('<input type="checkbox" aria-label="Agree">');
    await f.page.locator('input').check();
    const observation = await f.backend.observe();
    expect(observation.speech).toEqual(['Agree, checked, checkbox']);
    for (const output of [...f.initial.outputs, ...observation.outputs]) expect(output.raw).toMatchObject({ evidenceProvenance: 'simulation', profile: MOCK_VOICEOVER_PROFILE });
    expect(observation.reason).toBe('simulation-snapshot');
  });
});
