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
  backend.attachSession({ page: page });
  cleanup.push(() => backend.close());
  // The page-title announcement on load has its own test; the others start from the first object on the page.
  const loaded = await backend.observe(), titled = (loaded.outputs[0]?.raw as { announcement?: string } | undefined)?.announcement === 'page-title';
  const initial = titled ? { ...loaded, outputs: loaded.outputs.slice(1), speech: loaded.speech.slice(1) } : loaded;
  async function intent(intent: string) { await backend.execute({ kind: 'intent', intent }); return (await backend.observe()).speech; }
  async function key(key: string) { await backend.execute({ kind: 'key', key }); return (await backend.observe()).speech; }
  return { backend, page, events, metadata, initial, loaded, intent, key };
}

describe('browser-backed simulated English VoiceOver profile in real Chromium', () => {
  it('says a legend or a label once, skips rules and silent objects, and jumps by heading and form control', async () => {
    const f = await fixture(`<h1>Shop</h1><hr>
      <fieldset><legend>Categories</legend><label><input type="checkbox"> Hammer</label><span aria-hidden="false"></span></fieldset>
      <hr><h2>Products</h2><a href="#p1"><h5>Claw Hammer</h5></a><a href="#p2"><h5>Thor Hammer</h5></a><input aria-label="Search">`);
    const actual = [...f.initial.speech];
    for (let index = 0; index < 8; index++) actual.push(...await f.intent('next'));
    expect(actual).not.toContain('separator');
    expect(actual.filter(line => line.trim() === 'Categories')).toHaveLength(0);
    expect(actual.filter(line => line.trim() === 'Hammer')).toHaveLength(0);
    expect(actual.every(line => line.trim() !== '')).toBe(true);
    const g = await fixture(`<h1>Shop</h1><p>Intro</p><button>Menu</button><h2>Filters</h2><input aria-label="Search"><h2>Products</h2>`);
    expect(await g.intent('heading.next')).toEqual(['Filters, heading, level 2']);
    expect(await g.intent('heading.next')).toEqual(['Products, heading, level 2']);
    expect(await g.intent('heading.next')).toEqual(['No more headings']);
    expect(await g.intent('heading.previous')).toEqual(['Filters, heading, level 2']);
    expect(await g.intent('form.next')).toEqual(['Search, edit text']);
  });

  it('speaks the page title when a document loads, before anything on the page, and again for the next document', async () => {
    const f = await fixture('<h1>Shop</h1><a href="#">Next page</a>');
    expect(f.loaded.speech[0]).toBe('Simulation fixture');
    expect(await f.intent('next')).not.toContain('Simulation fixture');
    await f.page.goto('data:text/html,' + encodeURIComponent('<!doctype html><html lang="en"><title>Cart</title><h1>Your cart</h1></html>'));
    expect((await f.backend.observe()).speech[0]).toBe('Cart');
  });

  it('says nothing while a newly opened page has no objects yet, then reads its first one', async () => {
    const context = await browser.newContext();
    cleanup.push(() => context.close());
    await context.route('http://fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: route.request().url().endsWith('/next')
      ? '<!doctype html><html lang="en"><title>Passports</title><body><script>setTimeout(() => { document.body.innerHTML = "<h1>Passports</h1>"; }, 400);</script></body></html>'
      : '<!doctype html><html lang="en"><title>Home</title><a href="/next">Passports</a></html>' }));
    const page = await context.newPage();
    await page.goto('http://fixture.test/');
    const backend = new MockVoiceOverBackend();
    await backend.start();
    backend.attachSession({ page });
    cleanup.push(() => backend.close());
    await backend.observe();
    await backend.execute({ kind: 'intent', intent: 'activate' });
    await page.waitForURL('**/next');
    const opened = (await backend.observe()).speech;
    expect(opened).not.toContain('No accessible content');
    await page.waitForSelector('h1');
    const heard = [...opened, ...(await backend.observe()).speech];
    expect(heard).toContain('Passports');
    expect(heard.join(' ')).toMatch(/Passports, heading/);
  });
  it('reads list items without stopping on their markers, and skips an empty live region', async () => {
    const f = await fixture(`<ul><li><a href="#a">Home</a></li><li><a href="#b">Phones</a></li></ul><ol><li>First</li></ol><p role="status"></p><p>After</p>`);
    const actual = [...f.initial.speech];
    for (let index = 0; index < 5; index++) actual.push(...await f.intent('next'));
    expect(actual.map(line => line.trim())).not.toEqual(expect.arrayContaining(['•']));
    expect(actual.some(line => /^\d+\.$/.test(line.trim()))).toBe(false);
    expect(actual).not.toContain('status');
    expect(actual).toContain('After');
  });
  it('reads bold and emphasised text without naming the styling', async () => {
    const f = await fixture(`<p><strong>Kimchi Fried Rice</strong> (Spicy), 9,000 won.</p><p><em>Today only</em></p><p>After</p>`);
    const actual = [...f.initial.speech];
    for (let index = 0; index < 5; index++) actual.push(...await f.intent('next'));
    expect(actual.map(line => line.trim())).not.toEqual(expect.arrayContaining(['strong', 'emphasis']));
    expect(actual.join(' ')).toContain('Kimchi Fried Rice');
    expect(actual.join(' ')).toContain('Today only');
  });

  it('speaks new live-region text once after the action that changed it, and nothing for what the page loaded with or a region that is not live', async () => {
    const f = await fixture(`<button id="b">Add to cart</button><p role="status" id="s">Loaded text</p><p id="quiet"></p>
      <script>document.getElementById('b').addEventListener('click', () => { document.getElementById('s').textContent = 'Product added to cart'; document.getElementById('quiet').textContent = 'Shown only'; });</script>`);
    expect(f.initial.speech.join(' ')).not.toContain('Loaded text');
    expect(await f.intent('activate')).toEqual(['Add to cart, button', 'Product added to cart']);
    // Spoken once: the next observation does not repeat it, and the unannounced paragraph is never spoken by itself.
    expect((await f.backend.observe()).speech).toEqual([]);
    const later = await f.intent('next');
    expect(later.join(' ')).not.toContain('Shown only');
  });
  it('lists every heading with its level in one announcement without moving the cursor', async () => {
    const f = await fixture('<h1>Shop</h1><p>Intro</p><h2>Products</h2><button>Buy</button><h3>Reviews</h3>');
    expect(await f.intent('headings.list')).toEqual(['Headings, 3 items: Shop, level 1; Products, level 2; Reviews, level 3']);
    expect(await f.intent('readCurrent')).toEqual(['Shop, heading, level 1']);
    const none = await fixture('<p>Plain page</p>');
    expect(await none.intent('headings.list')).toEqual(['Headings, no items']);
  });
  it('sends arrow keys to the page and speaks where focus went, as in a radio group', async () => {
    const f = await fixture('<label><input type="radio" name="size" checked> Small</label><label><input type="radio" name="size"> Large</label>');
    expect((await f.key('Tab')).join(' ')).toContain('Small');
    expect((await f.key('ArrowDown')).join(' ')).toContain('Large');
  });
  it('jumps by link and form control both ways, and lists the links without moving the cursor', async () => {
    const f = await fixture('<h1>Shop</h1><a href="#a">Home</a><p>Intro</p><label>Qty <input></label><a href="#b">Cart</a>');
    expect(await f.intent('links.list')).toEqual(['Links, 2 items: Home; Cart']);
    expect(await f.intent('readCurrent')).toEqual(['Shop, heading, level 1']);
    expect((await f.intent('link.next')).join(' ')).toContain('Home');
    expect((await f.intent('link.next')).join(' ')).toContain('Cart');
    expect(await f.intent('link.next')).toEqual(['No more links']);
    expect((await f.intent('link.previous')).join(' ')).toContain('Home');
    expect((await f.intent('form.next')).join(' ')).toContain('Qty');
    expect(await f.intent('form.previous')).toEqual(['No previous form control']);
  });

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
    expect(f.loaded.outputs[0]?.raw).toMatchObject({ evidenceProvenance: 'simulation', announcement: 'page-title' });
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
    await expect(f.backend.execute({ kind: 'key', key: 'PageDown' })).rejects.toThrow('Unsupported');
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
