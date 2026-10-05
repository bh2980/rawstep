import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BrowserSetupError, type BrowserSession } from '@rawstep/browser/browser';
import { createTestBrowserSession as createBrowserSession } from './helpers/browser.js';
import type { ResolvedNavigationPolicy } from '@rawstep/core/contracts';
import { MAX_NAVIGATION_REDIRECTS } from '@rawstep/browser/browser/navigation-boundary';

type Hit = { server: string; path: string; method: string; body: string; cookie: string };
const hits: Hit[] = [];
let origin = '';
let otherOrigin = '';
let session: BrowserSession | undefined;
let files = '';

async function handler(server: string, request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const path = new URL(request.url!, origin || 'http://localhost').pathname;
  hits.push({ server, path, method: request.method!, body: Buffer.concat(chunks).toString(), cookie: request.headers.cookie ?? '' });
  const redirect = (location: string, status = 302, cookie?: string) => {
    response.writeHead(status, { location, ...(cookie ? { 'set-cookie': cookie } : {}) }).end();
  };
  const html = (body: string) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Redirect fixture</title>${body}`);
  };
  if (path === '/same/start') return redirect('./step', 302, 'first=one; Path=/');
  if (path === '/same/step') return redirect('final', 301, 'second=two; Path=/');
  if (path === '/same/final') return html('<h1>Arrived</h1><img src="pixel"><a href="relative">relative</a>');
  if (path === '/same/pixel') {
    response.writeHead(200, { 'content-type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    return;
  }
  if (path.startsWith('/form/')) {
    const status = path.split('/').at(-1);
    return html(`<form method="post" action="/method/${status}"><input name="item" value="rawstep"><button>Send</button></form>`);
  }
  if (path.startsWith('/method/')) {
    const status = Number(path.split('/').at(-1));
    return redirect(`/result/${status}`, status, 'posted=yes; Path=/');
  }
  if (path.startsWith('/post-escape/')) return redirect(`${otherOrigin}/capture`, Number(path.split('/').at(-1)));
  if (path.startsWith('/result/')) return html('<h1>Submitted</h1>');
  if (path === '/unsafe/start') return redirect('/unsafe/middle');
  if (path === '/unsafe/middle') return redirect(`${otherOrigin}/capture`);
  if (path === '/approved/start') return redirect(`${otherOrigin}/approved/step`);
  if (path === '/approved/cross-site') return redirect(`${otherOrigin.replace('127.0.0.1', 'localhost')}/approved/step`);
  if (path === '/approved/cross-site-commit') return redirect(`${otherOrigin.replace('127.0.0.1', 'localhost')}/approved/stay`);
  if (path === '/approved/escape') return redirect(`${otherOrigin}/capture`);
  if (path === '/approved/step') return redirect(`${origin}/approved/final`);
  if (path === '/approved/final') return html('<h1>Approved destination</h1>');
  if (path === '/prefix/') return redirect('/prefix/next');
  if (path === '/prefix/next') return redirect('/outside');
  if (path === '/spa/') return html('<h1>SPA fixture</h1>');
  if (path === '/outside') return redirect('/prefix/final');
  if (path.startsWith('/loop/')) return redirect(`/loop/${Number(path.split('/').at(-1)) + 1}`);
  if (path === '/popup-form') return html('<form action="/popup-side-effect" method="post" target="new-named-window"><input name="value" value="secret"></form>');
  if (path === '/link-escape') return html(`<a href="${otherOrigin}/capture">Other origin</a>`);
  if (path === '/credential-redirect') return redirect(`${origin.replace('://', '://user:secret@')}/capture`);
  if (path === '/unsupported-scheme') return redirect('mailto:redirect@example.invalid');
  return html('<h1>Page</h1>');
}
const first = createServer((request, response) => { void handler('first', request, response); });
const second = createServer((request, response) => { void handler('second', request, response); });
async function listen(server: typeof first): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP test server');
  return `http://127.0.0.1:${address.port}`;
}
async function open(path: string, navigation?: ResolvedNavigationPolicy) {
  session = await createBrowserSession(`${origin}${path}`, { ...(navigation ? { navigation } : {}) });
  return session;
}

