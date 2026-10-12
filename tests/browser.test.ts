import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ launch: vi.fn(), connectOverCDP: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch: mocks.launch, connectOverCDP: mocks.connectOverCDP } }));
import { BrowserConnectError, BrowserSetupError, createBrowserSession } from '@rawstep/browser/browser';
import { MAX_NAVIGATION_REDIRECTS } from '@rawstep/browser/browser/navigation-boundary';

type Pause = { requestId: string; request: { url: string }; frameId: string; resourceType: string; networkId?: string; redirectedRequestId?: string };
function fixture() {
  let handler: (route: any) => Promise<void>;
  const calls: string[] = [];
  const cdp = Object.assign(new EventEmitter(), {
    send: vi.fn(async (method: string, _params?: unknown): Promise<any> => {
      calls.push(method);
      return method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } } : {};
    })
  });
  const page: any = {
    on: vi.fn(), url: () => 'about:blank', exposeBinding: vi.fn(async () => {}),
    addInitScript: vi.fn(async () => { calls.push('init-script'); }), evaluate: vi.fn(async () => {}),
    waitForLoadState: vi.fn(async () => {}), mainFrame: () => frame
  };
  const frame = { page: () => page };
  const context: any = {
    newPage: vi.fn(async () => page), newCDPSession: vi.fn(async () => cdp),
    route: vi.fn(async (_pattern: string, fn: typeof handler) => { handler = fn; calls.push('route'); }),
    on: vi.fn(), close: vi.fn(async () => {})
  };
  const browser: any = { newContext: vi.fn(async () => context), close: vi.fn(async () => {}) };
  const route = (url: string, opts: { popup?: boolean; subframe?: boolean; noFrame?: boolean } = {}) => ({
    request: () => ({
      isNavigationRequest: () => true, url: () => url,
      frame: () => {
        if (opts.noFrame) throw new Error('no frame');
        return opts.popup ? { page: () => ({}) } : opts.subframe ? { page: () => page } : frame;
      }
    }),
    continue: vi.fn(async () => {}), abort: vi.fn(async () => {}),
    fetch: vi.fn(), fulfill: vi.fn()
  });
  const pause = async (url: string, requestId: string, redirectedRequestId?: string, frameId = 'main') => {
    const event: Pause = { requestId, request: { url }, frameId, resourceType: 'Document', networkId: 'chain', redirectedRequestId };
    cdp.emit('Fetch.requestPaused', event);
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  page.goto = vi.fn(async (url: string) => {
    calls.push('goto');
    const request = route(url);
    await handler(request);
    if (request.abort.mock.calls.length) throw new Error('ERR_BLOCKED_BY_CLIENT');
    await pause(url, 'initial');
    page.url = () => url;
  });
  mocks.launch.mockResolvedValue(browser);
  mocks.connectOverCDP.mockResolvedValue(browser);
  return { page, context, browser, cdp, calls, route, pause, handle: (request: any) => handler(request) };
}

beforeEach(() => { mocks.launch.mockReset(); mocks.connectOverCDP.mockReset(); });

