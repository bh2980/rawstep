import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page } from "playwright";
import type { ResolvedNavigationPolicy } from "@rawstep/definition";
import { DEFAULT_VIEWPORT, SETTLE_MS } from "./constants";

chromium.use(StealthPlugin());

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

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  network: NetworkLog;
  navigation: {
    policy: ResolvedNavigationPolicy;
    allowedOrigin: string;
    startUrlPrefix: string;
    blocked: BlockedNavigationRecord[];
  };
  setupTimings?: {
    browserLaunchMs: number;
    pageLoadMs: number;
  };
  takeBlockedNavigations(): BlockedNavigationRecord[];
  close(): Promise<void>;
};

export type CreateBrowserSessionOptions = {
  headless?: boolean;
  navigation?: ResolvedNavigationPolicy;
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

  await page.goto(url, { waitUntil: "load" });
  await waitForNetworkIdleBestEffort(page);
  const pageLoadMs = Date.now() - pageLoadStartedAt;
  const navigationPolicy = options.navigation ?? DEFAULT_NAVIGATION_POLICY;
  const allowedOrigin = getAllowedOrigin(page.url());
  const startUrlPrefix = stripHash(url);
  const blockedNavigations: BlockedNavigationRecord[] = [];
  const shouldInstallNavigationGuard = isNetworkNavigationGuardUrl(page.url());

  const recordBlockedNavigation = (targetUrl: string, reason: string) => {
    blockedNavigations.push({
      url: targetUrl,
      fromUrl: page.url(),
      reason,
      timestamp: new Date().toISOString()
    });
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
      onBlockedNavigation: recordBlockedNavigation
    });
  }

  return {
    browser,
    context,
    page,
    network,
    navigation: {
      policy: navigationPolicy,
      allowedOrigin,
      startUrlPrefix,
      blocked: blockedNavigations
    },
    setupTimings: {
      browserLaunchMs,
      pageLoadMs
    },
    takeBlockedNavigations: () => blockedNavigations.splice(0, blockedNavigations.length),
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

async function waitForNetworkIdleBestEffort(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 1000 });
  } catch {
    // Best effort only. User-perceived stability matters more than strict idle.
  }
}

const DEFAULT_NAVIGATION_POLICY: ResolvedNavigationPolicy = {
  strategy: "same-origin"
};

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
    allowedOrigin: string;
    startUrlPrefix: string;
  }
): Promise<void> {
  const bindingName = "__rawstepReportBlockedNavigation";
  await page.exposeBinding(bindingName, async (_source, payload: unknown) => {
    const candidate = payload as { targetUrl?: unknown; source?: unknown } | undefined;
    const targetUrl = normalizeTargetUrl(candidate?.targetUrl, page.url());
    const source = typeof candidate?.source === "string" ? candidate.source : "navigation";
    if (source !== "popup") {
      const reason = getNavigationBlockReason(targetUrl, context);
      if (!reason) {
        return;
      }

      context.onBlockedNavigation(targetUrl, reason);
      return;
    }

    context.onBlockedNavigation(targetUrl, getPopupBlockReason(targetUrl));
  });

  await page.addInitScript(installDocumentNavigationGuardScript, {
    bindingName,
    policy: serializeNavigationPolicy(context.policy),
    allowedOrigin: context.allowedOrigin,
    startUrlPrefix: context.startUrlPrefix
  });
  try {
    await page.evaluate(installDocumentNavigationGuardScript, {
      bindingName,
      policy: serializeNavigationPolicy(context.policy),
      allowedOrigin: context.allowedOrigin,
      startUrlPrefix: context.startUrlPrefix
    });
  } catch {
    // Best effort only. The init script still covers future allowed navigations.
  }

}

function installDocumentNavigationGuardScript(config: {
  bindingName: string;
  policy:
    | { strategy: "same-origin" }
    | { strategy: "start-url-prefix" }
    | { strategy: "allow-url-list"; allowUrlList: string[] };
  allowedOrigin: string;
  startUrlPrefix: string;
}): void {
  const globalWindow = window as Window & {
    __rawstepNavigationGuardInstalled?: boolean;
    [key: string]: unknown;
  };
  if (globalWindow.__rawstepNavigationGuardInstalled) {
    return;
  }
  globalWindow.__rawstepNavigationGuardInstalled = true;

  const reportBlockedNavigation = (targetUrl: string, source: "navigation" | "popup") => {
    const binding = globalWindow[config.bindingName] as ((payload: {
      targetUrl: string;
      source: "navigation" | "popup";
    }) => unknown) | undefined;
    if (typeof binding === "function") {
      binding({ targetUrl, source });
    }
  };

  const normalizeTargetUrlInPage = (targetUrl: string) => {
    try {
      return new URL(targetUrl, window.location.href).toString();
    } catch {
      return targetUrl;
    }
  };

  const isAllowedNavigation = (targetUrl: string) => {
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

    return config.policy.allowUrlList.some((prefix) => normalizedTargetUrl.startsWith(prefix));
  };

  const maybeBlockNavigation = (
    targetUrl: string,
    source: "navigation" | "popup"
  ): boolean => {
    const normalizedTargetUrl = normalizeTargetUrlInPage(targetUrl);
    const shouldBlock = source === "popup" || !isAllowedNavigation(normalizedTargetUrl);
    if (shouldBlock) {
      reportBlockedNavigation(normalizedTargetUrl, source);
    }

    return shouldBlock;
  };

  window.open = ((url?: string | URL) => {
    maybeBlockNavigation(String(url ?? ""), "popup");
    return null;
  }) as typeof window.open;

  const originalAssign = window.location.assign.bind(window.location);
  window.location.assign = ((url: string | URL) => {
    if (maybeBlockNavigation(String(url), "navigation")) {
      return;
    }

    originalAssign(url);
  }) as typeof window.location.assign;

  const originalReplace = window.location.replace.bind(window.location);
  window.location.replace = ((url: string | URL) => {
    if (maybeBlockNavigation(String(url), "navigation")) {
      return;
    }

    originalReplace(url);
  }) as typeof window.location.replace;

  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
    const source = this.target === "_blank" ? "popup" : "navigation";
    if (maybeBlockNavigation(this.href, source)) {
      return;
    }

    originalAnchorClick.call(this);
  };

  const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  if (typeof originalRequestSubmit === "function") {
    HTMLFormElement.prototype.requestSubmit = function patchedRequestSubmit(
      submitter?: HTMLElement | null
    ) {
      const source = this.target === "_blank" ? "popup" : "navigation";
      const targetUrl = this.action || window.location.href;
      if (maybeBlockNavigation(targetUrl, source)) {
        return;
      }

      originalRequestSubmit.call(this, submitter);
    };
  }

  document.addEventListener("click", (event) => {
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

  document.addEventListener("submit", (event) => {
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

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest('a[target="_blank"]');
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const source = anchor.target === "_blank" ? "popup" : "navigation";
    if (!maybeBlockNavigation(anchor.href, source)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("submit", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) {
      return;
    }

    const source = target.target === "_blank" ? "popup" : "navigation";
    const targetUrl = target.action || window.location.href;
    if (!maybeBlockNavigation(targetUrl, source)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
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
