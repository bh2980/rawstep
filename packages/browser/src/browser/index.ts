import { applyProfile, installProfileStyles, type AppliedProfile, type EnvironmentProfile, type NativeZoomController } from '../profiles/index.js';
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { ResolvedNavigationPolicy, VerifySpec } from "@rawstep/core/contracts";
import { DEFAULT_VIEWPORT, SETTLE_MS } from "./constants.js";
import { RawstepError } from "@rawstep/core/errors";
import { installNavigationRequestBoundary } from "./navigation-boundary.js";
import { installPageObserver, type ObserverOptions, type PageObserver } from "../observer/index.js";

export type NetworkRequestRecord = {
  url: string;
  method: string;
  timestamp: string;
};

export type NetworkResponseRecord = {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  timestamp: string;
};

export type NetworkLog = {
  requests: NetworkRequestRecord[];
  responses: NetworkResponseRecord[];
};

export type BlockedNavigationRecord = {
  url: string;
  fromUrl: string;
  reason: string;
  timestamp: string;
};

export type NavigationGuardWarningRecord = {
  scope: "navigationGuard";
  level: "warn";
  code: "NAVIGATION_GUARD_INSTALL_WARNING";
  message: string;
  error?: string;
  stack?: string;
};

export type DomEventRecord = {
  selector: string;
  event: string;
  timestamp: string;
  url: string;
};

export type BrowserSession = {
  /** Absent for a persistent profile, whose context is the browser. */
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  network: NetworkLog;
  domEvents: DomEventRecord[];
  navigation: {
    policy: ResolvedNavigationPolicy;
    allowedOrigin: string;
    startUrlPrefix: string;
    blocked: BlockedNavigationRecord[];
    warnings: NavigationGuardWarningRecord[];
  };
  /** Exact native window owned by a trusted prepaired factory, when applicable. */
  nativeTargetWindowId?: number;
  /** Isolated-world change recorder for hints and goal signals; never visible to the policy. */
  observer?: PageObserver;
  appliedProfile?: AppliedProfile;
  setupTimings?: {
    browserLaunchMs: number;
    pageLoadMs: number;
  };
  takeBlockedNavigations(): BlockedNavigationRecord[];
  takeNavigationGuardWarnings(): NavigationGuardWarningRecord[];
  close(): Promise<void>;
  /**
   * Present while a person may still be passing a human check: the page was opened bare, with nothing attached. Arming installs
   * the observer, profile, routing and navigation guards and reloads the start address; it removes itself once called.
   */
  armGuards?: () => Promise<void>;
};

export class BrowserAccessBlockedError extends RawstepError {
  static override readonly errorName = 'BrowserAccessBlockedError';
  constructor(readonly url:string,readonly status:number|undefined,reason:string){super('access-blocked',reason,{outcome:{status:'inconclusive',reason:'access-blocked'}});this.name='BrowserAccessBlockedError';}
}

export class BrowserSetupError extends RawstepError {
  static override readonly errorName = 'BrowserSetupError';
  constructor(message: string, readonly blockedNavigations: BlockedNavigationRecord[], readonly warnings: NavigationGuardWarningRecord[], cause: unknown) {
    super("browser-setup", message, { cause });
    this.name = "BrowserSetupError";
  }
}

export type CreateBrowserSessionOptions = {
  profile?: EnvironmentProfile;
  nativeZoom?: NativeZoomController;
  headless?: boolean;
  executablePath?: string;
  /** Explicit credential-free HTTP(S)/SOCKS proxy. No environment-variable auto-discovery. */
  proxyServer?: string;
  navigation?: ResolvedNavigationPolicy;
  verify?: VerifySpec;
  /** Page observer is on by default; false skips it, an object tunes its limits. */
  observe?: boolean | ObserverOptions;
  /**
   * A browser profile directory kept between runs (cookies, storage). Used when a person passes a site's own human check in the
   * visible window: the installed Chrome is preferred, and the check's pages are let through the navigation guard. Nothing is
   * spoofed and no check is answered automatically.
   */
  userDataDir?: string;
};

/** Hosts that serve human checks (Cloudflare Turnstile/challenges, hCaptcha, reCAPTCHA). */
const BOT_CHECK_HOSTS = /(^|\.)(challenges\.cloudflare\.com|hcaptcha\.com|recaptcha\.net)$/;
export function isBotCheckUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return BOT_CHECK_HOSTS.test(parsed.hostname) || (parsed.hostname === 'www.google.com' && parsed.pathname.startsWith('/recaptcha')) || parsed.search.includes('__cf_chl');
  } catch { return false; }
}
/**
 * Whether the page is a human-check interstitial instead of the site: a check address, a check title, or the marks a Cloudflare
 * challenge page carries even when the site brands it (its challenge form or orchestration script, or a short page with a Ray ID).
 * A check widget inside an ordinary page (an invisible reCAPTCHA next to ads, a Turnstile box on a form) is not one.
 */
