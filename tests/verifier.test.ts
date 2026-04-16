import { closeBrowserSession, createBrowserSession } from "@rawstep/runtime";
import {
  evaluateVerifyRule,
  formatVerificationFeedback,
  verifyTask
} from "@rawstep/runtime";
import { validateVerifySpec, type ResolvedTask } from "@rawstep/definition";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("verifier", () => {
  describe("validateVerifySpec", () => {
    it("parses every supported verify rule", () => {
      expect(validateVerifySpec({
        all: [
          { titleIncludes: "Completed" },
          { urlIncludes: "simple-cta.html" },
          { textVisible: "Started!" },
          { textVisibleExact: "Started!" },
          { activatedAnnouncementIncludes: "Add to cart" },
          { domEventSeen: { selector: "button", event: "click" } },
          { requestSeen: { urlIncludes: "/api/cart", method: "POST" } },
          { responseSeen: { urlIncludes: "/api/cart", method: "POST", status: 200 } }
        ]
      })).toEqual({
        all: [
          { titleIncludes: "Completed" },
          { urlIncludes: "simple-cta.html" },
          { textVisible: "Started!" },
          { textVisibleExact: "Started!" },
          { activatedAnnouncementIncludes: "Add to cart" },
          { domEventSeen: { selector: "button", event: "click" } },
          { requestSeen: { urlIncludes: "/api/cart", method: "POST" } },
          { responseSeen: { urlIncludes: "/api/cart", method: "POST", status: 200 } }
        ]
      });
    });

    it("rejects verify rules with multiple top-level keys", () => {
      expect(() => validateVerifySpec({
        all: [
          { titleIncludes: "Completed", textVisible: "Started!" }
        ]
      })).toThrow("exactly one rule type");
    });

    it("rejects unsupported verify rule keys with a specific message", () => {
      expect(() => validateVerifySpec({
        all: [
          { unknownRule: "x" }
        ]
      })).toThrow(
        "Unsupported verify rule: unknownRule. Expected one of titleIncludes, urlIncludes, textVisible, textVisibleExact, activatedAnnouncementIncludes, domEventSeen, requestSeen, responseSeen."
      );
    });

    it("rejects nested verify field type errors with a path-based message", () => {
      expect(() => validateVerifySpec({
        all: [
          { requestSeen: { urlIncludes: "/api/cart", method: 123 } }
        ]
      })).toThrow(
        "Task verify.all[0].requestSeen.method: Expected string, received number"
      );
    });

    it("rejects blank verify strings with a field-specific message", () => {
      expect(() => validateVerifySpec({
        all: [
          { responseSeen: { urlIncludes: "", status: 200 } }
        ]
      })).toThrow(
        "Task verify.all[0].responseSeen.urlIncludes: Must be a non-empty string."
      );
    });

    it("rejects nested verify number field type errors with a path-based message", () => {
      expect(() => validateVerifySpec({
        all: [
          { responseSeen: { urlIncludes: "/api/cart", status: "bad" } }
        ]
      })).toThrow(
        "Task verify.all[0].responseSeen.status: Expected number, received string"
      );
    });

    it("rejects unrecognized nested verify keys with a path-based message", () => {
      expect(() => validateVerifySpec({
        all: [
          { requestSeen: { urlIncludes: "/api/cart", foo: "bar" } }
        ]
      })).toThrow(
        'Task verify.all[0].requestSeen: Unrecognized key "foo".'
      );
    });
  });

  it("checks title, url, and visible text rules", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/simple-cta.html")).toString());

    try {
      await session.page.getByRole("button", { name: "Get started" }).click();

      expect(await evaluateVerifyRule({ titleIncludes: "Completed" }, session)).toBeUndefined();
      expect(await evaluateVerifyRule({ urlIncludes: "simple-cta.html" }, session)).toBeUndefined();
      expect(await evaluateVerifyRule({ textVisible: "Started!" }, session)).toBeUndefined();
      expect(await evaluateVerifyRule({ textVisibleExact: "Started!" }, session)).toBeUndefined();
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("checks domEventSeen against recorded DOM events", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/simple-cta.html")).toString(), {
      verify: {
        all: [{ domEventSeen: { selector: "button", event: "click" } }]
      }
    });

    try {
      await session.page.getByRole("button", { name: "Get started" }).click();

      expect(
        await evaluateVerifyRule(
          { domEventSeen: { selector: "button", event: "click" } },
          session
        )
      ).toBeUndefined();
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("verifies the completed search fixture state", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/search.html")).toString());

    try {
      await session.page.locator("#query").fill("passport");
      await session.page.getByRole("button", { name: "Search" }).click();
      await session.page.getByRole("button", { name: "Open Passport2" }).click();

      expect(await evaluateVerifyRule({ titleIncludes: "Completed - Search" }, session)).toBeUndefined();
      expect(await evaluateVerifyRule({ textVisibleExact: "Selected Passport2" }, session)).toBeUndefined();
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("verifies the completed bad focus fixture state", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/bad-focus.html")).toString());

    try {
      await session.page.getByRole("button", { name: "Buy now" }).click();

      expect(await evaluateVerifyRule({ titleIncludes: "Completed - Bad Focus Fixture" }, session)).toBeUndefined();
      expect(await evaluateVerifyRule({ textVisibleExact: "Purchased!" }, session)).toBeUndefined();
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("checks request and response rules against the network log", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/simple-cta.html")).toString());

    try {
      session.network.requests.push({
        url: "https://example.test/api/cart",
        method: "POST",
        timestamp: new Date().toISOString()
      });
      session.network.responses.push({
        url: "https://example.test/api/cart",
        method: "POST",
        status: 200,
        ok: true,
        timestamp: new Date().toISOString()
      });

      expect(
        await evaluateVerifyRule(
          { requestSeen: { urlIncludes: "/api/cart", method: "POST" } },
          session
        )
      ).toBeUndefined();

      expect(
        await evaluateVerifyRule(
          { responseSeen: { urlIncludes: "/api/cart", method: "POST", status: 200 } },
          session
        )
      ).toBeUndefined();
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("checks activatedAnnouncementIncludes against the latest screenreader activation context", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/simple-cta.html")).toString());

    try {
      expect(
        await evaluateVerifyRule(
          { activatedAnnouncementIncludes: "Add to cart" },
          session,
          {
            latestActivation: {
              step: 3,
              action: {
                srAction: {
                  semantic: "act"
                }
              },
              observation: {
                kind: "screenreader",
                announcement: "Add to cart button",
                announcementCapture: "log"
              }
            }
          }
        )
      ).toBeUndefined();

      expect(
        await evaluateVerifyRule(
          { activatedAnnouncementIncludes: "Add to cart" },
          session,
          {
            latestActivation: {
              step: 4,
              action: {
                srAction: {
                  semantic: "act"
                }
              },
              observation: {
                kind: "screenreader",
                announcement: "Like button",
                announcementCapture: "log"
              }
            }
          }
        )
      ).toBe('Verification failed: expected latest activation announcement to include "Add to cart", observed "Like button".');
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("blocks empty email submission and shows an inline validation message", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/email-login.html")).toString());

    try {
      await session.page.getByRole("button", { name: "Send magic link" }).click();

      expect(await session.page.title()).toBe("Hello");
      expect(await session.page.locator("#status").isHidden()).toBe(true);
      expect(await session.page.locator("#email-error").textContent()).toContain(
        "Enter your email address before requesting a magic link."
      );
      expect(await session.page.locator("#email").getAttribute("aria-invalid")).toBe("true");
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("blocks malformed email submission and keeps the success state hidden", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/email-login.html")).toString());

    try {
      await session.page.locator("#email").fill("not-an-email");
      await session.page.getByRole("button", { name: "Send magic link" }).click();

      expect(await session.page.title()).toBe("Hello");
      expect(await session.page.locator("#status").isHidden()).toBe(true);
      expect(await session.page.locator("#email-error").textContent()).toContain(
        "Enter a valid email address like name@example.com."
      );
      expect(await session.page.locator("#email").getAttribute("aria-invalid")).toBe("true");
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("blocks empty credential submission and shows field-level feedback", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/credential-login.html")).toString());

    try {
      await session.page.getByRole("button", { name: "Sign in" }).click();

      expect(await session.page.title()).toBe("Credential Login Fixture");
      expect(await session.page.locator("#status").isHidden()).toBe(true);
      expect(await session.page.locator("#credential-email-error").textContent()).toContain(
        "Enter your email address before signing in."
      );
      expect(await session.page.locator("#credential-password-error").textContent()).toContain(
        "Enter your password before signing in."
      );
      expect(await session.page.locator("#email").getAttribute("aria-invalid")).toBe("true");
      expect(await session.page.locator("#password").getAttribute("aria-invalid")).toBe("true");
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("blocks malformed credential email and keeps the success state hidden", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/credential-login.html")).toString());

    try {
      await session.page.locator("#email").fill("not-an-email");
      await session.page.locator("#password").fill("super-secret");
      await session.page.getByRole("button", { name: "Sign in" }).click();

      expect(await session.page.title()).toBe("Credential Login Fixture");
      expect(await session.page.locator("#status").isHidden()).toBe(true);
      expect(await session.page.locator("#credential-email-error").textContent()).toContain(
        "Enter a valid email address like name@example.com."
      );
      expect(await session.page.locator("#email").getAttribute("aria-invalid")).toBe("true");
      expect(await session.page.locator("#credential-password-error").isHidden()).toBe(true);
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("allows partial matches for textVisible but not for textVisibleExact", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/simple-cta.html")).toString());

    try {
      await session.page.getByRole("button", { name: "Get started" }).click();

      expect(
        await evaluateVerifyRule({ textVisible: "Started" }, session)
      ).toBeUndefined();
      expect(
        await evaluateVerifyRule({ textVisibleExact: "Started" }, session)
      ).toBe('Verification failed: expected exact visible text "Started" was not observed.');
    } finally {
      await closeBrowserSession(session);
    }
  });

  it("returns helpful failure messages", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/simple-cta.html")).toString());

    try {
      const result = await verifyTask(
        {
          id: "verify-failure",
          url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
          goal: "Need a visible success marker.",
          mode: "keyboard",
          maxSteps: 2,
          timeoutMs: 1000,
          verify: {
            all: [{ textVisible: "Started!" }]
          }
        } satisfies ResolvedTask,
        session
      );

      expect(result.passed).toBe(false);
      expect(result.failures[0]).toContain('expected visible text containing "Started!"');
      expect(formatVerificationFeedback(result)).toBe(result.failures[0]);

      const activationResult = await verifyTask(
        {
          id: "verify-activation-failure",
          url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
          goal: "Need the latest activation context.",
          mode: "screenreader",
          maxSteps: 2,
          timeoutMs: 1000,
          verify: {
            all: [{ activatedAnnouncementIncludes: "Add to cart" }]
          }
        } satisfies ResolvedTask,
        session
      );

      expect(activationResult.passed).toBe(false);
      expect(activationResult.failures[0]).toBe(
        'Verification failed: no screenreader activation announcement including "Add to cart" was recorded.'
      );
    } finally {
      await closeBrowserSession(session);
    }
  });
});
