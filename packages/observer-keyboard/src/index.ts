import {
  DEFAULT_VIEWPORT,
  isScrollHint,
  type KeyboardObservation,
  type ScrollHint
} from "@a11y-task/core";
import type { Page } from "playwright";

export class KeyboardObserver {
  private previousScreenshotBase64?: string;

  constructor(private readonly page: Page) {}

  async observe(): Promise<KeyboardObservation> {
    const screenshot = await this.page.screenshot({ type: "png" });
    const currentBase64 = screenshot.toString("base64");
    const viewport = this.page.viewportSize();
    const observation: KeyboardObservation = {
      kind: "keyboard",
      screenshot: {
        pngBase64: currentBase64,
        viewport: {
          w: viewport?.width ?? DEFAULT_VIEWPORT.w,
          h: viewport?.height ?? DEFAULT_VIEWPORT.h
        }
      },
      browserChrome: {
        title: await this.page.title(),
        urlPath: getUrlPath(await this.page.url())
      },
      scrollHint: await getScrollHint(this.page)
    };

    if (this.previousScreenshotBase64) {
      observation.previousScreenshot = {
        pngBase64: this.previousScreenshotBase64
      };
    }

    this.previousScreenshotBase64 = currentBase64;
    return observation;
  }
}

async function getScrollHint(page: Page): Promise<ScrollHint> {
  try {
    const hint = await page.evaluate(() => {
      const scrollingElement = document.scrollingElement ?? document.documentElement;
      const maxScroll = Math.max(scrollingElement.scrollHeight - scrollingElement.clientHeight, 0);
      const currentScroll = scrollingElement.scrollTop;

      if (maxScroll <= 0 || currentScroll <= 1) {
        return "top";
      }

      if (currentScroll >= maxScroll - 1) {
        return "bottom";
      }

      return "middle";
    });

    if (typeof hint === "string" && isScrollHint(hint)) {
      return hint;
    }
  } catch {
    // Fall through to top when scroll state cannot be determined.
  }

  return "top";
}

function getUrlPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return rawUrl;
  }
}