export async function isBotCheckPage(page: Page): Promise<boolean> {
  if (isBotCheckUrl(page.url())) return true;
  const title = await page.title().catch(() => '');
  if (/just a moment|attention required|checking your browser|verify (you are|you're) human|잠시만 기다려|보안 확인/i.test(title)) return true;
  return await page.evaluate(() => {
    if (document.querySelector('#challenge-form, #challenge-running, #cf-challenge-running, script[src*="/cdn-cgi/challenge-platform/h/"]')) return true;
    const text = document.body?.innerText ?? '';
    return text.length < 3000 && /ray[ _]?id/i.test(text);
  }).catch(() => false);
}

export function validateProxyServer(value: string): string {
  let proxy: URL;
  try { proxy = new URL(value); } catch { throw new Error('Proxy server must be a credential-free HTTP(S) or SOCKS URL.'); }
  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(proxy.protocol) || !proxy.hostname || proxy.username || proxy.password || proxy.search || proxy.hash || (proxy.pathname && proxy.pathname !== '/')) throw new Error('Proxy server must be a credential-free HTTP(S) or SOCKS URL without a path, query or fragment.');
  return proxy.href.replace(/\/$/, '');
}

/**
 * An explicit executable is used as given. Otherwise Playwright's own Chromium is tried first and then the
 * installed Google Chrome, so a fresh machine works without `playwright install` when Chrome is present.
 */
/** A persistent profile: the installed Google Chrome first (what a person uses), then Playwright's Chromium. */
async function launchPersistent(userDataDir: string, launch: Parameters<typeof chromium.launchPersistentContext>[1], executablePath?: string): Promise<BrowserContext> {
  if (executablePath) return chromium.launchPersistentContext(userDataDir, { ...launch, executablePath });
  try { return await chromium.launchPersistentContext(userDataDir, { ...launch, channel: "chrome" }); }
  catch (installed) {
    try { return await chromium.launchPersistentContext(userDataDir, launch); }
    catch { throw new RawstepError("browser-setup", "No browser to launch: install Google Chrome, run `npx playwright install chromium`, or set the Chrome executable path.", { cause: installed }); }
  }
}

async function launchChromium(launch: Parameters<typeof chromium.launch>[0], executablePath?: string): Promise<Browser> {
  if (executablePath) return chromium.launch({ ...launch, executablePath });
  try { return await chromium.launch(launch); }
  catch (bundled) {
    try { return await chromium.launch({ ...launch, channel: "chrome" }); }
    catch {
      throw new RawstepError("browser-setup", "No browser to launch: install Google Chrome, run `npx playwright install chromium`, or set the Chrome executable path.", { cause: bundled });
    }
  }
}

export async function createBrowserSession(
  url: string,
  options: CreateBrowserSessionOptions = {}
): Promise<BrowserSession> {
  const proxyServer = options.proxyServer === undefined ? undefined : validateProxyServer(options.proxyServer);
  const browserLaunchStartedAt = Date.now();
  const launch = {
    headless: options.headless ?? true,
    // Rawstep owns cancellation and must finalize its trace before exiting.
    // Playwright's SIGINT handler calls process.exit(130) after closing Chrome.
    handleSIGINT: false,
    handleSIGTERM: false,
    chromiumSandbox: true,
    ...(proxyServer ? { proxy: { server: proxyServer } } : {})
  };
  const contextOptions = {
    serviceWorkers: "block" as const,
    ...(options.profile ? { colorScheme: options.profile.colorScheme, forcedColors: options.profile.forcedColors, contrast: options.profile.contrast, reducedMotion: options.profile.reducedMotion } : {}),
    viewport: options.profile?.viewport ?? { width: DEFAULT_VIEWPORT.w, height: DEFAULT_VIEWPORT.h }
  };
  const persistent = options.userDataDir ? await launchPersistent(options.userDataDir, { ...launch, ...contextOptions }, options.executablePath) : undefined;
  const browser = persistent ? undefined : await launchChromium(launch, options.executablePath);
  const closeBrowser = async () => { await (persistent ?? browser)!.close(); };
  const browserLaunchMs = Date.now() - browserLaunchStartedAt;
  const blockedNavigations: BlockedNavigationRecord[] = [];
  const navigationGuardWarnings: NavigationGuardWarningRecord[] = [];
  let stopNavigationGuard = () => {};
  let observer: PageObserver | undefined;
  try {
    const context = persistent ?? await browser!.newContext(contextOptions);
    // A persistent profile opens with a tab of its own; use it, and close any others it restored.
    const page = persistent ? persistent.pages()[0] ?? await persistent.newPage() : await context.newPage();
    if (persistent) for (const extra of persistent.pages().filter(other => other !== page)) await extra.close().catch(() => undefined);
    const network: NetworkLog = {
      requests: [],
      responses: []
    };
    const domEvents: DomEventRecord[] = [];

    page.on("request", (request) => {
      network.requests.push({
        url: request.url(),
        method: request.method(),
        timestamp: new Date().toISOString()
      });
    });

    page.on("response", (response) => {
      network.responses.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        ok: response.ok(),
        timestamp: new Date().toISOString()
      });
    });

    const navigationPolicy = options.navigation ?? DEFAULT_NAVIGATION_POLICY;
    const allowedOrigin = getAllowedOrigin(url);
    const startUrlPrefix = stripHash(url);

    const recordBlockedNavigation = (targetUrl: string, reason: string, fromUrl = page.url()) => {
      blockedNavigations.push({
        url: targetUrl,
        fromUrl,
        reason,
        timestamp: new Date().toISOString()
      });
    };

    const recordNavigationGuardWarning = (warning: NavigationGuardWarningRecord) => {
      navigationGuardWarnings.push(warning);
    };

    const session: BrowserSession = {
      ...(browser ? { browser } : {}),
      context,
      page,
      network,
      domEvents,
      navigation: {
        policy: navigationPolicy,
        allowedOrigin,
        startUrlPrefix,
        blocked: blockedNavigations,
        warnings: navigationGuardWarnings
      },
      setupTimings: {
        browserLaunchMs,
        pageLoadMs: 0
      },
      takeBlockedNavigations: () => blockedNavigations.splice(0, blockedNavigations.length),
      takeNavigationGuardWarnings: () => navigationGuardWarnings.splice(0, navigationGuardWarnings.length),
      close: async () => {
        stopNavigationGuard();
        await observer?.close();
        try {
          await context.close();
        } finally {
          await closeBrowser().catch(() => undefined);
        }
      }
    };

    /**
     * Everything Rawstep attaches to the page — profile styles, the observer, the DOM event recorder, request routing and the
     * native and in-page navigation guards — and then the start address, so the first document is observed and guarded.
     */
    const arm = async () => {
      if (options.profile) await installProfileStyles(page, options.profile);
      // Before the first navigation, so the initial document is observed too.
      observer = options.observe === false ? undefined : await installPageObserver(page, typeof options.observe === "object" ? options.observe : {});
      await installDomEventRecorder(page, {
        verify: options.verify,
        onDomEvent: (event) => {
          domEvents.push(event);
        }
      });
      {
        await context.route("**/*", async (route) => {
          const request = route.request();
          if (options.navigation?.readOnly && !['GET','HEAD','OPTIONS'].includes(request.method())) {
            recordBlockedNavigation(request.url(), `Read-only run blocked ${request.method()} request before transmission.`); await route.abort('blockedbyclient'); return;
          }
          if (matchesDeniedUrl(request.url(), options.navigation?.denyUrlIncludes ?? [])) {
            recordBlockedNavigation(request.url(), 'Request URL matches an explicitly excluded flow.'); await route.abort('blockedbyclient'); return;
          }
          if (!request.isNavigationRequest()) {
            await route.continue();
            return;
          }
          let frame;
          try { frame = request.frame(); }
          catch {
            recordBlockedNavigation(request.url(), "Navigation has no verifiable frame; blocked before sending.");
            await route.abort("aborted");
            return;
          }
          // Block the first popup request before it leaves the browser, not only after page creation.
          if (frame.page() !== page) {
            recordBlockedNavigation(request.url(), getPopupBlockReason(request.url()));
            await route.abort("aborted");
            return;
          }
          if (frame !== page.mainFrame()) {
            await route.continue();
            return;
          }

          const reason = getNavigationBlockReason(request.url(), {
            allowedOrigin,
            startUrlPrefix,
            policy: navigationPolicy,
            allowBotChecks: !!options.userDataDir
          });
          if (!reason) {
            // The independent native boundary below checks every redirect hop.
            // Preserve Chromium's real navigation rather than fetching/fulfilling.
            await route.continue();
            return;
          }

          recordBlockedNavigation(request.url(), reason);
          await route.abort("aborted");
        });

        stopNavigationGuard = await installNavigationRequestBoundary(context, page, {
          blockReason: (targetUrl, method) => options.navigation?.readOnly && method && !["GET","HEAD","OPTIONS"].includes(method) ? `Read-only run blocked ${method} navigation before transmission.` : getNavigationBlockReason(targetUrl, {
            allowedOrigin, startUrlPrefix, policy: navigationPolicy, allowBotChecks: !!options.userDataDir
          }),
          onBlocked: recordBlockedNavigation,
          onFailure: (error) => {
            recordBlockedNavigation(page.url(), "Navigation guard failed; the browser context was closed to prevent unguarded navigation.");
            recordNavigationGuardWarning(createNavigationGuardInstallWarning("CDP", "Native navigation interception failed.", error));
          }
        });

        await installDocumentNavigationGuard(page, {
          allowedOrigin,
          startUrlPrefix,
          policy: navigationPolicy,
          allowBotChecks: !!options.userDataDir,
          onBlockedNavigation: recordBlockedNavigation,
          onInstallWarning: recordNavigationGuardWarning
        });
      }

      context.on("page", (opened) => {
        if (opened === page) return;
        recordBlockedNavigation(opened.url(), getPopupBlockReason(opened.url()));
        void opened.close().catch(() => undefined);
      });
      const pageLoadStartedAt = Date.now();
      const initialResponse=await page.goto(url, { waitUntil: "load" });
      if(options.navigation?.readOnly && initialResponse && [401,403,407,429].includes(initialResponse.status()))throw new BrowserAccessBlockedError(initialResponse.url(),initialResponse.status(),`Public read-only navigation was blocked by HTTP ${initialResponse.status()}; no alternate route or authentication attempted.`);
      await waitForNetworkIdleBestEffort(page);
      if(options.navigation?.readOnly){const title=await page.title();const challenge=await page.locator('iframe[src*="captcha" i],iframe[src*="challenge" i]').count();if(challenge||/access denied|verify (you are|you're) human|just a moment|robot check/i.test(title))throw new BrowserAccessBlockedError(page.url(),initialResponse?.status(),'Public read-only page presents an access or human-verification barrier; no challenge interaction attempted.');}
      const appliedProfile = options.profile ? await applyProfile(page, options.profile, { nativeZoom: options.nativeZoom }) : undefined;
      if (appliedProfile) session.appliedProfile = appliedProfile;
      if (observer) session.observer = observer;
      session.setupTimings!.pageLoadMs = Date.now() - pageLoadStartedAt;
    };

    // A person passing a human check gets the bare page: nothing is attached until the check is gone, and arming then reloads
    // the start address with every guard in place. Nothing is hidden and no check is answered.
    if (options.userDataDir) {
      await page.goto(url, { waitUntil: "load" });
      await waitForNetworkIdleBestEffort(page);
      session.armGuards = async () => { delete session.armGuards; try { await arm(); } catch (error) { throw await setupFailed(error); } };
      return session;
    }
    await arm();
    return session;
  } catch (error) {
    throw await setupFailed(error);
  }
  async function setupFailed(error: unknown): Promise<BrowserSetupError> {
    stopNavigationGuard();
    await closeBrowser().catch(() => undefined);
    // Preserve an explicit access barrier even if its challenge page also attempted
    // a blocked POST. A secondary request must not hide the actual HTTP barrier.
    const message = error instanceof BrowserAccessBlockedError ? error.message : blockedNavigations.at(-1)?.reason ?? (error instanceof Error ? error.message : String(error));
    return new BrowserSetupError(message, blockedNavigations, navigationGuardWarnings, error);
  }
}

export async function closeBrowserSession(session: BrowserSession): Promise<void> {
  await session.close();
}

/** Request kinds that stay open by design (live feeds, beacons); they never mean "the page is still answering the action". */
const LONG_LIVED = new Set(["eventsource", "websocket", "ping"]);
export type PageActivity = {
  /** Resolves once the page has been still for `quietMs` — no request in flight, no address change, no DOM change — or after `maxMs`. */
  settle(options: { quietMs: number; maxMs: number }): Promise<void>;
  stop(): void;
};
/**
 * Watches what a page does in answer to an action: the requests it starts (a route's code, its data) and its address changing.
 * Start it before the action so a request sent at the moment of the click is seen; then settle on those signals instead of a fixed wait.
 */
export function watchPageActivity(page: Page): PageActivity {
  const pending = new Set<unknown>();
  let last = Date.now();
  const touch = () => { last = Date.now(); };
  const started = (request: { resourceType(): string }) => { if (!LONG_LIVED.has(request.resourceType())) { pending.add(request); touch(); } };
  const ended = (request: unknown) => { if (pending.delete(request)) touch(); };
  const navigated = (frame: unknown) => { if (frame === page.mainFrame()) touch(); };
  page.on("request", started); page.on("requestfinished", ended); page.on("requestfailed", ended); page.on("framenavigated", navigated);
  const stop = () => { page.off("request", started); page.off("requestfinished", ended); page.off("requestfailed", ended); page.off("framenavigated", navigated); };
  return {
    stop,
    async settle({ quietMs, maxMs }) {
      const deadline = Date.now() + maxMs;
      try {
        // Network and navigation first, then the DOM: a route renders after its code arrives.
        while (Date.now() < deadline && (pending.size > 0 || Date.now() - last < quietMs)) await new Promise(resolve => setTimeout(resolve, 50));
        const left = deadline - Date.now();
        if (left > 0) await Promise.resolve().then(() => page.evaluate(({ ms, maxMs }) => new Promise<void>(resolve => {
          let timer: ReturnType<typeof setTimeout>;
          const done = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); };
          const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, ms); });
          observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
          timer = setTimeout(done, ms);
          const cap = setTimeout(done, maxMs);
        }), { ms: quietMs, maxMs: left })).catch(() => undefined);
      } finally { stop(); }
    },
  };
}

