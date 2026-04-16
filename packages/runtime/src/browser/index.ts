import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { ResolvedNavigationPolicy, VerifySpec } from "@rawstep/definition";
import { DEFAULT_VIEWPORT, SETTLE_MS } from "./constants";

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
  browser: Browser;
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
  setupTimings?: {
    browserLaunchMs: number;
    pageLoadMs: number;
  };
  takeBlockedNavigations(): BlockedNavigationRecord[];
  takeNavigationGuardWarnings(): NavigationGuardWarningRecord[];
  close(): Promise<void>;
};

export type CreateBrowserSessionOptions = {
  headless?: boolean;
  navigation?: ResolvedNavigationPolicy;
  verify?: VerifySpec;
};

export async function createBrowserSession(
  url: string,
  options: CreateBrowserSessionOptions = {}
): Promise<BrowserSession> {
  const browserLaunchStartedAt = Date.now();
  const browser = await chromium.launch({ headless: options.headless ?? true });
  const browserLaunchMs = Date.now() - browserLaunchStartedAt;
  const pageLoadStartedAt = Date.now();
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: {
      width: DEFAULT_VIEWPORT.w,
      height: DEFAULT_VIEWPORT.h
    }
  });
  const page = await context.newPage();
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

  await installDomEventRecorder(page, {
    verify: options.verify,
    onDomEvent: (event) => {
      domEvents.push(event);
    }
  });

  await page.goto(url, { waitUntil: "load" });
  await waitForNetworkIdleBestEffort(page);
  const pageLoadMs = Date.now() - pageLoadStartedAt;
  const navigationPolicy = options.navigation ?? DEFAULT_NAVIGATION_POLICY;
  const allowedOrigin = getAllowedOrigin(page.url());
  const startUrlPrefix = stripHash(url);
  const blockedNavigations: BlockedNavigationRecord[] = [];
  const navigationGuardWarnings: NavigationGuardWarningRecord[] = [];
  const shouldInstallNavigationGuard = isNetworkNavigationGuardUrl(page.url());

  const recordBlockedNavigation = (targetUrl: string, reason: string) => {
    blockedNavigations.push({
      url: targetUrl,
      fromUrl: page.url(),
      reason,
      timestamp: new Date().toISOString()
    });
  };

  const recordNavigationGuardWarning = (warning: NavigationGuardWarningRecord) => {
    navigationGuardWarnings.push(warning);
  };

  if (shouldInstallNavigationGuard) {
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) {
        await route.continue();
        return;
      }

      const reason = getNavigationBlockReason(request.url(), {
        allowedOrigin,
        startUrlPrefix,
        policy: navigationPolicy
      });
      if (!reason) {
        await route.continue();
        return;
      }

      recordBlockedNavigation(request.url(), reason);
      await route.abort("blockedbyclient");
    });

    await installDocumentNavigationGuard(page, {
      allowedOrigin,
      startUrlPrefix,
      policy: navigationPolicy,
      onBlockedNavigation: recordBlockedNavigation,
      onInstallWarning: recordNavigationGuardWarning
    });
  }

  return {
    browser,
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
      pageLoadMs
    },
    takeBlockedNavigations: () => blockedNavigations.splice(0, blockedNavigations.length),
    takeNavigationGuardWarnings: () => navigationGuardWarnings.splice(0, navigationGuardWarnings.length),
    close: async () => {
      await context.close();
      await browser.close();
    }
  };
}

export async function closeBrowserSession(session: BrowserSession): Promise<void> {
  await session.close();
}

export async function settlePage(page: Page): Promise<void> {
  await waitForNetworkIdleBestEffort(page);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

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
    return new URL(rawUrl).origin;
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
  }
): string | undefined {
  if (context.policy.strategy === "same-origin") {
    return isSameOriginNavigation(targetUrl, context.allowedOrigin)
      ? undefined
      : `Blocked navigation to ${targetUrl}. Strategy "same-origin" only allows top-level navigation within origin ${context.allowedOrigin}. Stay on the current page and try a different path.`;
  }

  if (context.policy.strategy === "start-url-prefix") {
    return targetUrl.startsWith(context.startUrlPrefix)
      ? undefined
      : `Blocked navigation to ${targetUrl}. Strategy "start-url-prefix" only allows top-level navigation under ${context.startUrlPrefix}. Stay on the current page and try a different path.`;
  }

  return context.policy.allowUrlList.some((prefix) => targetUrl.startsWith(prefix))
    ? undefined
    : `Blocked navigation to ${targetUrl}. Strategy "allow-url-list" only allows top-level navigation matching: ${context.policy.allowUrlList.join(", ")}. Stay on the current page and try a different path.`;
}

function isSameOriginNavigation(targetUrl: string, allowedOrigin: string): boolean {
  try {
    return new URL(targetUrl).origin === allowedOrigin;
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

  const isAllowedNavigation = function(targetUrl) {
    const normalizedTargetUrl = normalizeTargetUrlInPage(targetUrl);
    if (config.policy.strategy === "same-origin") {
      try {
        return new URL(normalizedTargetUrl).origin === config.allowedOrigin;
      } catch {
        return false;
      }
    }

    if (config.policy.strategy === "start-url-prefix") {
      return normalizedTargetUrl.startsWith(config.startUrlPrefix);
    }

    return config.policy.allowUrlList.some(function(prefix) {
      return normalizedTargetUrl.startsWith(prefix);
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
    }
  );

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

  const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  if (typeof originalRequestSubmit === "function") {
    installHook(
      "HTMLFormElement.prototype.requestSubmit",
      function() {
        HTMLFormElement.prototype.requestSubmit = function(submitter) {
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
        if (maybeBlockNavigation(targetUrl, source)) {
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
        if (maybeBlockNavigation(targetUrl, source)) {
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
      source: "navigation" | "popup";
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

function serializeNavigationPolicy(policy: ResolvedNavigationPolicy): {
  strategy: "same-origin";
} | {
  strategy: "start-url-prefix";
} | {
  strategy: "allow-url-list";
  allowUrlList: string[];
} {
  if (policy.strategy === "allow-url-list") {
    return {
      strategy: policy.strategy,
      allowUrlList: [...policy.allowUrlList]
    };
  }

  return {
    strategy: policy.strategy
  };
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

function isNetworkNavigationGuardUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
