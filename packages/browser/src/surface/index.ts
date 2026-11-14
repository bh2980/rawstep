import { REDACTED } from '@rawstep/core/redacted';
import { isActivation } from '@rawstep/core/actions';
import { RawstepError } from '@rawstep/core/errors';
import type { BackendSession, Task, VerificationRecord } from '@rawstep/core/contracts';
import type { Surface, SurfaceContext, SurfaceOpener } from '@rawstep/core/runner';
import { collectBrowserDiagnostics, verifyLiveProfile, ProfileApplicationError } from '../profiles/index.js';
import { createBrowserSession, focusIsEditable, isBotCheckPage, isBotCheckUrl, settlePage, watchPageActivity, BrowserSetupError, BrowserAccessBlockedError, BLOCKED_NEXT, type BrowserSession, type CreateBrowserSessionOptions, type PageActivity } from '../browser/index.js';
import { verifyTask, type VerificationContext } from '../verify/index.js';
import type { ObserverEvent, ObserverOptions } from '../observer/index.js';

export type WebSurfaceOptions = {
  /** Whether the launched browser is headless (default false: a real screen reader needs a visible one; the simulation passes true). */
  headless?: boolean;
  browserExecutablePath?: string;
  /** Connect to a browser the person started with a remote debugging port instead of launching one (see `cdpEndpoint`). */
  browserEndpoint?: string;
  /** With `browserEndpoint`: start each run with a copy of that browser's sign-in (see `copySignIn`). */
  copySignIn?: boolean;
  proxyServer?: string;
  browserSessionFactory?: (url: string, options: CreateBrowserSessionOptions) => Promise<BrowserSession>;
  /** Page observer for hints; on by default. Never visible to the policy. */
  observe?: boolean | ObserverOptions;
  verifier?: (task: Task, browser: BrowserSession, context?: VerificationContext) => Promise<VerificationRecord>;
  /**
   * A person passes the site's own human checks: the run uses a visible browser with this kept profile, and whenever the page
   * shows a check it waits (up to `timeoutMs`, default 5 minutes) until the page is the site again. The wait does not count
   * against the task's time budget. Rawstep never answers a check itself.
   */
  personCheck?: { userDataDir?: string; timeoutMs?: number };
};
const PERSON_CHECK_TIMEOUT_MS = 5 * 60_000, PERSON_CHECK_POLL_MS = 1000, PERSON_CHECK_CLEAR_MS = 3000;
/** Chromium cannot capture taller images reliably, and pins far down a page are found from the step screenshots instead. */
const START_PAGE_MAX_HEIGHT = 16_000;

/** A web page in Chromium, launched by Rawstep or in a Chrome the person started. */
export function webSurface(options: WebSurfaceOptions = {}): SurfaceOpener {
  const headless = options.headless ?? false;
  return {
    facts: { kind: 'web', headless, customSession: !!options.browserSessionFactory },
    async open(task, context) {
      const opened = await (options.browserSessionFactory ?? createBrowserSession)(task.url, { headless: options.personCheck ? false : headless, ...(options.personCheck ? { personCheck: true, ...(options.personCheck.userDataDir && !options.browserEndpoint ? { userDataDir: options.personCheck.userDataDir } : {}) } : {}), executablePath: options.browserExecutablePath, ...(options.browserEndpoint ? { cdpEndpoint: options.browserEndpoint, ...(options.copySignIn ? { copySignIn: true } : {}) } : {}), proxyServer: options.proxyServer, ...(options.observe !== undefined ? { observe: options.observe } : {}), navigation: task.navigation, verify: task.verify, profile: task.profile });
      if (context.signal.aborted) { await opened.close(); throw context.signal.reason; }
      // A page opened bare for a human check gets its guards and the backend only after the check is passed.
      if (!opened.armGuards) try { await context.backend.attach(sessionOf(opened)); } catch (error) { await opened.close(); throw error; }
      return new WebSurface(task, opened, options, context);
    },
    recordFailure(error, context) {
      const record = (type: string, data: unknown) => recordDiagnostic(context, type, data);
      if (error instanceof BrowserSetupError) {
        for (const blocked of error.blockedNavigations) record('browser.navigation-blocked', blocked);
        for (const warning of error.warnings) record('browser.navigation-warning', warning);
      }
      const accessError = error instanceof BrowserAccessBlockedError ? error : error instanceof Error && error.cause instanceof BrowserAccessBlockedError ? error.cause : undefined;
      if (accessError) record('browser.access-blocked', { url: accessError.url, status: accessError.status, reason: accessError.message });
      const profileError = error instanceof ProfileApplicationError ? error : error instanceof Error && error.cause instanceof ProfileApplicationError ? error.cause : undefined;
      if (profileError) {
        // Profile measurements are page-derived and can contain arbitrary delayed or encoded input echoes: the same taint rule as
        // every other page record.
        const tainted = context.tainted();
        const profile = tainted ? { supported: false, details: REDACTED, reason: 'Profile details omitted after text entry.' } : profileError.appliedProfile;
        context.append('browser.profile', profile, { source: 'surface', redacted: tainted });
        context.updateEnvironment({ profile }, { redacted: tainted });
      }
    },
  };
}