export async function settlePage(page: Page, activity?: PageActivity): Promise<void> {
  if (activity) await activity.settle({ quietMs: ACTIVITY_QUIET_MS, maxMs: ACTIVITY_MAX_MS });
  else await waitForNetworkIdleBestEffort(page);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}
/** After an activation: still for this long counts as settled; never wait longer than the cap (live feeds, polling). */
const ACTIVITY_QUIET_MS = 300, ACTIVITY_MAX_MS = 3000;

type DomEventRecorderConfig = {
  selector: string;
  event: string;
};

type DomEventBindingPayload = {
  selector?: unknown;
  event?: unknown;
  url?: unknown;
};

async function waitForNetworkIdleBestEffort(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 1000 });
  } catch {
    // Best effort only. User-perceived stability matters more than strict idle.
  }
}

async function installDomEventRecorder(
  page: Page,
  context: {
    verify?: VerifySpec;
    onDomEvent: (event: DomEventRecord) => void;
  }
): Promise<void> {
  const configs = resolveDomEventRecorderConfigs(context.verify);
  if (configs.length === 0) {
    return;
  }

  const bindingName = "__rawstepReportDomEvent";
  await page.exposeBinding(bindingName, async (_source, payload: unknown) => {
    const candidate = payload as DomEventBindingPayload | undefined;
    if (typeof candidate?.selector !== "string" || candidate.selector.trim().length === 0) {
      return;
    }
    if (typeof candidate?.event !== "string" || candidate.event.trim().length === 0) {
      return;
    }

    context.onDomEvent({
      selector: candidate.selector.trim(),
      event: candidate.event.trim(),
      timestamp: new Date().toISOString(),
      url: typeof candidate.url === "string" && candidate.url.length > 0 ? candidate.url : page.url()
    });
  });

  const initScript = createDomEventRecorderScript({
    bindingName,
    configs
  });
  await page.addInitScript({ content: initScript });
  try {
    await page.evaluate(initScript);
  } catch {
    // The page may still be initializing. The init script will run on subsequent documents.
  }
}

