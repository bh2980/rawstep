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
          { requestSeen: { urlIncludes: "/api/cart", method: "POST" } },
          { responseSeen: { urlIncludes: "/api/cart", method: "POST", status: 200 } }
        ]
      })).toEqual({
        all: [
          { titleIncludes: "Completed" },
          { urlIncludes: "simple-cta.html" },
          { textVisible: "Started!" },
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
        "Unsupported verify rule: unknownRule. Expected one of titleIncludes, urlIncludes, textVisible, requestSeen, responseSeen."
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

  it("blocks empty email submission and shows an inline validation message", async () => {
    const session = await createBrowserSession(pathToFileURL(resolve("fixtures/email-login.html")).toString());

    try {
      await session.page.getByRole("button", { name: "Send magic link" }).click();

      expect(await session.page.title()).toBe("Email Login Fixture");
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

      expect(await session.page.title()).toBe("Email Login Fixture");
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
      expect(result.failures[0]).toContain('expected visible text "Started!"');
      expect(formatVerificationFeedback(result)).toBe(result.failures[0]);
    } finally {
      await closeBrowserSession(session);
    }
  });
});
