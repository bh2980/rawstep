import { closeBrowserSession } from "@rawstep/browser/browser";
import { createTestBrowserSession as createBrowserSession } from "./helpers/browser.js";
import {
  evaluateVerifyRule,
  formatVerificationFeedback,
  verifyTask
} from "@rawstep/browser/verify";
import { type Task as ResolvedTask, resolveTask } from "@rawstep/core/contracts";
const validateVerifySpec = (verify:unknown) => resolveTask({url:"https://example.test",goal:"Verify",verify}).verify;
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("retained verifier fixtures in real Chromium", () => {
  it('returns actual browser witnesses for per-rule verification results', async () => {
    const url = pathToFileURL(resolve('fixtures/simple-cta.html')).toString();
    const task = resolveTask({ url, goal: 'Activate the button', verify: { all: [
      { titleIncludes: 'Completed' }, { urlIncludes: 'simple-cta.html' }, { textVisible: 'Started' },
      { domEventSeen: { selector: 'button', event: 'click' } }, { textVisibleExact: 'Not on this page' }
    ] } });
    const session = await createBrowserSession(url, { verify: task.verify });
    try {
      await session.page.getByRole('button', { name: 'Get started' }).click();
      const result = await verifyTask(task, session);
      expect(result.passed).toBe(false);
      expect(result.rules?.map((rule) => rule.passed)).toEqual([true, true, true, true, false]);
      expect(result.rules?.[0]?.witnesses).toEqual([{ kind: 'title', title: await session.page.title() }]);
      expect(result.rules?.[1]?.witnesses).toEqual([{ kind: 'url', url: session.page.url() }]);
      // Playwright's partial text matcher also finds the original button. Preserve
      // the selected node's actual text so this broad match is visible to reviewers.
      expect(result.rules?.[2]?.witnesses).toEqual([{ kind: 'visible-text', text: 'Get started', textSource: 'text-content', matchIndex: 0, visible: true }]);
      expect(result.rules?.[3]?.witnesses).toEqual([{ kind: 'dom-event', ...session.domEvents[0] }]);
      expect(result.rules?.[4]?.witnesses).toEqual([]);
    } finally {
      await closeBrowserSession(session);
    }
  });

  it.each(['submit', 'button'])('records the actual displayed value of input[type=%s] text matches', async (type) => {
    const url = pathToFileURL(resolve('fixtures/simple-cta.html')).toString();
    const session = await createBrowserSession(url);
    try {
      await session.page.setContent(`<input type="${type}" value="Save order 42">`);
      expect(await session.page.locator('input').textContent()).toBe('');
      const result = await verifyTask(resolveTask({ url, goal: 'Inspect the displayed control label', verify: { all: [
        { textVisible: 'Save order' }, { textVisibleExact: 'Save order 42' }
      ] } }), session);
      expect(result.passed).toBe(true);
      expect(result.rules?.map((rule) => rule.witnesses)).toEqual([0, 1].map(() => [{
        kind: 'visible-text', text: 'Save order 42', textSource: 'input-value', matchIndex: 0, visible: true
      }]));
    } finally {
      await closeBrowserSession(session);
    }
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
              action: { kind: "intent", intent: "activate" },
              observation: {
                kind: "screenreader",
                speech: ["Add to cart button"], outputEventIds: ["output-1"], window: { id: "w1", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), reason: "quiet" }
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
              action: { kind: "intent", intent: "activate" },
              observation: {
                kind: "screenreader",
                speech: ["Like button"], outputEventIds: ["output-2"], window: { id: "w2", startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), reason: "quiet" }
              }
            }
          }
        )
      ).toBe('Verification failed: expected output collected in the latest activation window to include "Add to cart", no matching output was recorded in that window.');
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
        'Verification failed: no screenreader activation-window output including "Add to cart" was recorded.'
      );
    } finally {
      await closeBrowserSession(session);
    }
  });
});