function resolveDomEventRecorderConfigs(verify?: VerifySpec): DomEventRecorderConfig[] {
  if (!verify) {
    return [];
  }

  const deduped = new Map<string, DomEventRecorderConfig>();
  for (const rule of verify.all) {
    if (!("domEventSeen" in rule)) {
      continue;
    }

    const config = {
      selector: rule.domEventSeen.selector,
      event: rule.domEventSeen.event
    };
    deduped.set(`${config.selector}::${config.event}`, config);
  }

  return [...deduped.values()];
}

function createDomEventRecorderScript(config: {
  bindingName: string;
  configs: DomEventRecorderConfig[];
}): string {
  return `(${DOM_EVENT_RECORDER_INSTALLER_SOURCE})(${JSON.stringify(config)})`;
}

const DEFAULT_NAVIGATION_POLICY: ResolvedNavigationPolicy = {
  strategy: "same-origin"
};

const DOM_EVENT_RECORDER_INSTALLER_SOURCE = String.raw`function(config) {
  const globalWindow = window;
  const root = globalWindow.__rawstepDomEventRecorder = globalWindow.__rawstepDomEventRecorder || {};
  root.listenerKeys = root.listenerKeys || {};

  const binding = globalWindow[config.bindingName];
  if (typeof binding !== "function") {
    return;
  }

  const report = function(selector, eventName) {
    Promise.resolve(binding({
      selector,
      event: eventName,
      url: window.location.href
    })).catch(function() {
      return undefined;
    });
  };

  const attachDelegatedListener = function(selector, eventName) {
    const listenerKey = selector + "::" + eventName;
    if (root.listenerKeys[listenerKey]) {
      return;
    }

    document.addEventListener(eventName, function(event) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      let matched;
      try {
        matched = target.closest(selector);
      } catch {
        return;
      }

      if (matched) {
        report(selector, eventName);
      }
    }, true);
    root.listenerKeys[listenerKey] = true;
  };

  for (let index = 0; index < config.configs.length; index += 1) {
    const entry = config.configs[index];
    attachDelegatedListener(entry.selector, entry.event);
  }
}`;