/** Browser diagnostics may carry delayed or form-encoded task input: while input is tainted only the record's type is kept. */
function recordDiagnostic(context: SurfaceContext, type: string, data: unknown) {
  const tainted = context.tainted();
  context.append(type, tainted ? { message: REDACTED, reason: 'Browser diagnostics may contain delayed or form-encoded task input.' } : data, { source: 'surface', redacted: tainted });
}

/** What a backend is handed of an open browser: the page and which process shows it. */
const sessionOf = (browser: BrowserSession): BackendSession => ({ kind: 'web', page: browser.page, ...(browser.browserProcessId !== undefined ? { browserProcessId: browser.browserProcessId } : {}) });

class WebSurface implements Surface {
  readonly session: BackendSession;
  private readonly browser: BrowserSession;
  /**
   * Observer changes keep their structure after text entry so hints still work; only words are withheld. The unredacted timeline
   * stays in memory for goal rules; only the trace copy is redacted.
   */
  private readonly timeline: ObserverEvent[] = [];
  private readonly checkedPages = new Set<string>();
  private readonly taskOrigin: string;
  private activity: PageActivity | undefined;
  readonly baseline?: () => Promise<VerificationRecord>;

  constructor(private readonly task: Task, browser: BrowserSession, private readonly options: WebSurfaceOptions, private readonly context: SurfaceContext) {
    this.browser = browser;
    this.session = sessionOf(browser);
    this.taskOrigin = new URL(task.url).origin;
    // Built-in verifier only: a custom verifier may have side effects or remote calls, and runs only when deciding.
    if (!options.verifier) this.baseline = () => verifyTask(this.task, this.browser, this.observedTimeline());
  }

  private get page() { return this.browser.page; }
  /** Without a working observer there is no timeline at all, so event rules report "unavailable" rather than "nothing happened". */
  private observedTimeline(): { timeline?: readonly ObserverEvent[] } { return this.browser.observer?.available ? { timeline: this.timeline } : {}; }
  private drainObserver() {
    const tainted = this.context.tainted();
    for (const event of this.browser.observer?.take() ?? []) this.timeline.push(event), this.context.append(`observer.${event.kind}`, tainted ? redactObserverEvent(event) : event, { source: 'surface', timestamp: event.at, redacted: tainted });
  }