describe('browser navigation boundary plumbing (mocked protocol, not Chromium proof)', () => {
  it('installs context, native redirect interception and document guards before initial navigation', async () => {
    const f = fixture();
    const session = await createBrowserSession('https://safe.example/task');
    expect(mocks.launch).toHaveBeenCalledWith(expect.objectContaining({ handleSIGINT: false, handleSIGTERM: false }));
    for (const step of ['route', 'Fetch.enable', 'init-script']) {
      expect(f.calls.indexOf(step)).toBeLessThan(f.calls.indexOf('goto'));
    }
    expect(f.cdp.send).toHaveBeenCalledWith('Fetch.enable', {
      patterns: [
        { urlPattern: '*', resourceType: 'Document', requestStage: 'Request' },
        { urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }
      ]
    });
    expect(session.navigation.allowedOrigin).toBe('https://safe.example');
    await session.close();
  });

  it('continues legitimate redirects without fetch, fulfill, or URL/method/header overrides', async () => {
    const f = fixture();
    await createBrowserSession('https://safe.example/task');
    const request = f.route('https://safe.example/next');
    await f.handle(request);
    expect(request.continue).toHaveBeenCalledWith();
    expect(request.fetch).not.toHaveBeenCalled();
    expect(request.fulfill).not.toHaveBeenCalled();
    await f.pause('https://safe.example/next', 'redirect-1', 'initial');
    await f.pause('https://safe.example/final', 'redirect-2', 'redirect-1');
    expect(f.cdp.send).toHaveBeenCalledWith('Fetch.continueRequest', { requestId: 'redirect-2' });
    expect(f.cdp.send).not.toHaveBeenCalledWith('Fetch.failRequest', expect.anything());
  });

  it('checks every redirect hop and reports the immediate source on an escape', async () => {
    const f = fixture();
    const session = await createBrowserSession('https://safe.example/task');
    await f.pause('https://safe.example/next', 'allowed', 'initial');
    await f.pause('https://evil.example/secret', 'escape', 'allowed');
    expect(f.cdp.send).toHaveBeenCalledWith('Fetch.failRequest', { requestId: 'escape', errorReason: 'Aborted' });
    expect(f.cdp.send).not.toHaveBeenCalledWith('Fetch.continueRequest', { requestId: 'escape' });
    expect(session.takeBlockedNavigations()).toContainEqual(expect.objectContaining({
      url: 'https://evil.example/secret', fromUrl: 'https://safe.example/next', reason: expect.stringContaining('same-origin')
    }));
  });

  it('allows explicitly approved cross-origin hops', async () => {
    const f = fixture();
    await createBrowserSession('https://safe.example/task', { navigation: {
      strategy: 'allow-url-list', allowUrlList: ['https://safe.example/', 'https://approved.example/allowed/']
    } });
    await f.pause('https://approved.example/allowed/final', 'approved', 'initial');
    expect(f.cdp.send).toHaveBeenCalledWith('Fetch.continueRequest', { requestId: 'approved' });
    await f.pause('https://approved.example/elsewhere', 'bad-path', 'approved');
    expect(f.cdp.send).toHaveBeenCalledWith('Fetch.failRequest', { requestId: 'bad-path', errorReason: 'Aborted' });
  });

  it('blocks a prefix escape on an intermediate redirect', async () => {
    const f = fixture();
    const session = await createBrowserSession('https://safe.example/task/', { navigation: { strategy: 'start-url-prefix' } });
    await f.pause('https://safe.example/task/step', 'inside', 'initial');
    await f.pause('https://safe.example/other', 'outside', 'inside');
    expect(session.takeBlockedNavigations().at(-1)?.reason).toContain('start-url-prefix');
  });

  it('limits a redirect chain and resets the budget for a fresh navigation', async () => {
    const f = fixture();
    const session = await createBrowserSession('https://safe.example/task');
    let previous = 'initial';
    for (let i = 1; i <= MAX_NAVIGATION_REDIRECTS + 1; i++) {
      await f.pause(`https://safe.example/hop/${i}`, `hop-${i}`, previous);
      previous = `hop-${i}`;
    }
    expect(session.takeBlockedNavigations().at(-1)?.reason).toContain(`${MAX_NAVIGATION_REDIRECTS}-hop`);
    expect(f.cdp.send).toHaveBeenCalledWith('Fetch.failRequest', { requestId: `hop-${MAX_NAVIGATION_REDIRECTS + 1}`, errorReason: 'Aborted' });
    await f.pause('https://safe.example/fresh', 'fresh');
    await f.pause('https://safe.example/fresh-final', 'fresh-final', 'fresh');
    expect(f.cdp.send).toHaveBeenCalledWith('Fetch.continueRequest', { requestId: 'fresh-final' });
  });

  it('fails closed for an unlinked redirect', async () => {
    const f = fixture();
    const session = await createBrowserSession('https://safe.example/');
    await f.pause('https://safe.example/final', 'unknown', 'missing');
    expect(session.takeBlockedNavigations().at(-1)?.reason).toContain('previously approved');
    expect(f.cdp.send).toHaveBeenCalledWith('Fetch.failRequest', { requestId: 'unknown', errorReason: 'Aborted' });
  });

  it.each(['https://safe.example.evil/path', 'https://safe.example@evil.example/', 'https://name:password@safe.example/'])('does not permit deceptive or credential-bearing URL %s', async (url) => {
    const f = fixture();
    await createBrowserSession('https://safe.example/', { navigation: { strategy: 'allow-url-list', allowUrlList: ['https://safe.example'] } });
    const request = f.route(url);
    await f.handle(request);
    expect(request.abort).toHaveBeenCalled();
    expect(request.continue).not.toHaveBeenCalled();
  });

  it('blocks popup requests and requests with no verifiable frame before sending', async () => {
    const f = fixture();
    await createBrowserSession('https://safe.example/');
    for (const options of [{ popup: true }, { noFrame: true }]) {
      const request = f.route('https://safe.example/form-post', options);
      await f.handle(request);
      expect(request.abort).toHaveBeenCalled();
      expect(request.continue).not.toHaveBeenCalled();
      expect(request.fetch).not.toHaveBeenCalled();
    }
  });

  it('does not apply the top-level origin policy to subframe content', async () => {
    const f = fixture();
    await createBrowserSession('https://safe.example/');
    const request = f.route('https://external.example/frame', { subframe: true });
    await f.handle(request);
    expect(request.continue).toHaveBeenCalled();
    await f.pause('https://external.example/frame', 'iframe', undefined, 'child');
    expect(f.cdp.send).toHaveBeenCalledWith('Fetch.continueRequest', { requestId: 'iframe' });
  });

  it('checks local file directories and rejects web origins and unsupported protocols', async () => {
    const f = fixture();
    await createBrowserSession('file:///tmp/fixtures/task.html');
    for (const url of ['file:///tmp/secrets.txt', 'https://safe.example/', 'data:text/html,test', 'blob:https://safe.example/id']) {
      const request = f.route(url);
      await f.handle(request);
      expect(request.abort).toHaveBeenCalled();
    }
    const same = f.route('file:///tmp/fixtures/other.html');
    await f.handle(same);
    expect(same.continue).toHaveBeenCalled();
  });

  it('keeps structured setup failure and closes when native interception cannot install', async () => {
    const f = fixture();
    const original = f.cdp.send.getMockImplementation()!;
    f.cdp.send.mockImplementation(async (method, params) => {
      if (method === 'Fetch.enable') throw new Error('Fetch domain unavailable');
      return original(method, params);
    });
    const error = await createBrowserSession('https://safe.example/').catch((error) => error);
    expect(error).toBeInstanceOf(BrowserSetupError);
    expect(error.message).toContain('Fetch domain unavailable');
    expect(f.page.goto).not.toHaveBeenCalled();
    expect(f.browser.close).toHaveBeenCalled();
  });

  it('closes the context if native interception fails during navigation', async () => {
    const f = fixture();
    const session = await createBrowserSession('https://safe.example/');
    f.cdp.send.mockRejectedValueOnce(new Error('CDP disconnected'));
    await f.pause('https://safe.example/next', 'fails');
    expect(f.context.close).toHaveBeenCalled();
    expect(session.takeBlockedNavigations().at(-1)?.reason).toContain('context was closed');
  });

  it('treats an unexpected CDP detach as a guard failure but permits normal shutdown', async () => {
    const f = fixture();
    const session = await createBrowserSession('https://safe.example/');
    await session.close();
    f.cdp.emit('close');
    expect(session.takeNavigationGuardWarnings()).toEqual([]);
    const next = fixture();
    await createBrowserSession('https://safe.example/');
    next.cdp.emit('close');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(next.context.close).toHaveBeenCalled();
  });

  it('cleans the launched browser when context creation fails', async () => {
    const f = fixture();
    f.browser.newContext.mockRejectedValue(new Error('setup failure'));
    await expect(createBrowserSession('https://safe.example/')).rejects.toThrow('setup failure');
    expect(f.browser.close).toHaveBeenCalled();
  });
});