function getAllowedOrigin(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "file:" ? new URL(".", parsed).href : parsed.origin;
  } catch {
    return rawUrl;
  }
}

function getNavigationBlockReason(
  targetUrl: string,
  context: {
    allowedOrigin: string;
    startUrlPrefix: string;
    policy: ResolvedNavigationPolicy;
    /** A person passes human checks in this run, so the check's own pages must load. */
    allowBotChecks?: boolean;
  }
): string | undefined {
  if (context.allowBotChecks && isBotCheckUrl(targetUrl)) return undefined;
  try {
    const target = new URL(targetUrl);
    if (!["http:", "https:", "file:"].includes(target.protocol) || target.username || target.password) {
      return `Blocked unsupported or credential-bearing navigation to ${targetUrl}.`;
    }
  } catch {
    return `Blocked invalid navigation URL ${targetUrl}.`;
  }
  if (matchesDeniedUrl(targetUrl, context.policy.denyUrlIncludes ?? [])) return "Navigation URL matches an explicitly excluded flow.";
  if (context.policy.strategy === "same-origin") {
    return isSameOriginNavigation(targetUrl, context.allowedOrigin)
      ? undefined
      : `Blocked navigation to ${targetUrl}. Strategy "same-origin" only allows top-level navigation within origin ${context.allowedOrigin}. Stay on the current page and try a different path.`;
  }

  if (context.policy.strategy === "start-url-prefix") {
    return matchesUrlPrefix(targetUrl, context.startUrlPrefix)
      ? undefined
      : `Blocked navigation to ${targetUrl}. Strategy "start-url-prefix" only allows top-level navigation under ${context.startUrlPrefix}. Stay on the current page and try a different path.`;
  }

  return context.policy.allowUrlList.some((prefix) => matchesUrlPrefix(targetUrl, prefix))
    ? undefined
    : `Blocked navigation to ${targetUrl}. Strategy "allow-url-list" only allows top-level navigation matching: ${context.policy.allowUrlList.join(", ")}. Stay on the current page and try a different path.`;
}