  async prepare(): Promise<void> {
    const { context, task } = this;
    const browser = this.browser;
    await context.withinBudget(() => this.page.bringToFront());
    await this.waitForPerson(0);
    // Keys must reach the page, not browser UI or another window. A real user starts on the document with nothing focused
    // (unless the page uses autofocus), so the runner never moves focus to an element itself.
    const readInitialFocus = () => this.page.evaluate(() => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      const element = active && active !== document.body && active !== document.documentElement ? active : null;
      return { documentHasFocus: document.hasFocus(), focused: element ? { tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), autofocus: element.hasAttribute('autofocus') } : null };
    });
    // Best effort: a session that cannot evaluate scripts simply records nothing; cancellation and budgets still apply.
    const tryInitialFocus = (): Promise<unknown> => context.bestEffort(readInitialFocus, undefined);
    let initialFocus: unknown = await tryInitialFocus();
    if (initialFocus && typeof initialFocus === 'object' && (initialFocus as { documentHasFocus?: unknown }).documentHasFocus === false) {
      await context.bestEffort(() => this.page.evaluate(() => window.focus()), undefined);
      const retried = await tryInitialFocus();
      initialFocus = retried && typeof retried === 'object' ? { ...retried, focusRequested: true } : initialFocus;
      // Native screen readers send real OS keys: without page focus they would land in browser UI or another window.
      if ((initialFocus as { documentHasFocus?: unknown }).documentHasFocus === false && context.backend.native) throw new RawstepError('backend-precondition', 'The browser page does not have keyboard focus; native key presses would reach browser UI or another window.');
    }
    if (initialFocus && typeof initialFocus === 'object') context.append('browser.initial-focus', initialFocus, { source: 'surface' });
    context.updateEnvironment({ browser: 'chromium', browserVersion: browser.browser?.version?.() ?? 'unknown' });
    if (task.profile) {
      if (!browser.appliedProfile) throw new Error('Browser factory did not verify the requested environment profile.');
      context.append('browser.profile', browser.appliedProfile, { source: 'surface' });
      context.updateEnvironment({ profile: browser.appliedProfile });
      if (task.profile.at) {
        const actual = context.backend.environment;
        const matches = actual?.atName === task.profile.at.name && (!task.profile.at.version || actual?.atVersion === task.profile.at.version);
        context.append('browser.at-profile', { requested: task.profile.at, actual: actual ?? null, verified: matches }, { source: 'surface' });
        if (!matches && task.profile.requireApplied) throw new ProfileApplicationError({ ...browser.appliedProfile, supported: false, settings: [...browser.appliedProfile.settings, { name: 'at', requested: task.profile.at, observed: actual ?? null, status: 'mismatch', mechanism: 'metadata', detail: 'Requested AT name/version is not proved by the backend handshake.' }] });
      }
    }
    if (browser.observer) context.append('observer.metadata', { available: browser.observer.available, world: 'isolated', policyVisible: false, ...(browser.observer.unavailableReason ? { reason: browser.observer.unavailableReason } : {}), limitations: ['Accessible names are approximated in the page and truncated; form values are never read.', 'Cross-origin iframes running in another process are not observed.'] }, { source: 'surface' });
    context.append('browser.metadata', { name: 'chromium', version: browser.browser?.version?.() ?? 'unknown', headless: browser.connected || this.options.personCheck ? false : this.options.headless ?? false, ...(browser.connected ? { connected: true } : this.options.personCheck ? { keptProfile: true } : {}) }, { source: 'surface' });
  }

  /**
   * While the page shows a human check, wait for the person to pass it in the visible window. The check counts as passed only
   * after it has been gone for PERSON_CHECK_CLEAR_MS in a row (a check page reloading with a new token is not a pass). A page that
   * leaves for neither the task's site nor a check host, or a check nobody passes in time, ends the run as access-blocked. The
   * waiting is recorded and kept off the time budget. On a page opened bare, the guards and the backend are attached only now, and
   * a site that shows its check again once they are attached rejects this browser.
   */
  private async waitForPerson(step: number) {
    const { context } = this;
    const browser = this.browser;
    if (!this.options.personCheck) {
      // Without a person to pass it, a check that comes up mid-run ends the run as blocked. The start page was checked when the
      // browser opened; a check comes with a page of its own, so only a page the run has not been on yet is looked at.
      const at = typeof this.page.url === 'function' ? this.page.url() : undefined;
      if (step === 0 || !at || this.checkedPages.has(at)) { if (at) this.checkedPages.add(at); return; }
      this.checkedPages.add(at);
      if (await context.bestEffort(() => isBotCheckPage(this.page), false))
        throw new BrowserAccessBlockedError(at, undefined, `The site showed a bot check after step ${step}. ${BLOCKED_NEXT}`);
      return;
    }
    const bare = !!browser.armGuards;
    let waited = false;
    if (await context.withinBudget(() => isBotCheckPage(this.page))) {
      waited = true;
      const limit = this.options.personCheck.timeoutMs ?? PERSON_CHECK_TIMEOUT_MS;
      context.append('run.waiting-for-person', { step, reason: 'bot-check', timeoutMs: limit }, { source: 'runner' });
      const started = Date.now();
      await context.offClock(async () => {
        let clearSince: number | undefined;
        for (;;) {
          context.signal.throwIfAborted();
          await new Promise(resolve => setTimeout(resolve, PERSON_CHECK_POLL_MS));
          const at = this.page.url();
          if (/^https?:/.test(at) && new URL(at).origin !== this.taskOrigin && !isBotCheckUrl(at)) {
            context.append('run.person-check-left', { step, host: new URL(at).host }, { source: 'runner' });
            throw new BrowserAccessBlockedError(at, undefined, 'The human check sent the page away from the task site; Rawstep does not follow it.');
          }
          if (await isBotCheckPage(this.page).catch(() => true)) clearSince = undefined;
          else if ((clearSince ??= Date.now()) <= Date.now() - PERSON_CHECK_CLEAR_MS) break;
          if (Date.now() - started > limit) {
            context.append('run.person-check-timeout', { step, waitedMs: Date.now() - started }, { source: 'runner' });
            throw new BrowserAccessBlockedError(at, undefined, 'The human check was not passed in time; Rawstep does not answer checks itself.');
          }
        }
      });
      context.append('run.person-resumed', { step, waitedMs: Date.now() - started }, { source: 'runner' });
    }
    if (bare) {
      await context.withinBudget(() => browser.armGuards!());
      if (await context.withinBudget(() => isBotCheckPage(this.page))) {
        context.append('run.person-check-rejected', { step }, { source: 'runner' });
        throw new BrowserAccessBlockedError(this.page.url(), undefined, 'The site showed its human check again once Rawstep attached to the page; it rejects this browser.');
      }
      await context.withinBudget(() => context.backend.attach(this.session));
      context.append('run.guards-armed', { step }, { source: 'runner' });
    }
    if (bare || waited) await context.withinBudget(() => settlePage(this.page));
  }

  async inspect(step: number): Promise<void> {
    const { context, task } = this;
    if (task.profile) {
      const settings = await context.withinBudget(() => verifyLiveProfile(this.page, task.profile!));
      const tainted = context.tainted();
      context.append('browser.profile-check', tainted ? { step, verified: settings.every(s => s.status === 'applied'), details: REDACTED } : { step, verified: settings.every(s => s.status === 'applied'), settings }, { source: 'surface', redacted: tainted });
      if (task.profile.requireApplied && settings.some(s => s.status === 'mismatch')) throw new ProfileApplicationError({ ...this.browser.appliedProfile!, settings, supported: false, verifiedAt: new Date().toISOString() });
    }
    if (task.profile?.diagnostics) {
      const diagnostic = await context.withinBudget(() => collectBrowserDiagnostics(this.page));
      const tainted = context.tainted();
      context.append('browser.accessibility-diagnostic', tainted ? { step, details: REDACTED } : { step, diagnostic }, { source: 'surface', redacted: tainted });
    }
  }

  async documentId(): Promise<number | undefined> {
    const loaded = await this.page.evaluate(() => performance.timeOrigin);
    return typeof loaded === 'number' ? loaded : undefined;
  }

  async title(): Promise<string | undefined> {
    return typeof this.page.title === 'function' ? this.page.title() : undefined;
  }

  focusIsEditable(): Promise<boolean> { return this.page.evaluate(focusIsEditable, null); }

  beforeAction(step: number, action: Parameters<Surface['beforeAction']>[1]): void {
    // Watched from before the action, so a request sent at the moment of the click counts.
    this.activity = isActivation(action) && typeof this.page.on === 'function' ? watchPageActivity(this.page) : undefined;
    this.browser.observer?.setStep(step);
  }

  async afterAction(step: number, executed: boolean): Promise<void> {
    const activity = this.activity;
    this.activity = undefined;
    // An activation may start a route change that renders a moment later: settle on what the page does, not on a fixed wait.
    if (executed) await this.context.withinBudget(() => settlePage(this.page, activity)); else activity?.stop();
    await this.waitForPerson(step);
  }

  flush(options: { final?: boolean } = {}): void {
    this.drainObserver();
    if (options.final) {
      const dropped = this.browser.observer?.dropped() ?? {};
      if (Object.keys(dropped).length) this.context.append('observer.dropped', { perStep: dropped, reason: 'Per-step observer cap reached; later changes in those steps were not recorded.' }, { source: 'surface' });
    }
    for (const blocked of this.browser.takeBlockedNavigations()) recordDiagnostic(this.context, 'browser.navigation-blocked', blocked);
    for (const warning of this.browser.takeNavigationGuardWarnings()) recordDiagnostic(this.context, 'browser.navigation-warning', warning);
  }

  verify(context: Parameters<Surface['verify']>[0]): Promise<VerificationRecord> {
    this.drainObserver();
    return (this.options.verifier ?? verifyTask)(this.task, this.browser, { ...context, ...this.observedTimeline() });
  }

  async visibleText(): Promise<string | undefined> {
    const text = await this.page.evaluate(() => document.body?.innerText ?? '');
    return typeof text === 'string' ? text : undefined;
  }

  async screenshot(path: string, options: { maskFields: boolean }): Promise<void> {
    const fields = options.maskFields && typeof this.page.locator === 'function' ? { mask: [this.page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')] } : {};
    await this.page.screenshot({ path, ...fields });
  }

  /** The whole start page, to show where on it runs got stuck. Very long pages are cut at START_PAGE_MAX_HEIGHT. */
  async startScreenshot(path: string): Promise<{ width: number; height: number; pageHeight: number; url: string } | undefined> {
    if (typeof this.page.evaluate !== 'function' || typeof this.page.url !== 'function') return undefined;
    const size = await this.page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })).catch(() => undefined);
    if (!size) return undefined;
    const height = Math.min(size.height, START_PAGE_MAX_HEIGHT);
    await this.page.screenshot({ path, fullPage: true, clip: { x: 0, y: 0, width: size.width, height } });
    return { width: size.width, height, pageHeight: size.height, url: this.page.url() };
  }

  close(): Promise<void> { return this.browser.close(); }
}

function redactObserverEvent(event: ObserverEvent): Record<string, unknown> {
  const safe: Record<string, unknown> = { ...event };
  for (const key of ['name', 'text', 'value', 'url'] as const) if (safe[key] !== undefined && safe[key] !== null) safe[key] = REDACTED;
  return safe;
}
