import type { BrowserContext, Page } from "playwright";

/** An initial request plus at most this many HTTP redirect hops may be sent. */
export const MAX_NAVIGATION_REDIRECTS = 10;

type PausedDocumentRequest = {
  requestId: string;
  request: { url: string; method?: string };
  frameId: string;
  resourceType: string;
  networkId?: string;
  redirectedRequestId?: string;
  responseStatusCode?: number;
  responseErrorReason?: string;
  responseHeaders?: { name: string; value: string }[];
};

type ApprovedHop = { url: string; redirects: number; networkId?: string };

/**
 * Playwright's route handler sees only the first request of a redirect chain.
 * A separate CDP Fetch client sees every hop before transmission, including
 * hops that Playwright automatically continues in its own CDP session.
 *
 * Never fetch/fulfill a navigation here: Chromium must perform the actual
 * redirects so the URL, history, request method/body and cookies stay native.
 * Context routing must also remain installed to reject a popup's first request;
 * this CDP session belongs only to the primary page.
 */
export async function installNavigationRequestBoundary(
  context: BrowserContext,
  page: Page,
  config: {
    blockReason(url: string, method?: string): string | undefined;
    onBlocked(url: string, reason: string, fromUrl?: string): void;
    onFailure(error: unknown): void;
  }
): Promise<() => void> {
  const session = await context.newCDPSession(page);
  const { frameTree } = await session.send("Page.getFrameTree");
  let mainFrameId = frameTree.frame.id;
  let closing = false;
  const approved = new Map<string, ApprovedHop>();
  const byNetworkId = new Map<string, string>();

  const forget = (networkId: string) => {
    const fetchId = byNetworkId.get(networkId);
    if (fetchId) approved.delete(fetchId);
    byNetworkId.delete(networkId);
  };

  const failClosed = async (error: unknown) => {
    if (closing) return;
    closing = true;
    config.onFailure(error);
    // Loss of the native boundary must not leave an unguarded usable browser.
    await context.close().catch(async () => {
      await context.browser()?.close().catch(() => undefined);
    });
  };

  const handle = async (event: PausedDocumentRequest) => {
    if (closing) return; // Context shutdown cancels any still-paused requests.
    if (!event.frameId) {
      config.onBlocked(event.request.url, "Navigation has no verifiable frame; blocked before sending.");
      await session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" });
      return;
    }
    if (event.resourceType !== "Document" || event.frameId !== mainFrameId) {
      await session.send("Fetch.continueRequest", { requestId: event.requestId });
      return;
    }

    if (event.responseStatusCode !== undefined || event.responseErrorReason !== undefined) {
      // Some Location schemes are handed to an external protocol handler and
      // never produce another Fetch request. Validate Location before Chromium
      // acts on it as well as independently validating each outgoing hop.
      const location = event.responseHeaders?.find((header) => header.name.toLowerCase() === "location")?.value;
      if ([301, 302, 303, 307, 308].includes(event.responseStatusCode ?? 0) && location !== undefined) {
        let target = location;
        let reason: string | undefined;
        try {
          target = new URL(location, event.request.url).href;
          reason = config.blockReason(target);
        } catch {
          reason = `Blocked invalid HTTP redirect target ${location}.`;
        }
        if (reason) {
          config.onBlocked(target, reason, event.request.url);
          if (event.networkId) forget(event.networkId);
          await session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" });
          return;
        }
      }
      await session.send("Fetch.continueRequest", { requestId: event.requestId });
      return;
    }

    const previous = event.redirectedRequestId ? approved.get(event.redirectedRequestId) : undefined;
    const redirects = previous ? previous.redirects + 1 : 0;
    const reason = config.blockReason(event.request.url,event.request.method)
      ?? (event.redirectedRequestId && !previous
        ? "Blocked HTTP redirect without a previously approved navigation hop."
        : redirects > MAX_NAVIGATION_REDIRECTS
          ? `Blocked HTTP redirect after the ${MAX_NAVIGATION_REDIRECTS}-hop navigation limit.`
          : undefined);

    if (event.redirectedRequestId) approved.delete(event.redirectedRequestId);
    if (reason) {
      config.onBlocked(event.request.url, reason, previous?.url ?? page.url());
      if (event.networkId) forget(event.networkId);
      // ERR_ABORTED cancels navigation without replacing the current document
      // with Chromium's network-error page, so fallback task controls survive.
      await session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Aborted" });
      return;
    }

    approved.set(event.requestId, { url: event.request.url, redirects, networkId: event.networkId });
    if (event.networkId) byNetworkId.set(event.networkId, event.requestId);
    await session.send("Fetch.continueRequest", { requestId: event.requestId });
  };

  session.on("Fetch.requestPaused", (event) => { void handle(event).catch(failClosed); });
  session.on("Page.frameNavigated", ({ frame }) => {
    if (!frame.parentId) mainFrameId = frame.id;
  });
  session.on("Network.loadingFinished", ({ requestId }) => { forget(requestId); });
  session.on("Network.loadingFailed", ({ requestId }) => { forget(requestId); });
  session.on("close", () => { void failClosed(new Error("Navigation guard CDP session closed unexpectedly.")); });

  // Install before the initial goto. Failure propagates to BrowserSetupError;
  // there is deliberately no fallback to the redirect-blind route handler.
  try {
    await session.send("Page.enable");
    await session.send("Network.enable");
    await session.send("Fetch.enable", {
      patterns: [
        { urlPattern: "*", resourceType: "Document", requestStage: "Request" },
        { urlPattern: "*", resourceType: "Document", requestStage: "Response" }
      ]
    });
  } catch (error) {
    closing = true;
    throw error;
  }

  // Mark normal shutdown without disabling interception ahead of context.close.
  return () => { closing = true; approved.clear(); byNetworkId.clear(); };
}