function matchesDeniedUrl(url:string, denied:readonly string[]):boolean {
  let decoded=url;try{decoded=decodeURIComponent(url)}catch{}
  return denied.some(value=>url.toLowerCase().includes(value.toLowerCase())||decoded.toLowerCase().includes(value.toLowerCase()));
}
function matchesUrlPrefix(targetUrl: string, prefix: string): boolean {
  try {
    const target = new URL(targetUrl);
    const allowed = new URL(prefix);
    return target.protocol === allowed.protocol && target.origin === allowed.origin
      && !target.username && !target.password && target.href.startsWith(allowed.href);
  } catch { return false; }
}

function isSameOriginNavigation(targetUrl: string, allowedOrigin: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === "file:"
      ? new URL(".", parsed).href === allowedOrigin
      : parsed.origin === allowedOrigin;
  } catch {
    return false;
  }
}

async function installDocumentNavigationGuard(
  page: Page,
  context: {
    policy: ResolvedNavigationPolicy;
    onBlockedNavigation: (targetUrl: string, reason: string) => void;
    onInstallWarning: (warning: NavigationGuardWarningRecord) => void;
    allowedOrigin: string;
    startUrlPrefix: string;
    allowBotChecks?: boolean;
  }
): Promise<void> {
  const bindingName = "__rawstepReportNavigationGuardEvent";
  await page.exposeBinding(bindingName, async (_source, payload: unknown) => {
    const candidate = payload as NavigationGuardBindingPayload | undefined;
    if (candidate?.kind === "install-warning") {
      context.onInstallWarning(candidate.warning);
      return;
    }

    const targetUrl = normalizeTargetUrl(candidate?.targetUrl, page.url());
    if(candidate?.source==='read-only-form'){context.onBlockedNavigation(targetUrl,'Read-only run blocked a mutating form submission before transmission.');return;}
    const source = candidate?.source === "popup" ? "popup" : "navigation";
    if (source === "popup") {
      context.onBlockedNavigation(targetUrl, getPopupBlockReason(targetUrl));
      return;
    }

    const reason = getNavigationBlockReason(targetUrl, context);
    if (!reason) {
      return;
    }

    context.onBlockedNavigation(targetUrl, reason);
  });
  const initScript = createDocumentNavigationGuardScript({
    bindingName,
    policy: serializeNavigationPolicy(context.policy),
    allowedOrigin: context.allowedOrigin,
    startUrlPrefix: context.startUrlPrefix,
    reportViaBinding: true
  });
  await page.addInitScript({ content: initScript });
  try {
    await page.evaluate(createDocumentNavigationGuardScript({
      bindingName,
      policy: serializeNavigationPolicy(context.policy),
      allowedOrigin: context.allowedOrigin,
      startUrlPrefix: context.startUrlPrefix,
      reportViaBinding: true
    }));
  } catch (error) {
    context.onInstallWarning(createNavigationGuardInstallWarning(
      "script",
      "Navigation guard setup failed before all hooks were installed.",
      error
    ));
  }

}

function createDocumentNavigationGuardScript(config: {
  bindingName: string;
  policy:
    | { strategy: "same-origin" }
    | { strategy: "start-url-prefix" }
    | { strategy: "allow-url-list"; allowUrlList: string[] };
  allowedOrigin: string;
  startUrlPrefix: string;
  reportViaBinding: boolean;
}): string {
  return `(${DOCUMENT_NAVIGATION_GUARD_INSTALLER_SOURCE})(${JSON.stringify(config)})`;
}