describe('explicit browser proxy configuration',()=>{
  it.each(['http://127.0.0.1:3128','https://proxy.example:443','socks4://127.0.0.1:9050','socks5://127.0.0.1:1080'])('passes a credential-free %s proxy without disabling TLS or sandboxing',async proxyServer=>{
    fixture();const session=await createBrowserSession('https://safe.example/task',{proxyServer});
    const launch=mocks.launch.mock.calls[0]![0];expect(launch.proxy.server).toBe(new URL(proxyServer).href.replace(/\/$/,''));expect(launch.chromiumSandbox).toBe(true);expect(launch.ignoreHTTPSErrors).toBeUndefined();await session.close();
  });
  it.each(['','not a URL','ftp://proxy.example','http://user:password@proxy.example','http://proxy.example/path','http://proxy.example/?secret=x','http://proxy.example/#fragment'])('rejects invalid or credential-bearing proxy %s before launch',async proxyServer=>{
    fixture();await expect(createBrowserSession('https://safe.example/task',{proxyServer})).rejects.toThrow(/Proxy server/);expect(mocks.launch).not.toHaveBeenCalled();
  });
  it('does not implicitly consume ambient proxy variables',async()=>{fixture();const session=await createBrowserSession('https://safe.example/task');expect(mocks.launch.mock.calls[0]![0].proxy).toBeUndefined();await session.close()});
});