// Browser startup failures fail this mandatory integration suite.
describe('Chromium navigation boundary integration', () => {
  beforeAll(async () => {
    origin = await listen(first);
    otherOrigin = await listen(second);
    files = await mkdtemp(join(tmpdir(), 'rawstep-browser-files-'));
    await mkdir(join(files, 'allowed'));
    await writeFile(join(files, 'allowed', 'start.html'), '<!doctype html><h1>Start</h1><a href="next.html">Next</a>');
    await writeFile(join(files, 'allowed', 'next.html'), '<!doctype html><h1>Next</h1>');
    await writeFile(join(files, 'secret.html'), '<!doctype html><h1>Forbidden file</h1>');
  });
  beforeEach(() => { hits.length = 0; });
  afterEach(async () => { await session?.close(); session = undefined; });
  afterAll(async () => {
    await Promise.all([first, second].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    if (files) await rm(files, { recursive: true, force: true });
  });

  it('cancels a direct script external-scheme navigation before a requested-navigation event', async () => {
    const current = await open('/direct-external');
    const probe = await current.context.newCDPSession(current.page);
    await probe.send('Page.enable');
    const requested: string[] = [];
    probe.on('Page.frameRequestedNavigation', event => { requested.push(event.url); });
    const target = 'x-rawstep-test-no-handler:probe';
    await current.page.evaluate((url) => {
      const button = document.createElement('button');
      button.id = 'external-protocol'; button.textContent = 'Try external';
      button.addEventListener('click', () => { window.location.href = url; });
      document.body.append(button);
    }, target);
    await current.page.locator('#external-protocol').click({ noWaitAfter: true });
    await expect.poll(() => current.navigation.blocked.some(event => event.url === target)).toBe(true);
    expect(requested).not.toContain(target);
    expect(current.page.url()).toBe(`${origin}/direct-external`);
    expect(await current.page.locator('h1').textContent()).toBe('Page');
    await current.page.goto(`${origin}/same/final`);
    expect(await current.page.locator('h1').textContent()).toBe('Arrived');
    await probe.detach();
  });

  it('follows relative same-origin multi-hop redirects with real URL, base URL, cookies and resources', async () => {
    const current = await open('/same/start');
    expect(current.page.url()).toBe(`${origin}/same/final`);
    expect(await current.page.locator('h1').textContent()).toBe('Arrived');
    expect(await current.page.locator('a').evaluate((link) => (link as HTMLAnchorElement).href)).toBe(`${origin}/same/relative`);
    expect(hits.find((hit) => hit.path === '/same/step')?.cookie).toContain('first=one');
    expect(hits.find((hit) => hit.path === '/same/final')?.cookie).toContain('second=two');
    expect(hits.find((hit) => hit.path === '/same/pixel')?.cookie).toContain('second=two');
    expect(current.network.responses.filter((response) => [301, 302].includes(response.status))).toHaveLength(2);
    expect(current.takeBlockedNavigations()).toEqual([]);
  });

  it.each([301, 302, 303, 307, 308])('preserves native POST redirect semantics for status %s', async (status) => {
    const current = await open(`/form/${status}`);
    await Promise.all([current.page.waitForURL(`${origin}/result/${status}`), current.page.locator('button').click()]);
    const initial = hits.find((hit) => hit.path === `/method/${status}`);
    const final = hits.find((hit) => hit.path === `/result/${status}`);
    expect(initial).toMatchObject({ method: 'POST', body: 'item=rawstep' });
    expect(final).toMatchObject(status >= 307 ? { method: 'POST', body: 'item=rawstep' } : { method: 'GET', body: '' });
    expect(final?.cookie).toContain('posted=yes');
    expect(current.page.url()).toBe(`${origin}/result/${status}`);
  });

  it('blocks an unsafe intermediate hop before the other server receives anything', async () => {
    const error = await open('/unsafe/start').catch((error) => error);
    expect(error).toBeInstanceOf(BrowserSetupError);
    expect(error.blockedNavigations).toContainEqual(expect.objectContaining({ url: `${otherOrigin}/capture`, fromUrl: `${origin}/unsafe/middle` }));
    expect(hits.filter((hit) => hit.server === 'second')).toEqual([]);
    expect(hits.map((hit) => hit.path)).toEqual(['/unsafe/start', '/unsafe/middle']);
  });

  it('permits approved origin transitions and returns to the actual final URL', async () => {
    const current = await open('/approved/start', { strategy: 'allow-url-list', allowUrlList: [`${origin}/approved/`, `${otherOrigin}/approved/`] });
    expect(current.page.url()).toBe(`${origin}/approved/final`);
    expect(hits.filter((hit) => hit.path.startsWith('/approved/')).map((hit) => hit.server)).toEqual(['first', 'second', 'first']);
    expect(current.takeBlockedNavigations()).toEqual([]);
  });

  it('keeps interception installed across approved cross-site redirects', async () => {
    const crossSite = otherOrigin.replace('127.0.0.1', 'localhost');
    const current = await open('/approved/cross-site', { strategy: 'allow-url-list', allowUrlList: [`${origin}/approved/`, `${crossSite}/approved/`] });
    expect(current.page.url()).toBe(`${origin}/approved/final`);
    await current.page.goto(`${origin}/approved/escape`).catch(() => undefined);
    expect(current.navigation.blocked.some((blocked) => blocked.url === `${otherOrigin}/capture`)).toBe(true);
    expect(hits.some((hit) => hit.path === '/capture')).toBe(false);
    await current.page.goto(`${origin}/approved/recovered`);
    expect(current.page.url()).toBe(`${origin}/approved/recovered`);
  });

  it('guards later redirects after committing a new cross-site document', async () => {
    const crossSite = otherOrigin.replace('127.0.0.1', 'localhost');
    const current = await open('/approved/cross-site-commit', { strategy: 'allow-url-list', allowUrlList: [`${origin}/approved/`, `${crossSite}/approved/`] });
    expect(current.page.url()).toBe(`${crossSite}/approved/stay`);
    await current.page.goto(`${crossSite}/approved/escape`).catch(() => undefined);
    expect(current.navigation.blocked).toContainEqual(expect.objectContaining({
      url: `${otherOrigin}/capture`, fromUrl: `${crossSite}/approved/escape`
    }));
    expect(hits.some((hit) => hit.path === '/capture')).toBe(false);
    expect(current.page.url()).toBe(`${crossSite}/approved/stay`);
    await current.page.goto(`${crossSite}/approved/recovered`);
    expect(current.page.url()).toBe(`${crossSite}/approved/recovered`);
  });

  it.each([303, 307])('does not send a forbidden POST redirect target for status %s', async (status) => {
    const current = await open(`/form/${status}`);
    await current.page.locator('form').evaluate((form, action) => { (form as HTMLFormElement).action = action; }, `${origin}/post-escape/${status}`);
    await current.page.locator('button').click().catch(() => undefined);
    await expect.poll(() => current.navigation.blocked.some((blocked) => blocked.url === `${otherOrigin}/capture`)).toBe(true);
    expect(hits.find((hit) => hit.path === `/post-escape/${status}`)).toMatchObject({ method: 'POST', body: 'item=rawstep' });
    expect(hits.filter((hit) => hit.server === 'second')).toEqual([]);
  });

  it('blocks a prefix escape even when a later hop would return inside the prefix', async () => {
    const error = await open('/prefix/', { strategy: 'start-url-prefix' }).catch((error) => error);
    expect(error).toBeInstanceOf(BrowserSetupError);
    expect(error.blockedNavigations.at(-1)?.url).toBe(`${origin}/outside`);
    expect(hits.some((hit) => hit.path === '/outside' || hit.path === '/prefix/final')).toBe(false);
  });

  it('stops a redirect loop at the explicit hop budget before sending the excess request', async () => {
    const error = await open('/loop/0').catch((error) => error);
    expect(error).toBeInstanceOf(BrowserSetupError);
    expect(error.blockedNavigations.at(-1)?.reason).toContain(`${MAX_NAVIGATION_REDIRECTS}-hop`);
    expect(hits).toHaveLength(MAX_NAVIGATION_REDIRECTS + 1);
    expect(hits.at(-1)?.path).toBe(`/loop/${MAX_NAVIGATION_REDIRECTS}`);
  });

  it('blocks the first named-popup POST even when native form.submit bypasses document submit hooks', async () => {
    const current = await open('/popup-form');
    // A named target avoids the document guard's _blank shortcut; form.submit
    // emits no submit event. This specifically exercises context routing.
    await current.page.evaluate(() => { document.querySelector('form')!.submit(); });
    // Chromium can pause the first popup request before Playwright has a Frame.
    // The page event may instead close the popup before a first request exists
    // (observed with macOS Chrome). Do not invent a target URL in that case.
    // Require either the exact intercepted request or an early blank popup
    // record, plus a closed popup and zero side-effect requests in both cases.
    await expect.poll(() => current.navigation.blocked.some(blocked =>
      /popup|no verifiable frame/.test(blocked.reason) &&
      [ `${origin}/popup-side-effect`, '', 'about:blank' ].includes(blocked.url)
    )).toBe(true);
    await expect.poll(() => current.context.pages()).toEqual([current.page]);
    expect(hits.some((hit) => hit.path === '/popup-side-effect')).toBe(false);
  });

  it('blocks a direct cross-origin navigation after the initial page load', async () => {
    const current = await open('/link-escape');
    await current.page.goto(`${otherOrigin}/capture`).catch(() => undefined);
    expect(hits.filter((hit) => hit.server === 'second')).toEqual([]);
    expect(current.navigation.blocked.some((blocked) => blocked.url === `${otherOrigin}/capture`)).toBe(true);
    await current.page.goto(`${origin}/recovered`);
    expect(current.page.url()).toBe(`${origin}/recovered`);
  });

  it('blocks credential-bearing redirect URLs before their target is sent', async () => {
    const error = await open('/credential-redirect').catch((error) => error);
    expect(error).toBeInstanceOf(BrowserSetupError);
    expect(hits.some((hit) => hit.path === '/capture')).toBe(false);
  });

  it('blocks unsupported redirect schemes at response headers before external protocol handling', async () => {
    const current = await open('/scheme-start');
    await current.page.goto(`${origin}/unsupported-scheme`).catch(() => undefined);
    expect(current.navigation.blocked).toContainEqual(expect.objectContaining({
      url: 'mailto:redirect@example.invalid', fromUrl: `${origin}/unsupported-scheme`,
      reason: expect.stringContaining('unsupported')
    }));
    expect(current.page.url()).toBe(`${origin}/scheme-start`);
  });

  it.each(['assign', 'replace', 'href', 'meta-refresh'])('blocks %s navigation at the native boundary', async (method) => {
    const current = await open('/script-navigation');
    await current.page.evaluate(({ method, target }) => {
      if (method === 'assign') location.assign(target);
      else if (method === 'replace') location.replace(target);
      else if (method === 'href') location.href = target;
      else {
        const meta = document.createElement('meta');
        meta.httpEquiv = 'refresh';
        meta.content = `0;url=${target}`;
        document.head.append(meta);
      }
    }, { method, target: `${otherOrigin}/capture` }).catch(() => undefined);
    await expect.poll(() => current.navigation.blocked.some((blocked) => blocked.url === `${otherOrigin}/capture`)).toBe(true);
    expect(hits.filter((hit) => hit.server === 'second')).toEqual([]);
  });

  it('preserves native redirect history and permits a later safe navigation', async () => {
    const current = await open('/history-start');
    await current.page.goto(`${origin}/same/start`);
    expect(current.page.url()).toBe(`${origin}/same/final`);
    await current.page.goBack();
    expect(current.page.url()).toBe(`${origin}/history-start`);
    await current.page.goto(`${origin}/same/start`);
    expect(current.page.url()).toBe(`${origin}/same/final`);
    expect(current.takeBlockedNavigations()).toEqual([]);
  });

  it.each(['pushState', 'replaceState'] as const)('blocks a same-document prefix escape through history.%s without losing state', async (method) => {
    const current = await open('/spa/', { strategy: 'start-url-prefix' });
    await current.page.evaluate((method) => { history[method]({ denied: true }, '', '/outside'); }, method);
    await expect.poll(() => current.navigation.blocked.some((blocked) => blocked.url === `${origin}/outside`)).toBe(true);
    expect(current.page.url()).toBe(`${origin}/spa/`);
    expect(await current.page.evaluate(() => history.state)).toBeNull();
    expect(hits.some((hit) => hit.path === '/outside')).toBe(false);
    await current.page.evaluate((method) => { history[method]({ allowed: true }, '', '/spa/inside?mode=1#heading'); }, method);
    expect(current.page.url()).toBe(`${origin}/spa/inside?mode=1#heading`);
    expect(await current.page.evaluate(() => history.state)).toEqual({ allowed: true });
  });

  it('guards SPA allow-list routes and permits safe same-document back/forward traversal', async () => {
    const current = await open('/spa/', { strategy: 'allow-url-list', allowUrlList: [`${origin}/spa/`] });
    await current.page.evaluate(() => { history.pushState({ step: 1 }, '', '/spa/one'); history.pushState({ step: 2 }, '', '/spa/two'); });
    await current.page.goBack();
    expect(current.page.url()).toBe(`${origin}/spa/one`);
    await current.page.goForward();
    expect(current.page.url()).toBe(`${origin}/spa/two`);
    await current.page.evaluate(() => { history.replaceState({}, '', '/outside'); });
    await expect.poll(() => current.navigation.blocked.some((blocked) => blocked.url === `${origin}/outside`)).toBe(true);
    expect(current.page.url()).toBe(`${origin}/spa/two`);
  });

  it('allows a sibling file while blocking an unrelated local directory', async () => {
    const start = pathToFileURL(join(files, 'allowed', 'start.html')).href;
    session = await createBrowserSession(start);
    await session.page.locator('a').click();
    await session.page.waitForURL(pathToFileURL(join(files, 'allowed', 'next.html')).href);
    const secret = pathToFileURL(join(files, 'secret.html')).href;
    await session.page.goto(secret).catch(() => undefined);
    expect(session.navigation.blocked.some((blocked) => blocked.url === secret)).toBe(true);
    expect(await session.page.evaluate(() => document.body.textContent).catch(() => '')).not.toContain('Forbidden file');
  });
});