const DOCUMENT_NAVIGATION_GUARD_INSTALLER_SOURCE = String.raw`function(config) {
  const globalWindow = window;
  const warnings = [];
  const buildInstallWarning = function(hook, message, error) {
    return {
      scope: "navigationGuard",
      level: "warn",
      code: "NAVIGATION_GUARD_INSTALL_WARNING",
      message,
      ...(error instanceof Error
        ? {
            error: error.message,
            ...(error.stack ? { stack: error.stack } : {})
          }
        : {})
    };
  };
  if (globalWindow.__rawstepNavigationGuardInstalled) {
    return { warnings };
  }
  globalWindow.__rawstepNavigationGuardInstalled = true;

  const reportEvent = function(payload) {
    if (!config.reportViaBinding) {
      return;
    }

    const binding = globalWindow[config.bindingName];
    if (typeof binding === "function") {
      Promise.resolve(binding(payload)).catch(function() {
        return undefined;
      });
    }
  };

  const reportBlockedNavigation = function(targetUrl, source) {
    reportEvent({ kind: "blocked", targetUrl, source });
  };

  const reportInstallWarning = function(hook, message, error) {
    const warning = buildInstallWarning(hook, message, error);
    warnings.push(warning);
    reportEvent({ kind: "install-warning", warning });
  };

  const normalizeTargetUrlInPage = function(targetUrl) {
    try {
      return new URL(targetUrl, window.location.href).toString();
    } catch {
      return targetUrl;
    }
  };

  const matchesPrefix = function(targetUrl, prefix) {
    try {
      const target = new URL(targetUrl);
      const allowed = new URL(prefix);
      return target.protocol === allowed.protocol && target.origin === allowed.origin
        && !target.username && !target.password && target.href.startsWith(allowed.href);
    } catch { return false; }
  };

  const isAllowedNavigation = function(targetUrl) {
    const normalizedTargetUrl = normalizeTargetUrlInPage(targetUrl);
    try {
      const parsed = new URL(normalizedTargetUrl);
      if (!["http:", "https:", "file:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        return false;
      }
    } catch { return false; }
    let decoded=normalizedTargetUrl;try{decoded=decodeURIComponent(normalizedTargetUrl)}catch{}
    if((config.policy.denyUrlIncludes||[]).some(value=>normalizedTargetUrl.toLowerCase().includes(value.toLowerCase())||decoded.toLowerCase().includes(value.toLowerCase())))return false;
    if (config.policy.strategy === "same-origin") {
      try {
        const parsed = new URL(normalizedTargetUrl);
        const origin = parsed.protocol === "file:" ? new URL(".", parsed).href : parsed.origin;
        return origin === config.allowedOrigin;
      } catch {
        return false;
      }
    }

    if (config.policy.strategy === "start-url-prefix") {
      return matchesPrefix(normalizedTargetUrl, config.startUrlPrefix);
    }

    return config.policy.allowUrlList.some(function(prefix) {
      return matchesPrefix(normalizedTargetUrl, prefix);
    });
  };

  const maybeBlockNavigation = function(targetUrl, source) {
    const normalizedTargetUrl = normalizeTargetUrlInPage(targetUrl);
    const shouldBlock = source === "popup" || !isAllowedNavigation(normalizedTargetUrl);
    if (shouldBlock) {
      reportBlockedNavigation(normalizedTargetUrl, source);
    }

    return shouldBlock;
  };

  const installHook = function(hook, install, validate) {
    try {
      install();
      if (validate && !validate()) {
        reportInstallWarning(hook, 'Navigation guard hook "' + hook + '" did not stick after installation.');
      }
    } catch (error) {
      reportInstallWarning(hook, 'Navigation guard hook "' + hook + '" failed during installation.', error);
    }
  };

  const originalOpen = window.open;
  installHook(
    "window.open",
    function() {
      window.open = function(url) {
        maybeBlockNavigation(String(url ?? ""), "popup");
        return null;
      };
    },
    function() {
      return window.open !== originalOpen;
    }
  );

  const originalAssignFn = window.location.assign;
  const originalAssign = originalAssignFn.bind(window.location);
  installHook(
    "window.location.assign",
    function() {
      window.location.assign = function(url) {
        if (maybeBlockNavigation(String(url), "navigation")) {
          return;
        }

        originalAssign(url);
      };
    },
    function() {
      return window.location.assign !== originalAssignFn;
    }
  );

  const originalReplaceFn = window.location.replace;
  const originalReplace = originalReplaceFn.bind(window.location);
  installHook(
    "window.location.replace",
    function() {
      window.location.replace = function(url) {
        if (maybeBlockNavigation(String(url), "navigation")) {
          return;
        }

        originalReplace(url);
      };
    },
    function() {
      return window.location.replace !== originalReplaceFn;
    }
  );

  // SPA route changes make no network request, so the native request boundary
  // cannot observe them. Keep path-prefix/allow-list policy in force here too.
  for (const method of ["pushState", "replaceState"]) {
    const original = History.prototype[method];
    installHook(
      "history." + method,
      function() {
        History.prototype[method] = function(state, unused, url) {
          if (url !== undefined && url !== null && maybeBlockNavigation(String(url), "navigation")) {
            return;
          }
          return original.apply(this, arguments);
        };
      },
      function() { return History.prototype[method] !== original; }
    );
  }

  // The Navigation API sees same-document changes and direct external-scheme
  // navigations before they commit. HTTP(S)/file requests stay at the native CDP
  // boundary; external protocols may never produce such a request.
  if (window.navigation && typeof window.navigation.addEventListener === "function") {
    installHook("same-document navigation", function() {
      window.navigation.addEventListener("navigate", function(event) {
        if (!event.destination.sameDocument) {
          let protocol;
          try { protocol = new URL(event.destination.url, window.location.href).protocol; }
          catch { protocol = "invalid:"; }
          if (["http:", "https:", "file:"].includes(protocol)) return;
        }
        if (maybeBlockNavigation(event.destination.url, "navigation")) {
          if (event.cancelable) event.preventDefault();
          else reportInstallWarning("same-document navigation", "A disallowed same-document or external-protocol navigation could not be cancelled.");
        }
      });
    });
  }

  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  installHook(
    "HTMLAnchorElement.prototype.click",
    function() {
      HTMLAnchorElement.prototype.click = function() {
        const source = this.target === "_blank" ? "popup" : "navigation";
        if (maybeBlockNavigation(this.href, source)) {
          return;
        }

        originalAnchorClick.call(this);
      };
    },
    function() {
      return HTMLAnchorElement.prototype.click !== originalAnchorClick;
    }
  );

  const maybeBlockForm = function(form,submitter) {
    const method=(submitter&&submitter.getAttribute&&submitter.getAttribute('formmethod')||form.method||'get').toUpperCase();
    if(config.policy.readOnly && !['GET','DIALOG'].includes(method)) { reportEvent({kind:'blocked',targetUrl:form.action||window.location.href,source:'read-only-form'});return true; }
    return false;
  };
  const originalFormSubmit=HTMLFormElement.prototype.submit;
  installHook('HTMLFormElement.prototype.submit',function(){HTMLFormElement.prototype.submit=function(){if(maybeBlockForm(this))return;return originalFormSubmit.apply(this,arguments);};},function(){return HTMLFormElement.prototype.submit!==originalFormSubmit;});
  const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  if (typeof originalRequestSubmit === "function") {
    installHook(
      "HTMLFormElement.prototype.requestSubmit",
      function() {
        HTMLFormElement.prototype.requestSubmit = function(submitter) {
          if(maybeBlockForm(this,submitter))return;
          const source = this.target === "_blank" ? "popup" : "navigation";
          const targetUrl = this.action || window.location.href;
          if (maybeBlockNavigation(targetUrl, source)) {
            return;
          }

          originalRequestSubmit.call(this, submitter);
        };
      },
      function() {
        return HTMLFormElement.prototype.requestSubmit !== originalRequestSubmit;
      }
    );
  }

  installHook(
    "document keydown capture listener",
    function() {
      document.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") {
          return;
        }

        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLAnchorElement && activeElement.href) {
          const source = activeElement.target === "_blank" ? "popup" : "navigation";
          if (maybeBlockNavigation(activeElement.href, source)) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
          return;
        }

        const isSubmitInput = activeElement instanceof HTMLInputElement
          && ["submit", "image"].includes(activeElement.type);
        if (!(activeElement instanceof HTMLButtonElement) && !isSubmitInput) {
          return;
        }

        const form = activeElement.form;
        if (!form) {
          return;
        }

        const source = form.target === "_blank" ? "popup" : "navigation";
        const targetUrl = form.action || window.location.href;
        if (maybeBlockForm(form,activeElement) || maybeBlockNavigation(targetUrl, source)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
  );

  installHook(
    "document click capture listener",
    function() {
      document.addEventListener("click", function(event) {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        const anchor = target.closest("a[href]");
        if (!(anchor instanceof HTMLAnchorElement)) {
          return;
        }

        const source = anchor.target === "_blank" ? "popup" : "navigation";
        if (maybeBlockNavigation(anchor.href, source)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
  );

  installHook(
    "document submit capture listener",
    function() {
      document.addEventListener("submit", function(event) {
        const target = event.target;
        if (!(target instanceof HTMLFormElement)) {
          return;
        }

        const source = target.target === "_blank" ? "popup" : "navigation";
        const targetUrl = target.action || window.location.href;
        if (maybeBlockForm(target,event.submitter) || maybeBlockNavigation(targetUrl, source)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }
  );

  return { warnings };
}`;

