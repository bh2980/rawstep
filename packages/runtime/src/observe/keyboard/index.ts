import {
  type KeyboardObservation,
  type ScrollHint
} from "@rawstep/definition";
import type { Page } from "playwright";
import { DEFAULT_VIEWPORT } from "../../browser/constants";
import { isScrollHint } from "./constants";

export class KeyboardObserver {
  private previousScreenshotBase64?: string;

  constructor(private readonly page: Page) {}

  async observe(): Promise<KeyboardObservation> {
    const focusHint = await getFocusHint(this.page);
    const scrollHint = await getScrollHint(this.page);
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
      focusHint,
      scrollHint
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

async function getFocusHint(page: Page): Promise<string> {
  try {
    const focused = page.locator(":focus").first();
    if (await focused.count() === 0) {
      return "none";
    }

    const hint = await focused.evaluate((active) => {
      if (!(active instanceof HTMLElement)) {
        return "focused";
      }

      if (active === document.body || active === document.documentElement) {
        return "none";
      }

      const text = (active.textContent || "").trim().replace(/\s+/g, " ");

      if (active instanceof HTMLInputElement) {
        return `input[type=${(active.type || "text").toLowerCase()}]${active.disabled ? " (disabled)" : ""}`;
      }

      if (active instanceof HTMLTextAreaElement) {
        return `textarea${active.disabled ? " (disabled)" : ""}`;
      }

      if (active instanceof HTMLButtonElement) {
        return `button${text ? ` "${text}"` : ""}${active.disabled ? " (disabled)" : ""}`;
      }

      if (active instanceof HTMLSelectElement) {
        return `select${active.disabled ? " (disabled)" : ""}`;
      }

      if (active instanceof HTMLAnchorElement) {
        return `link${text ? ` "${text}"` : ""}`;
      }

      const role = active.getAttribute("role");
      return role
        ? `${active.tagName.toLowerCase()}[role=${role}]${text ? ` "${text}"` : ""}`
        : `${active.tagName.toLowerCase()}${text ? ` "${text}"` : ""}`;
    });

    return typeof hint === "string" && hint.trim() ? hint.trim() : "none";
  } catch {
    return "none";
  }
}

function getUrlPath(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return rawUrl;
  }
}
