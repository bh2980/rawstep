import { createBrowserSession, closeBrowserSession } from "@rawstep/browser";
import { KeyboardObserver } from "@rawstep/observer-keyboard";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("KeyboardObserver", () => {
  it("captures a screenshot and remembers the previous one", async () => {
    const fixtureUrl = pathToFileURL(resolve("fixtures/simple-cta.html")).toString();
    const session = await createBrowserSession(fixtureUrl);

    try {
      const observer = new KeyboardObserver(session.page);
      const first = await observer.observe();
      const second = await observer.observe();

      expect(first.kind).toBe("keyboard");
      expect(first.screenshot.pngBase64.length).toBeGreaterThan(0);
      expect(typeof first.focusHint).toBe("string");
      expect(second.previousScreenshot?.pngBase64).toBe(first.screenshot.pngBase64);
      expect(["top", "middle", "bottom"]).toContain(second.scrollHint);
    } finally {
      await closeBrowserSession(session);
    }
  });
});