type NavigationGuardBindingPayload =
  | {
      kind: "blocked";
      targetUrl: string;
      source: "navigation" | "popup" | "read-only-form";
    }
  | {
      kind: "install-warning";
      warning: NavigationGuardWarningRecord;
    };

function createNavigationGuardInstallWarning(
  hook: string,
  message: string,
  error?: unknown
): NavigationGuardWarningRecord {
  return {
    scope: "navigationGuard",
    level: "warn",
    code: "NAVIGATION_GUARD_INSTALL_WARNING",
    message,
    ...(error instanceof Error
      ? {
          error: error.message,
          ...(error.stack ? { stack: error.stack } : {})
        }
      : {})
  };
}

function normalizeTargetUrl(targetUrl: unknown, baseUrl: string): string {
  if (typeof targetUrl !== "string" || targetUrl.trim().length === 0) {
    return "about:blank";
  }

  try {
    return new URL(targetUrl, baseUrl).toString();
  } catch {
    return targetUrl;
  }
}

function getPopupBlockReason(targetUrl: string): string {
  return `Blocked popup/new-tab navigation to ${targetUrl}. RawStep keeps the task in the current tab. Stay on the current page and try a different path.`;
}

function serializeNavigationPolicy(policy: ResolvedNavigationPolicy): ResolvedNavigationPolicy {
  return structuredClone(policy);
}

function stripHash(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl.replace(/#.*$/, "");
  }
}
