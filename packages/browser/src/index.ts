import { DEFAULT_VIEWPORT, SETTLE_MS } from "@a11y-task/core";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
};

export async function createBrowserSession(url: string): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: {
      width: DEFAULT_VIEWPORT.w,
      height: DEFAULT_VIEWPORT.h
    }
  });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: "load" });
  await waitForNetworkIdleBestEffort(page);

  return {
    browser,
    context,
    page,
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