describe('connecting to a browser the person started (cdpEndpoint)',()=>{
  it('connects instead of launching, runs in its own context with every guard, and only disconnects on close',async()=>{
    const f=fixture();const session=await createBrowserSession('https://safe.example/task',{cdpEndpoint:'http://localhost:9222/',headless:true,executablePath:'/ignored'});
    expect(mocks.launch).not.toHaveBeenCalled();expect(mocks.connectOverCDP).toHaveBeenCalledWith('http://localhost:9222');
    expect(f.browser.newContext).toHaveBeenCalledWith(expect.objectContaining({serviceWorkers:'block'}));
    for(const step of ['route','Fetch.enable','init-script'])expect(f.calls.indexOf(step)).toBeLessThan(f.calls.indexOf('goto'));
    expect(session.connected).toBe(true);expect(session.armGuards).toBeUndefined();
    await session.close();expect(f.context.close).toHaveBeenCalled();expect(f.browser.close).toHaveBeenCalled();
  });
  it.each(['http://192.168.0.10:9222','http://example.com:9222','http://user:pw@localhost:9222','ftp://localhost:9222','not a URL'])('rejects %s before connecting',async cdpEndpoint=>{
    fixture();await expect(createBrowserSession('https://safe.example/task',{cdpEndpoint})).rejects.toThrow(/Browser address/);expect(mocks.connectOverCDP).not.toHaveBeenCalled();
  });
  it('accepts ws and IPv6 loopback addresses',async()=>{fixture();await (await createBrowserSession('https://safe.example/task',{cdpEndpoint:'ws://[::1]:9222/devtools/browser/abc'})).close();expect(mocks.connectOverCDP).toHaveBeenCalledWith('ws://[::1]:9222/devtools/browser/abc');});
  it('refuses a proxy, which belongs to the browser the person started',async()=>{fixture();await expect(createBrowserSession('https://safe.example/task',{cdpEndpoint:'http://127.0.0.1:9222',proxyServer:'http://127.0.0.1:3128'})).rejects.toThrow(/proxy/i);expect(mocks.connectOverCDP).not.toHaveBeenCalled();});
  it('opens the page bare for a person check and arms the guards afterwards',async()=>{
    const f=fixture();const guarded=f.page.goto;f.page.goto=vi.fn(async(url:string)=>f.calls.includes('route')?guarded(url):void f.calls.push('bare-goto'));
    const session=await createBrowserSession('https://safe.example/task',{cdpEndpoint:'http://localhost:9222',personCheck:true});expect(f.calls).toContain('bare-goto');
    expect(f.calls).not.toContain('route');expect(session.armGuards).toBeTypeOf('function');
    await session.armGuards!();expect(f.calls).toContain('route');await session.close();
  });
  describe('when the connection fails',()=>{
    const connectFailure=async(cdpEndpoint='http://localhost:9222')=>createBrowserSession('https://safe.example/task',{cdpEndpoint}).then(()=>{throw new Error('connected');},(error:unknown)=>error as BrowserConnectError);
    afterEach(()=>{vi.unstubAllGlobals();});
    it('explains how to start the browser when nothing answers',async()=>{
      fixture();mocks.connectOverCDP.mockRejectedValue(new Error('ECONNREFUSED'));vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('fetch failed');}));
      const error=await connectFailure();
      expect(error).toBeInstanceOf(BrowserConnectError);expect(error.reason).toBe('not-listening');expect(error.message).toMatch(/No browser answered.*--remote-debugging-port.*--user-data-dir/);
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('http://localhost:9222/json/version',expect.anything());
    });
    it('says the browser refused when DevTools answers but Playwright cannot attach, naming only the protocol method',async()=>{
      fixture();mocks.connectOverCDP.mockRejectedValue(new Error('browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.'));
      vi.stubGlobal('fetch',vi.fn(async()=>Response.json({Browser:'Chrome/140.0.0.0',webSocketDebuggerUrl:'ws://localhost:9222/devtools/browser/abc'})));
      const error=await connectFailure('ws://localhost:9222/devtools/browser/abc');
      expect(error.reason).toBe('refused');expect(error.message).toContain('answered but refused the connection (Browser.setDownloadBehavior)');
      expect(error.message).toMatch(/guest, incognito and profile-picker.*fresh --user-data-dir/);expect(error.message).not.toContain('not supported');
      expect(vi.mocked(fetch)).toHaveBeenCalledWith('http://localhost:9222/json/version',expect.anything());
    });
    it.each([['an HTML page',()=>new Response('<html>dev server</html>',{headers:{'content-type':'text/html'}})],['an error status',()=>new Response('nope',{status:404})],['JSON without a debugger URL',()=>Response.json({hello:'world'})]])('says the address is not Chrome DevTools when it answers with %s',async(_label,respond)=>{
      fixture();mocks.connectOverCDP.mockRejectedValue(new Error('Unexpected status 404'));vi.stubGlobal('fetch',vi.fn(async()=>respond()));
      const error=await connectFailure();
      expect(error.reason).toBe('not-devtools');expect(error.message).toMatch(/not Chrome DevTools/);expect(error.message).not.toContain('dev server');
    });
  });
});
