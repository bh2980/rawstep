import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { launchTestBrowser } from './helpers/browser.js';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { MockVoiceOverBackend, MOCK_VOICEOVER_PROFILE } from '@rawstep/screenreaders/mock-voiceover/backend';

let browser: Browser;
const cleanup: (() => Promise<void>)[] = [];
beforeEach(async () => { browser = await launchTestBrowser(); });
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function fixture(html: string, observationMinWaitMs = 0) {
  const context: BrowserContext = await browser.newContext();
  cleanup.push(() => context.close());
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html lang="en"><title>Simulation fixture</title>${html}</html>`);
  await page.bringToFront();
  const backend = new MockVoiceOverBackend(undefined, observationMinWaitMs);
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
  it('reads linked headings as one object, preserves the nesting order and focuses the actual anchor',async()=>{
    const f=await fixture('<button>Start</button><h2><a id="inner" href="#destination">Harbor guide</a></h2><a id="outer" href="#destination"><h3>River trail</h3></a><button>After</button><p id="destination">Destination reached.</p>');
    expect(await f.intent('next')).toEqual(['heading level 2 link Harbor guide']);
    expect(await f.page.evaluate(()=>document.activeElement?.id)).toBe('inner');
    expect(await f.intent('next')).toEqual(['link heading level 3 River trail']);
    expect(await f.page.evaluate(()=>document.activeElement?.id)).toBe('outer');
    expect(await f.intent('previous')).toEqual(['heading level 2 link Harbor guide']);
    expect(await f.intent('heading.next')).toEqual(['River trail link heading level 3']);
    expect(await f.intent('activate')).toEqual(['Destination reached.']);
    expect(await f.page.evaluate(()=>location.hash)).toBe('#destination');
    expect(await f.page.locator('#inner').evaluate(n=>n.parentElement?.tagName)).toBe('H2');
  });

  it('keeps mixed heading contents in one reading unit without moving focus to a partial link',async()=>{
    const f=await fixture('<button id="start">Start</button><h2>Harbor <a href="#one">guide</a></h2><h2><a href="#one">Timetable</a> and <a href="#two">Fares</a></h2><h2><span>Harbor</span><em> services</em></h2><button>After</button>');
    await f.key('Tab');
    expect(await f.intent('next')).toEqual(['heading level 2 Harbor link guide 2 items']);
    expect(await f.page.evaluate(()=>document.activeElement?.id)).toBe('start');
    expect(await f.intent('next')).toEqual(['heading level 2 link Timetable and link Fares 3 items']);
    expect(await f.intent('next')).toEqual(['heading level 2 Harbor services 2 items']);
    expect(await f.intent('next')).toEqual(['After, button']);
  });

  it('retains an explicit heading label while synchronizing to its sole child link',async()=>{
    const f=await fixture('<button>Start</button><h2 aria-label="Journey planner"><a id="target" href="#one">Harbor information</a></h2><button>After</button>');
    expect(await f.intent('next')).toEqual(['heading, level 2, Journey planner']);
    expect(await f.page.evaluate(()=>document.activeElement?.id)).toBe('target');
    expect(await f.intent('next')).toEqual(['After, button']);
  });

  it('names articles from their first own heading and preserves article and named-figure boundaries',async()=>{
    const f=await fixture('<button>Start</button><article><header><h2><a href="#story">Harbor report</a></h2></header><figure><img alt="Bay at sunrise"><figcaption>Early crossings</figcaption></figure><p>Filed by <a href="#author">Nora</a>.</p></article><figure aria-label="Bay photograph"><img alt="Bay"><figcaption>Caption</figcaption></figure><button>After</button>');
    expect(await f.intent('next')).toEqual(['Harbor report, article']);
    expect(await f.intent('next')).toEqual(['heading level 2 link Harbor report']);
    expect(await f.intent('next')).toEqual(['Bay at sunrise, image']);
    expect(await f.intent('next')).toEqual(['Early crossings']);
    expect(await f.intent('next')).toEqual(['Filed by ']);
    expect(await f.intent('next')).toEqual(['link, Nora']);
    expect(await f.intent('next')).toEqual(['period']);
    expect(await f.intent('next')).toEqual(['end of Harbor report, article']);
    expect(await f.intent('next')).toEqual(['Bay photograph, figure']);
    expect(await f.intent('next')).toEqual(['Bay, image']);
    expect(await f.intent('next')).toEqual(['Caption']);
    expect(await f.intent('next')).toEqual(['end of Bay photograph, figure']);
  });

  it('projects plain time content once and the observed ISO-date time receipt twice without adding a container stop',async()=>{
    const f=await fixture('<button>Start</button><time datetime="2026-11-04">November 4, 2026</time><time>June 15, 2026</time><button>After</button>');
    expect(await f.intent('next')).toEqual(['November 4, 2026 November 4, 2026']);
    expect(await f.intent('next')).toEqual(['June 15, 2026']);
    expect(await f.intent('next')).toEqual(['After, button']);
  });

  it('projects unmarked linked lists by explicit role and navigation context without changing the DOM', async () => {
    for (const tag of ['ul','ol']) for (const nav of [false,true]) for (const explicit of [false,true]) {
      const list=`<${tag}${explicit?' role="list"':''} style="list-style:none"><li><a href="#first">First route</a></li><li><a href="#second">Second route</a></li></${tag}>`;
      const f=await fixture('<button>Start</button>'+(nav?'<nav aria-label="Routes">'+list+'</nav>':list)+'<button>After</button>');
      if(nav)expect(await f.intent('next')).toEqual(['Routes, navigation']);
      if(nav||explicit)expect(await f.intent('next')).toEqual(['list, 2 items']);
      expect(await f.intent('next')).toEqual([nav||explicit?'link, First route, 1 of 2':'link, First route']);
      expect(await f.intent('next')).toEqual([nav||explicit?'link, Second route, 2 of 2':'link, Second route']);
      if(nav||explicit)expect(await f.intent('next')).toEqual(['end of list']);
      if(nav)expect(await f.intent('next')).toEqual(['end of Routes, navigation']);
      expect(await f.intent('next')).toEqual(['After, button']);
      expect(await f.page.locator(tag).getAttribute('role')).toBe(explicit?'list':null);
    }
  });

  it('keeps an unnamed image inside a named button out of the reading sequence', async () => {
    const f=await fixture('<button aria-label="Search the site"><svg role="img"><rect width="10" height="10"/></svg></button><button>After</button>');
    expect(f.initial.speech).toEqual(['Search the site, button']);
    expect(await f.intent('next')).toEqual(['After, button']);
  });

  it('reads unmarked breadcrumb links in one stop, with positions only for multiple entries', async () => {
    const f = await fixture('<nav aria-label="Breadcrumb"><ol role="list" style="list-style:none"><li><a href="#home">Home</a></li><li><a href="#guide" aria-current="page">Guide</a></li></ol></nav><button>After</button>');
    expect(await f.intent('next')).toEqual(['list, 2 items']);
    expect(await f.intent('next')).toEqual(['link, Home, 1 of 2']);
    expect(await f.intent('next')).toEqual(['current page link, Guide, 2 of 2']);
    expect(await f.intent('next')).toEqual(['end of list']);
    expect(await f.intent('next')).toEqual(['end of Breadcrumb, navigation']);
    const g = await fixture('<ol role="list" style="list-style:none"><li><a href="#home">Home</a></li></ol><button>After</button>');
    expect(g.initial.speech).toEqual(['list, 1 item']);
    expect(await g.intent('next')).toEqual(['link, Home']);
    expect(await g.intent('next')).toEqual(['end of list']);
  });

  it('keeps linked image and SVG logos at one link-image stop while preserving plain text links', async () => {
    const f = await fixture('<a href="#home" aria-label="Visit Harbor homepage"><img alt="Harbor" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"></a><a href="#home" aria-label="Visit Harbor homepage"><svg role="img" aria-label="Harbor"><rect width="10" height="10"/></svg></a><a href="#home">Visit Harbor homepage</a><button>After</button>');
    expect(f.initial.speech).toEqual(['link image, Visit Harbor homepage']);
    expect(await f.intent('next')).toEqual(['link image, Visit Harbor homepage']);
    expect(await f.intent('next')).toEqual(['link, Visit Harbor homepage']);
    expect(await f.intent('next')).toEqual(['After, button']);
  });

  it('projects typed empty fields, current links and progress ranges from real browser semantics', async () => {
    const f = await fixture('<button>Start</button><input type="email" aria-label="Contact" required><input type="tel" aria-label="Phone"><input type="number" aria-label="Quantity"><a href="#" aria-current="page">Overview</a><progress max="200" value="80" aria-label="Upload"></progress><progress aria-label="Waiting"></progress>');
    expect(await f.intent('next')).toEqual(['Contact, required, invalid data, email field']);
    expect(await f.intent('next')).toEqual(['Phone, telephone number field']);
    expect(await f.intent('next')).toEqual(['Quantity, incrementable number field']);
    expect(await f.intent('next')).toEqual(['current page link, Overview']);
    expect(await f.intent('next')).toEqual(['Upload, 40%, progress indicator']);
    expect(await f.intent('next')).toEqual(['Waiting, indeterminate, progress indicator']);
    // A placeholder does not establish the same named-field receipt as an associated label.
    const g = await fixture('<input type="email" placeholder="Email"><button>Next</button>');
    expect(g.initial.speech).toEqual(['Email, edit text']);
  });

  it('uses changed-state wording only for the same checked control and keeps reading wording separate', async () => {
    const f = await fixture('<button role="switch" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',String(this.getAttribute(\'aria-checked\')!==\'true\'))">Lights</button>');
    expect(await f.key('Tab')).toEqual(['Lights, off, switch']);
    expect(await f.key('Space')).toEqual(['on, Lights, switch']);
    expect(await f.intent('readCurrent')).toEqual(['Lights, on, switch']);
    expect(await f.key('Space')).toEqual(['off, Lights, switch']);
    const broken = await fixture('<div role="switch" aria-checked="false" tabindex="0">Broken</div>');
    expect(await broken.key('Tab')).toEqual(['Broken, off, switch']);
    expect(await broken.key('Space')).toEqual(['Broken, off, switch']);
    expect(await broken.page.locator('[role=switch]').getAttribute('aria-checked')).toBe('false');
    const replaced = await fixture('<button role="switch" aria-checked="false" onclick="this.outerHTML=\'<button role=&quot;switch&quot; aria-checked=&quot;true&quot;>Replacement</button>\'">Original</button>');
    expect(await replaced.intent('activate')).toEqual(['Replacement, on, switch']);
    const mixed = await fixture('<button role="checkbox" aria-checked="mixed" onclick="this.setAttribute(\'aria-checked\',\'true\')">Partially selected</button>');
    expect(await mixed.intent('activate')).toEqual(['Partially selected, checked, checkbox']);
  });

  it('repeats a terminal enabled plain button on next with synchronized focus and no quick-navigation match', async () => {
    const f = await fixture('<h2>Overview</h2><button>Finish</button>');
    expect(await f.intent('next')).toEqual(['Finish, button']);
    expect(await f.intent('next')).toEqual(['Finish, button']);
    expect(await f.page.evaluate(() => document.activeElement?.textContent)).toBe('Finish');
    expect(await f.intent('heading.next')).toEqual(['No more headings']);
    expect(await f.intent('previous')).toEqual(['heading, level 2, Overview']);
  });

  it('retains the native fieldset legend stop, suppresses repeated control labels, and jumps by heading and form control', async () => {
    const f = await fixture(`<h1>Shop</h1><hr>
      <fieldset><legend>Categories</legend><label><input type="checkbox"> Hammer</label><span aria-hidden="false"></span></fieldset>
      <hr><h2>Products</h2><a href="#p1"><h5>Claw Hammer</h5></a><a href="#p2"><h5>Thor Hammer</h5></a><input aria-label="Search">`);
    const actual = [...f.initial.speech];
    for (let index = 0; index < 8; index++) actual.push(...await f.intent('next'));
    expect(actual).not.toContain('separator');
    expect(actual.filter(line => line.trim() === 'Categories')).toHaveLength(1);
    expect(actual.filter(line => line.trim() === 'Hammer')).toHaveLength(0);
    expect(actual.every(line => line.trim() !== '')).toBe(true);
    const g = await fixture(`<h1>Shop</h1><p>Intro</p><button>Menu</button><h2>Filters</h2><input aria-label="Search"><h2>Products</h2>`);
    expect(await g.intent('heading.next')).toEqual(['heading, level 2, Filters']);
    expect(await g.intent('heading.next')).toEqual(['heading, level 2, Products']);
    expect(await g.intent('heading.next')).toEqual(['No more headings']);
    expect(await g.intent('heading.previous')).toEqual(['heading, level 2, Filters']);
    expect(await g.intent('form.next')).toEqual(['Search, edit text']);
  });

  it('speaks the page title when a document loads, before anything on the page, and again for the next document', async () => {
    const f = await fixture('<h1>Shop</h1><a href="#">Next page</a>');
    expect(f.loaded.speech[0]).toBe('Simulation fixture');
    expect(await f.intent('next')).not.toContain('Simulation fixture');
    await f.page.goto('data:text/html,' + encodeURIComponent('<!doctype html><html lang="en"><title>Cart</title><h1>Your cart</h1></html>'));
    expect((await f.backend.observe()).speech[0]).toBe('Cart');
  });

  it('reads list boundaries, item markers and positions, and skips an empty live region', async () => {
    const f = await fixture(`<ul><li><a href="#a">Home</a></li><li><a href="#b">Phones</a></li></ul><ol><li>First</li></ol><p role="status"></p><p>After</p>`);
    const actual = [...f.initial.speech];
    for (let index = 0; index < 10; index++) actual.push(...await f.intent('next'));
    expect(actual.slice(0, 10)).toEqual(['list, 2 items', 'bullet, 1 of 2', 'link, Home', 'bullet, 2 of 2', 'link, Phones', 'end of list', 'list, 1 item', '1., First, 1 of 1', 'end of list', 'After']);
    expect(actual).not.toContain('status');
    expect(actual).toContain('After');
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
    expect(await f.intent('readCurrent')).toEqual(['heading, level 1, Shop']);
    const none = await fixture('<p>Plain page</p>');
    expect(await none.intent('headings.list')).toEqual(['Headings, no items']);
  });

  it('uses actual AX names/roles, traverses exposed descendants and static/offscreen content without duplicate control text', async () => {
    const f = await fixture(`<div role="none"><h2>Welcome</h2><p>Read this introduction</p></div>
      <button><span>Continue</span></button><button style="opacity:0">Transparent</button>
      <p style="position:absolute;top:5000px">Far below</p><button disabled>Unavailable</button>
      <p hidden>Hidden secret</p><p aria-hidden="true">Aria hidden secret</p>`);
    expect(f.initial.speech).toEqual(['heading, level 2, Welcome']);
    const actual = [...f.initial.speech];
    for (let index = 0; index < 6; index++) actual.push(...await f.intent('next'));
    expect(actual).toEqual(['heading, level 2, Welcome', 'Read this introduction', 'Continue, button', 'Transparent, button', 'Far below', 'Unavailable, dimmed, button', 'End of content']);
    expect(await f.page.evaluate(() => document.activeElement?.textContent)).toBe('Transparent');
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

  it('announces listbox suggestions and actual active-descendant selection without moving DOM focus', async () => {
    const f = await fixture(`<label>Region<input id="query" role="combobox" aria-controls="choices" aria-expanded="false"></label>
      <ul id="choices" role="listbox" aria-label="Region choices" hidden><li role="option" id="x" aria-selected="false">Xenon</li><li role="option" id="y" aria-selected="false">Xylem</li></ul>
      <script>const q=document.getElementById('query'),list=document.getElementById('choices');q.oninput=()=>{list.hidden=false;q.setAttribute('aria-expanded','true')};q.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();q.setAttribute('aria-activedescendant','x');document.getElementById('x').setAttribute('aria-selected','true')}if(e.key==='Enter'){q.value='Xenon';q.setAttribute('aria-expanded','false');q.removeAttribute('aria-activedescendant');list.hidden=true}};</script>`);
    expect(await f.key('Tab')).toEqual(['Region, list box pop up, collapsed, combo box']);
    await f.backend.execute({ kind:'typeText', text:'x' });
    expect((await f.backend.observe()).speech).toEqual(['x','expanded list Region choices 2 items']);
    expect(await f.key('ArrowDown')).toEqual(['Xenon text (1 of 2)','Xenon selected (1 of 2)']);
    expect(await f.page.evaluate(() => document.activeElement?.id)).toBe('query');
    expect(await f.page.locator('#x').getAttribute('aria-selected')).toBe('true');
    expect(await f.key('Enter')).toEqual(['collapsed Xenon']);
    expect(await f.page.locator('#query').inputValue()).toBe('Xenon');
  });

  it('announces native radio deselection before the newly selected radio on actual arrow movement', async () => {
    const f = await fixture('<button autofocus>Before marker</button><fieldset><legend>Route</legend><input type="radio" name="route" aria-label="North" checked><input type="radio" name="route" aria-label="South"></fieldset>');
    await f.page.locator('button').focus();
    await f.backend.observe();
    expect(await f.key('Tab')).toEqual(['North, selected, radio button, 1 of 2 Route group']);
    expect(await f.key('ArrowDown')).toEqual(['North, radio button, 1 of 2','South, selected, radio button, 2 of 2']);
    expect(await f.page.locator('input').first().isChecked()).toBe(false);
    expect(await f.page.locator('input').last().isChecked()).toBe(true);
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
    expect(await f.intent('activate')).toEqual(['checked, Agree, checkbox']);
    expect(await f.page.locator('input[type=checkbox]').isChecked()).toBe(true);
    expect(await f.intent('next')).toEqual(['Broken custom, unchecked, checkbox']);
    expect(await f.intent('activate')).toEqual(['Broken custom, unchecked, checkbox']);
    expect(await f.page.locator('[role=checkbox]').getAttribute('aria-checked')).toBe('false');
    await f.intent('next');
    expect(await f.intent('activate')).toEqual(['Choice A, selected, radio button, 1 of 2']);
    await f.intent('next');
    expect(await f.intent('activate')).toEqual(['Choice B, selected, radio button, 2 of 2']);
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
    expect(await f.intent('activate')).toEqual(['Settings web dialog with 2 items Close, button']);
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
    expect(await f.key('Space')).toEqual(['checked, Agree, checkbox']);
    await f.key('Tab');
    expect(await f.key('Enter')).toEqual([]);
    expect(await f.page.locator('button').textContent()).toBe('Ran');
  });

  it('records character echoes, caret moves, deletion and replacement from actual focused input state', async () => {
    const f = await fixture('<input aria-label="Note"><button>Done</button>');
    await f.key('Tab');
    await f.backend.execute({ kind: 'typeText', text: 'c' });
    expect((await f.backend.observe()).speech).toEqual(['c','c']);
    await f.backend.execute({ kind: 'typeText', text: 'u' });
    expect((await f.backend.observe()).speech).toEqual(['u','cu']);
    await f.backend.execute({ kind: 'typeText', text: 'p' });
    expect((await f.backend.observe()).speech).toEqual(['p','cup']);
    expect(await f.key('ArrowLeft')).toEqual(['p']);
    expect(await f.key('Backspace')).toEqual(['u']);
    expect(await f.page.locator('input').inputValue()).toBe('cp');
    expect(await f.key('ControlOrMeta+A')).toEqual(['Select All','cp selected']);
    await f.backend.execute({ kind: 'typeText', text: 'm' });
    expect((await f.backend.observe()).speech).toEqual(['selection replaced m']);
    expect(await f.page.locator('input').inputValue()).toBe('m');
    expect(await f.key('End')).toEqual([]);
  });

  it('waits for delayed live updates, preserves successive messages, and stays silent for an unchanged button', async () => {
    const f = await fixture('<button onclick="setTimeout(()=>document.getElementById(\'s\').textContent=\'Loading\',50);setTimeout(()=>document.getElementById(\'s\').textContent=\'Loaded\',210)">Refresh</button><p id="s" role="status"></p>', 400);
    await f.key('Tab');
    const began = Date.now();
    expect(await f.key('Enter')).toEqual(['Loading','Loaded']);
    expect(Date.now() - began).toBeGreaterThanOrEqual(390);
    expect((await f.backend.observe()).speech).toEqual([]);
    await f.backend.execute({ kind: 'key', key: 'Enter' });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('stop observation')), 20);
    await expect(f.backend.observe({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('announces a browser-exposed dialog role and modal state when traversing its accessible content', async () => {
    const f = await fixture('<dialog aria-label="Settings"><h2>Preferences</h2><button autofocus>Save</button></dialog>');
    await f.page.locator('dialog').evaluate(node => (node as HTMLDialogElement).showModal());
    expect((await f.backend.observe()).speech).toEqual(['Settings web dialog with 2 items Save, button']);
    expect(await f.intent('previous')).toEqual(['heading, level 2, Preferences']);
    expect(await f.intent('previous')).toEqual(['Settings, dialog, modal']);
  });

  it('passes real Space to an enabled native button with an incorrect aria-disabled state', async () => {
    const f=await fixture('<button>Start</button><button id="target" aria-disabled="true" onclick="document.getElementById(\'status\').textContent=\'Sample seat reserved\'">Reserve sample seat</button><p id="status" role="status"></p>');
    expect(await f.intent('next')).toEqual(['Reserve sample seat, dimmed, button']);
    expect(await f.page.evaluate(()=>document.activeElement?.id)).toBe('target');
    expect(await f.key('Space')).toEqual(['Sample seat reserved']);
    expect(await f.page.locator('#target').getAttribute('aria-disabled')).toBe('true');
    await expect(f.backend.execute({kind:'intent',intent:'activate'})).rejects.toThrow('disabled');
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
    await expect(f.backend.execute({ kind: 'key', key: 'F13' })).rejects.toThrow('Unsupported');
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
