import {
  buildKeyboardActionPlan,
  createKeyboardActionRef
} from "@rawstep/action-catalog";
import type {
  AgentMemoryEntry,
  ScreenReaderAction,
  ScreenReaderCapabilities,
  ScreenReaderObservation,
  ScreenReaderReadback
} from "@rawstep/definition";
import { publishRunOutputs } from "@rawstep/reporter";
import {
  createBrowserSession,
  runTask,
  RunTaskFailedError,
  ScreenReaderInitializationError
} from "@rawstep/runtime";
import { captureScreenReaderDomFocus } from "../packages/runtime/src/run/helpers";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

function createFixtureAgent(fixture: "simple-cta" | "bad-focus") {
  return {
    async decide(ctx: { memory: Array<{ step: number }> }, obs: { kind: string; browserChrome?: { title: string } }) {
      if (obs.kind !== "keyboard" || !obs.browserChrome) {
        return { verdict: "stuck" as const, rationale: "Only keyboard observations are supported." };
      }

      const stepCount = ctx.memory.length;
      const title = obs.browserChrome.title;

      if (title.includes("Completed")) {
        return { verdict: "success" as const, rationale: "The completion state is visible." };
      }

      if (fixture === "simple-cta" && title.includes("Simple CTA Fixture")) {
        if (stepCount < 2) {
          return { action: { key: "Tab" as const }, rationale: "Move focus to the CTA." };
        }

        return { action: { key: "Enter" as const }, rationale: "Activate the CTA." };
      }

      if (fixture === "bad-focus" && title.includes("Bad Focus Fixture")) {
        if (stepCount < 4) {
          return { action: { key: "Tab" as const }, rationale: "Keep searching for focus." };
        }

        return { verdict: "stuck" as const, rationale: "No useful focus target appeared." };
      }

      return { verdict: "stuck" as const, rationale: "No known action." };
    }
  };
}

function createStuckAgent() {
  return {
    async decide() {
      return { verdict: "stuck" as const };
    }
  };
}

function createPlanningLoopAgent() {
  const planTask = vi.fn(async () => ({
    steps: ["CTA 영역 찾기", "CTA 활성화", "완료 확인"],
    currentFocus: "CTA 영역 찾기",
    successSignals: ["완료 상태가 읽힘"]
  }));
  const reflectProgress = vi.fn(async () => ({
    status: "flat" as const,
    assessment: "CTA를 찾았으니 이제 활성화를 시도한다.",
    strategyNote: "다음에는 활성화 행동으로 전환한다.",
    updatedFocus: "CTA 활성화"
  }));
  const decide = vi.fn(async (ctx: { currentFocus?: string; memory?: Array<{ step: number }> }, obs: { kind: string; browserChrome?: { title: string } }) => {
    if (obs.kind !== "keyboard" || !obs.browserChrome) {
      return { verdict: "stuck" as const, rationale: "Only keyboard observations are supported." };
    }

    if (obs.browserChrome.title.includes("Completed")) {
      return { verdict: "success" as const, rationale: "Completion state is visible." };
    }

    if (ctx.currentFocus === "CTA 활성화" && (ctx.memory?.length ?? 0) >= 2) {
      return { action: { key: "Enter" as const }, rationale: "Activate the CTA." };
    }

    return { action: { key: "Tab" as const }, rationale: "Move focus toward the CTA." };
  });

  return {
    decide,
    planTask,
    reflectProgress
  };
}

function createScreenreaderPlanningAgent(successMemoryThreshold = 3) {
  const planTask = vi.fn(async () => ({
    steps: ["문맥 파악", "핵심 항목 찾기", "핵심 동작 실행"],
    currentFocus: "핵심 항목 찾기",
    successSignals: ["목표 관련 announcement가 읽힘"]
  }));
  const reflectProgress = vi.fn(async () => ({
    status: "progressing" as const,
    assessment: "핵심 항목에 가까워지고 있다.",
    strategyNote: "현재 탐색을 유지한다."
  }));
  const decide = vi.fn(async (ctx: { plan?: unknown; currentFocus?: string; memory?: Array<{ step: number }> }, obs: { kind: string }) => {
    expect(obs.kind).toBe("screenreader");
    if (ctx.plan && (ctx.memory?.length ?? 0) >= successMemoryThreshold) {
      return {
        verdict: "success" as const,
        rationale: "Planning has started and enough exploration occurred."
      };
    }

    return {
      action: {
        srAction: {
          semantic: "next"
        }
      },
      rationale: "Keep exploring."
    };
  });

  return {
    decide,
    planTask,
    reflectProgress
  };
}

function createScreenreaderEventReflectionAgent() {
  const planTask = vi.fn(async () => ({
    steps: ["문맥 파악", "핵심 항목 찾기", "핵심 동작 실행"],
    currentFocus: "핵심 항목 찾기",
    successSignals: ["목표 관련 announcement가 읽힘"]
  }));
  const reflectProgress = vi.fn(async (input: {
    ctx: { memory: AgentMemoryEntry[] };
  }) => ({
    status: "flat" as const,
    assessment: "같은 발화가 반복되고 있다.",
    strategyNote: `반복 감지 ${(input.ctx.memory.at(-1)?.sameAnnouncementCount ?? 0)}회`,
    updatedFocus: "탐색 전략 전환"
  }));
  const decide = vi.fn(async (ctx: {
    currentFocus?: string;
    strategyNote?: string;
    memory?: AgentMemoryEntry[];
  }) => {
    if ((ctx.memory?.length ?? 0) >= 6) {
      return {
        verdict: "stuck" as const,
        rationale: "Enough repeated exploration."
      };
    }

    return {
      action: {
        srAction: {
          semantic: "next"
        }
      },
      rationale: ctx.strategyNote ?? ctx.currentFocus ?? "Keep exploring."
    };
  });

  return {
    decide,
    planTask,
    reflectProgress
  };
}

const MOCK_SCREEN_READER_CAPABILITIES: ScreenReaderCapabilities = {
  invoke: {
    next: true,
    previous: true,
    act: true,
    interact: true,
    stopInteracting: true,
    press: true,
    type: true,
    click: true,
    perform: true,
    supportsRawPerform: false
  },
  read: {
    itemText: true,
    itemTextLog: true,
    lastSpokenPhrase: true,
    spokenPhraseLog: true
  },
  maintenance: {
    clearItemTextLog: true,
    clearSpokenPhraseLog: true
  },
  performCatalog: [
    {
      id: "commands.moveToNextHeading",
      label: "moveToNextHeading",
      description: "Move to the next heading."
    }
  ],
};

function createMockScreenReaderRuntime(overrides: {
  observer: {
    observe: () => Promise<{
      kind: "screenreader";
      announcement: string;
      announcementCapture: "log" | "fallback" | "none" | "synthetic";
    }>;
  };
  recoverFromUnexpectedBrowserUi?: (args: {
    observation: ScreenReaderObservation;
    domFocus?: import("@rawstep/definition").ScreenReaderDomFocusSnapshot;
  }) => Promise<{
    observation: ScreenReaderObservation;
    recovered: boolean;
    feedbackNote: string;
    diagnostics: Array<{
      scope: "screenReaderInit" | "navigationGuard";
      level: "warn" | "error";
      code: string;
      message: string;
      error?: string;
      stack?: string;
    }>;
  }>;
  controller?: {
    execute: (action: ScreenReaderAction) => Promise<{ ok: boolean; costDelta: number }>;
  };
  setupTimings?: {
    screenReaderInitMs: number;
    firstAnnouncementWaitMs: number;
  };
  captureCursorScreenshot?: () => Promise<
    | { status: "captured"; sourcePath: string }
    | { status: "disabled" }
    | {
        status: "unsupported" | "failed";
        diagnostic: {
          scope: "cursorScreenshot";
          level: "warn" | "error";
          code: string;
          message: string;
          error?: string;
          stack?: string;
        };
      }
  >;
  close?: () => Promise<void>;
}) {
  return {
    observer: overrides.observer,
    controller: overrides.controller ?? {
      execute: async (_action: ScreenReaderAction) => ({ ok: true, costDelta: 1 })
    },
    capabilities: MOCK_SCREEN_READER_CAPABILITIES,
    setupTimings: overrides.setupTimings ?? {
      screenReaderInitMs: 12,
      firstAnnouncementWaitMs: 34
    },
    recoverFromUnexpectedBrowserUi: overrides.recoverFromUnexpectedBrowserUi
      ?? (async ({ observation }: { observation: ScreenReaderObservation }) => ({
        observation,
        recovered: false,
        feedbackNote: "",
        diagnostics: []
      })),
    captureCursorScreenshot: overrides.captureCursorScreenshot ?? (async () => ({ status: "disabled" as const })),
    close: overrides.close ?? (async () => undefined)
  };
}

function createKeySequenceAgent(keys: readonly string[], successTitle: string) {
  let index = 0;

  return {
    async decide(_ctx: unknown, obs: { kind: string; browserChrome?: { title: string } }) {
      if (obs.kind !== "keyboard" || !obs.browserChrome) {
        return { verdict: "stuck" as const, rationale: "Only keyboard observations are supported." };
      }

      if (obs.browserChrome.title.includes(successTitle)) {
        return { verdict: "success" as const, rationale: "The expected destination page is visible." };
      }

      const nextKey = keys[index];
      index += 1;
      if (!nextKey) {
        return { verdict: "stuck" as const, rationale: "The scripted key sequence is exhausted." };
      }

      return {
        action: { key: nextKey as "Tab" | "Shift+Tab" | "Enter" },
        rationale: `Press ${nextKey}.`
      };
    }
  };
}

async function createNavigationFixtureServers(): Promise<{
  baseUrl: string;
  externalUrl: string;
  close(): Promise<void>;
}> {
  let baseUrl = "";
  let externalUrl = "";

  const externalServer = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>External ${requestUrl.pathname}</title></head><body><h1>External ${requestUrl.pathname}</h1></body></html>`);
  });
  await listenServer(externalServer);
  externalUrl = getServerUrl(externalServer);

  const mainServer = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const html = renderNavigationFixturePage(requestUrl.pathname, baseUrl, externalUrl);
    if (!html) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "content-type": requestUrl.pathname.endsWith(".js")
        ? "application/javascript; charset=utf-8"
        : "text/html; charset=utf-8"
    });
    res.end(html);
  });
  await listenServer(mainServer);
  baseUrl = getServerUrl(mainServer);

  return {
    baseUrl,
    externalUrl,
    close: async () => {
      await closeServer(mainServer);
      await closeServer(externalServer);
    }
  };
}

function renderNavigationFixturePage(pathname: string, baseUrl: string, externalUrl: string): string | undefined {
  const pages: Record<string, string> = {
    "/same-origin-guard-start": `<!doctype html>
      <html><head><title>Same Origin Guard Start</title></head>
      <body>
        <a href="${externalUrl}/outside" id="external-link">External link</a>
        <a href="${baseUrl}/same-origin-target?from=start#done" id="same-origin-link">Same origin target</a>
      </body></html>`,
    "/same-origin-allowed-start": `<!doctype html>
      <html><head><title>Same Origin Allowed Start</title></head>
      <body>
        <a href="${baseUrl}/same-origin-target?from=start#done" id="same-origin-link">Same origin target</a>
      </body></html>`,
    "/same-origin-target": `<!doctype html>
      <html><head><title>Same Origin Target</title></head>
      <body><h1>Same Origin Target</h1></body></html>`,
    "/prefix/start": `<!doctype html>
      <html><head><title>Prefix Start</title></head>
      <body>
        <a href="${baseUrl}/prefix-outside" id="prefix-blocked-link">Prefix blocked</a>
        <a href="${baseUrl}/prefix/start/next" id="prefix-allowed-link">Prefix allowed</a>
      </body></html>`,
    "/prefix/start/next": `<!doctype html>
      <html><head><title>Prefix Allowed</title></head>
      <body><h1>Prefix Allowed</h1></body></html>`,
    "/prefix-outside": `<!doctype html>
      <html><head><title>Prefix Outside</title></head>
      <body><h1>Prefix Outside</h1></body></html>`,
    "/allow-list-start": `<!doctype html>
      <html><head><title>Allow List Start</title></head>
      <body>
        <a href="${baseUrl}/allow-unlisted" id="allow-unlisted-link">Allow unlisted</a>
        <a href="${baseUrl}/allow-listed/next" id="allow-listed-link">Allow listed</a>
      </body></html>`,
    "/allow-listed/next": `<!doctype html>
      <html><head><title>Allow Listed</title></head>
      <body><h1>Allow Listed</h1></body></html>`,
    "/allow-unlisted": `<!doctype html>
      <html><head><title>Allow Unlisted</title></head>
      <body><h1>Allow Unlisted</h1></body></html>`,
    "/assign-start": `<!doctype html>
      <html><head><title>Assign Start</title></head>
      <body>
        <button type="button" id="assign-blocked-button" onclick="window.location.assign('${externalUrl}/assign-outside')">Assign blocked</button>
        <a href="${baseUrl}/same-origin-target?from=assign#done" id="assign-fallback-link">Fallback same-origin link</a>
      </body></html>`,
    "/assign-allowed-start": `<!doctype html>
      <html><head><title>Assign Allowed Start</title></head>
      <body>
        <button type="button" id="assign-allowed-button" onclick="window.location.assign('${baseUrl}/same-origin-target?from=assign-allowed#done')">Assign allowed</button>
      </body></html>`,
    "/replace-start": `<!doctype html>
      <html><head><title>Replace Start</title></head>
      <body>
        <button type="button" id="replace-blocked-button" onclick="window.location.replace('${externalUrl}/replace-outside')">Replace blocked</button>
        <a href="${baseUrl}/same-origin-target?from=replace#done" id="replace-fallback-link">Fallback same-origin link</a>
      </body></html>`,
    "/form-start": `<!doctype html>
      <html><head><title>Form Start</title></head>
      <body>
        <form action="${externalUrl}/form-outside" method="get">
          <button type="submit" id="form-blocked-button">Submit blocked form</button>
        </form>
        <a href="${baseUrl}/same-origin-target?from=form#done" id="form-fallback-link">Fallback same-origin link</a>
      </body></html>`,
    "/form-popup-start": `<!doctype html>
      <html><head><title>Form Popup Start</title></head>
      <body>
        <form action="${externalUrl}/form-popup" method="get" target="_blank">
          <button type="submit" id="form-popup-button">Submit popup form</button>
        </form>
        <a href="${baseUrl}/same-origin-target?from=form-popup#done" id="form-popup-fallback-link">Fallback same-origin link</a>
      </body></html>`,
    "/relative-allow-list/start": `<!doctype html>
      <html><head><title>Relative Allow List Start</title></head>
      <body>
        <a href="./blocked" id="relative-allow-list-blocked-link">Relative blocked link</a>
        <a href="./allowed/next" id="relative-allow-list-allowed-link">Relative allowed link</a>
      </body></html>`,
    "/relative-allow-list/allowed/next": `<!doctype html>
      <html><head><title>Relative Allow Listed</title></head>
      <body><h1>Relative Allow Listed</h1></body></html>`,
    "/relative-allow-list/blocked": `<!doctype html>
      <html><head><title>Relative Allow Blocked</title></head>
      <body><h1>Relative Allow Blocked</h1></body></html>`,
    "/relative-form-allow-list/start": `<!doctype html>
      <html><head><title>Relative Form Allow List Start</title></head>
      <body>
        <form action="./blocked" method="get">
          <button type="submit" id="relative-form-blocked-button">Submit relative blocked form</button>
        </form>
        <a href="./allowed/next" id="relative-form-allowed-link">Relative allowed link</a>
      </body></html>`,
    "/relative-form-allow-list/allowed/next": `<!doctype html>
      <html><head><title>Relative Form Allow Listed</title></head>
      <body><h1>Relative Form Allow Listed</h1></body></html>`,
    "/relative-form-allow-list/blocked": `<!doctype html>
      <html><head><title>Relative Form Allow Blocked</title></head>
      <body><h1>Relative Form Allow Blocked</h1></body></html>`,
    "/popup-start": `<!doctype html>
      <html><head><title>Popup Start</title></head>
      <body>
        <a href="${externalUrl}/popup" target="_blank" rel="noopener" id="popup-link">Popup link</a>
        <a href="${baseUrl}/same-origin-target" id="popup-fallback-link">Fallback same-origin link</a>
      </body></html>`,
    "/guard-warning-start": `<!doctype html>
      <html><head><title>Guard Warning Start</title></head>
      <body>
        <script>
          const originalOpen = window.open;
          Object.defineProperty(window, "open", {
            configurable: true,
            get() {
              return originalOpen;
            },
            set() {
              throw new Error("window.open is locked by the page");
            }
          });
        </script>
        <a href="${externalUrl}/guard-warning-popup" target="_blank" rel="noopener" id="guard-warning-popup-link">Blocked popup link</a>
        <a href="${baseUrl}/guard-warning-allowed" id="guard-warning-allowed-link">Guard warning allowed</a>
      </body></html>`,
    "/guard-warning-allowed": `<!doctype html>
      <html><head><title>Guard Warning Allowed</title></head>
      <body><h1>Guard Warning Allowed</h1></body></html>`,
    "/sw-allow-list-start": `<!doctype html>
      <html>
        <head><title>SW Allow List Start</title></head>
        <body>
          <p id="sw-status">Preparing service worker fixture...</p>
          <div id="sw-links" hidden>
            <a href="${baseUrl}/sw-allow-list-blocked" id="sw-blocked-link">SW blocked link</a>
            <a href="${baseUrl}/sw-allow-list-allowed/next" id="sw-allowed-link">SW allowed link</a>
          </div>
          <script>
            async function initServiceWorkerFixture() {
              const status = document.getElementById("sw-status");
              const links = document.getElementById("sw-links");
              const revealLinks = (message) => {
                status.textContent = message;
                links.hidden = false;
              };
              const waitWithTimeout = async (promise, timeoutMs, label) => {
                const timeout = new Promise((_, reject) => {
                  setTimeout(() => reject(new Error(label)), timeoutMs);
                });
                return await Promise.race([promise, timeout]);
              };

              if (!("serviceWorker" in navigator)) {
                revealLinks("Service worker unsupported");
                return;
              }

              try {
                await waitWithTimeout(
                  navigator.serviceWorker.register("/sw-allow-list-sw.js", { scope: "/" }),
                  250,
                  "service worker registration timed out"
                );
                await waitWithTimeout(
                  navigator.serviceWorker.ready,
                  250,
                  "service worker ready timed out"
                );

                if (navigator.serviceWorker.controller) {
                  revealLinks("Service worker controlled");
                  return;
                }

                const controllerChanged = new Promise((resolve) => {
                  navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
                });
                const timeout = new Promise((resolve) => setTimeout(resolve, 200));
                await Promise.race([controllerChanged, timeout]);
                revealLinks(navigator.serviceWorker.controller
                  ? "Service worker controlled"
                  : "Service worker blocked");
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                revealLinks("Service worker blocked: " + message);
              }
            }

            void initServiceWorkerFixture();
          </script>
        </body>
      </html>`,
    "/sw-allow-list-sw.js": `
      self.addEventListener("install", (event) => {
        event.waitUntil(self.skipWaiting());
      });
      self.addEventListener("activate", (event) => {
        event.waitUntil(self.clients.claim());
      });
      self.addEventListener("fetch", (event) => {
        if (event.request.mode === "navigate") {
          event.respondWith(fetch(event.request));
        }
      });
    `,
    "/sw-allow-list-blocked": `<!doctype html>
      <html><head><title>SW Allow List Blocked</title></head>
      <body><h1>SW Allow List Blocked</h1></body></html>`,
    "/sw-allow-list-allowed/next": `<!doctype html>
      <html><head><title>SW Allow Listed</title></head>
      <body><h1>SW Allow Listed</h1></body></html>`
  };

  return pages[pathname];
}

async function listenServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        rejectPromise(error);
        return;
      }

      resolvePromise();
    });
  });
}

function getServerUrl(server: Server): string {
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("Server address is unavailable.");
  }

  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }

      resolvePromise();
    });
  });
}

describe("runTask", () => {
  it("passes default headless values into the browser factory based on mode and backend", async () => {
    const cases = [
      {
        id: "keyboard-default-headless",
        mode: "keyboard" as const,
        backendId: undefined,
        expectedHeadless: true
      },
      {
        id: "screenreader-virtual-default-headless",
        mode: "screenreader" as const,
        backendId: "guidepup-virtual" as const,
        expectedHeadless: true
      },
      {
        id: "screenreader-voiceover-default-headed",
        mode: "screenreader" as const,
        backendId: "guidepup-voiceover" as const,
        expectedHeadless: false
      }
    ];

    for (const testCase of cases) {
      const outDir = await mkdtemp(join(tmpdir(), `a11y-runner-${testCase.id}-`));
      const browserSessionFactory = vi.fn(async (_url: string, options) => {
        throw new Error(`headless:${String(options?.headless)}`);
      });

      await expect(runTask(
        {
          id: testCase.id,
          url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
          goal: "Check browser launch options.",
          mode: testCase.mode,
          maxSteps: 1,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Simple CTA Fixture" }]
          }
        },
        {
          outDir,
          screenReaderBackendId: testCase.backendId,
          browserSessionFactory,
          agent: createStuckAgent()
        }
      )).rejects.toThrow(`headless:${String(testCase.expectedHeadless)}`);
    }
  });

  it("passes the resolved headless setting into the browser factory", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-headless-option-"));
    const browserSessionFactory = vi.fn(async (_url: string, options) => {
      throw new Error(`headless:${String(options?.headless)}`);
    });

    await expect(runTask(
      {
        id: "headless-option",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Check browser launch options.",
        mode: "screenreader",
        maxSteps: 1,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        screenReaderBackendId: "guidepup-virtual",
        browserSessionFactory,
        agent: createStuckAgent()
      }
    )).rejects.toThrow("headless:true");

    expect(browserSessionFactory).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headless: true })
    );
  });

  it("rejects headless overrides for native screen readers before browser launch", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-native-screenreader-headless-"));
    const browserSessionFactory = vi.fn(async () => {
      throw new Error("browser should not launch");
    });

    await expect(runTask(
      {
        id: "native-sr-headless",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Check invalid headless override.",
        mode: "screenreader",
        maxSteps: 1,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        headless: true,
        screenReaderBackendId: "guidepup-voiceover",
        browserSessionFactory,
        agent: createStuckAgent()
      }
    )).rejects.toThrow('Screen reader backend "guidepup-voiceover" requires a headed browser');

    expect(browserSessionFactory).not.toHaveBeenCalled();
  });

  it("rejects keys that are outside the configured keyboard action plan", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-keyboard-plan-subset-"));

    const session = await runTask(
      {
        id: "keyboard-plan-subset",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Use only the allowed keyboard subset.",
        mode: "keyboard",
        maxSteps: 1,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        keyboardActionPlan: buildKeyboardActionPlan([
          createKeyboardActionRef("Tab")
        ]),
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        agent: {
          decide: async () => ({
            action: { key: "Backspace" },
            rationale: "This key is supported globally but not for this run."
          })
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("error");
    expect(session.steps[0].execution.error).toBe(
      'Key "Backspace" is not allowed by the configured allowedKeys.'
    );
  });

  it("completes the simple CTA fixture with a fake deterministic agent", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-success-"));
    const session = await runTask(
      {
        id: "simple-cta",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Get started 버튼을 찾아서 활성화하고, 결과 메시지가 보이는 상태로 만들어라.",
        mode: "keyboard",
        maxSteps: 20,
        timeoutMs: 60_000,
        verify: {
          all: [
            { textVisible: "Started!" },
            { titleIncludes: "Completed" }
          ]
        }
      },
      {
        outDir,
        agent: createFixtureAgent("simple-cta")
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.aggregate.result).toBe("success");
    expect(session.aggregate.actionCounts).toEqual({
      srInvokeCount: 0,
      srReadCount: 0,
      srMaintenanceCount: 0,
      rawKeyCount: 3,
      typeTextCount: 0
    });
    expect(session.aggregate.timings.setupMs).toBeGreaterThanOrEqual(0);
    expect(session.aggregate.timings.browserLaunchMs).toBeGreaterThanOrEqual(0);
    expect(session.aggregate.timings.pageLoadMs).toBeGreaterThanOrEqual(0);
    expect(session.steps[0]?.timings.observeMs).toBeGreaterThanOrEqual(0);
    expect(session.steps[0]?.timings.decideMs).toBeGreaterThanOrEqual(0);
    expect(session.steps[0]?.timings.executeMs).toBeGreaterThanOrEqual(0);
    expect(session.steps.at(-1)?.verification?.passed).toBe(true);
    expect(session.steps.at(-1)?.verdictAnalysis).toEqual({
      agentVerdict: "success",
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "agent"
    });
    expect(session.steps.at(-1)?.timings.verifyMs).toBeGreaterThanOrEqual(0);
  });

  it("records a stuck result for the bad focus fixture with a fake deterministic agent", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-stuck-"));
    const session = await runTask(
      {
        id: "bad-focus",
        url: pathToFileURL(resolve("fixtures/bad-focus.html")).toString(),
        goal: "Buy now 버튼을 찾아서 활성화하라.",
        mode: "keyboard",
        maxSteps: 8,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Bad Focus Fixture" }]
        }
      },
      {
        outDir,
        agent: createFixtureAgent("bad-focus")
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.aggregate.result).toBe("failure");
  });

  it("blocks cross-origin navigation under same-origin policy, records the failure, and continues", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-same-origin-block-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-same-origin-block",
          url: `${servers.baseUrl}/same-origin-guard-start`,
          goal: "Avoid external navigation and reach the same-origin destination.",
          mode: "keyboard",
          maxSteps: 6,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Same Origin Target" }]
          }
        },
        {
          outDir,
          navigation: { strategy: "same-origin" },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter", "Tab", "Enter"], "Same Origin Target")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain(`Blocked navigation to ${servers.externalUrl}/outside`);
      expect(blockedStep?.execution.error).toContain('Strategy "same-origin"');
      const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
      expect(diagnostics).toContain("NAVIGATION_BLOCKED");
      expect(diagnostics).toContain(`${servers.externalUrl}/outside`);
    } finally {
      await servers.close();
    }
  });

  it("allows same-origin path, query, and hash navigation under same-origin policy", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-same-origin-allow-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-same-origin-allow",
          url: `${servers.baseUrl}/same-origin-allowed-start`,
          goal: "Reach the same-origin destination.",
          mode: "keyboard",
          maxSteps: 4,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Same Origin Target" }]
          }
        },
        {
          outDir,
          navigation: { strategy: "same-origin" },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter"], "Same Origin Target")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      expect(session.steps[0]?.execution.ok).toBe(true);
      await expect(access(join(outDir, "diagnostics.jsonl"))).rejects.toThrow();
    } finally {
      await servers.close();
    }
  });

  it("blocks prefix escapes under start-url-prefix and continues to an allowed prefix target", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-prefix-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-start-url-prefix",
          url: `${servers.baseUrl}/prefix/start`,
          goal: "Stay under the start URL prefix and reach the allowed page.",
          mode: "keyboard",
          maxSteps: 6,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Prefix Allowed" }]
          }
        },
        {
          outDir,
          navigation: { strategy: "start-url-prefix" },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter", "Tab", "Enter"], "Prefix Allowed")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain(`${servers.baseUrl}/prefix-outside`);
      expect(blockedStep?.execution.error).toContain('Strategy "start-url-prefix"');
    } finally {
      await servers.close();
    }
  });

  it("blocks unlisted same-origin URLs under allow-url-list and allows listed targets", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-allow-list-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-allow-list",
          url: `${servers.baseUrl}/allow-list-start`,
          goal: "Use only allow-listed destinations.",
          mode: "keyboard",
          maxSteps: 6,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Allow Listed" }]
          }
        },
        {
          outDir,
          navigation: {
            strategy: "allow-url-list",
            allowUrlList: [`${servers.baseUrl}/allow-listed/`]
          },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter", "Tab", "Enter"], "Allow Listed")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain(`${servers.baseUrl}/allow-unlisted`);
      expect(blockedStep?.execution.error).toContain('Strategy "allow-url-list"');
      expect(blockedStep?.execution.error).toContain(`${servers.baseUrl}/allow-listed/`);
    } finally {
      await servers.close();
    }
  });

  it("blocks popup or new-tab attempts, records diagnostics, and keeps the run in the current tab", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-popup-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-popup-block",
          url: `${servers.baseUrl}/popup-start`,
          goal: "Avoid popup navigation and finish in the current tab.",
          mode: "keyboard",
          maxSteps: 6,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Same Origin Target" }]
          }
        },
        {
          outDir,
          navigation: { strategy: "same-origin" },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter", "Tab", "Enter"], "Same Origin Target")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain("Blocked popup/new-tab navigation");
      expect(blockedStep?.execution.error).toContain(`${servers.externalUrl}/popup`);
      const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
      expect(diagnostics).toContain("NAVIGATION_BLOCKED");
      expect(diagnostics).toContain("popup/new-tab");
    } finally {
      await servers.close();
    }
  });

  it("blocks window.location.assign navigations outside the allowed scope and records feedback", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-assign-block-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-assign-block",
          url: `${servers.baseUrl}/assign-start`,
          goal: "Detect blocked assign navigation.",
          mode: "keyboard",
          maxSteps: 3,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Never matches" }]
          }
        },
        {
          outDir,
          navigation: { strategy: "same-origin" },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter"], "Never matches")
        }
      );

      expect(session.aggregate.endedBy).toBe("stuck");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain(`Blocked navigation to ${servers.externalUrl}/assign-outside`);
      expect(blockedStep?.execution.error).toContain('Strategy "same-origin"');
      const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
      expect(diagnostics).toContain("NAVIGATION_BLOCKED");
      expect(diagnostics).toContain(`${servers.externalUrl}/assign-outside`);
    } finally {
      await servers.close();
    }
  });

  it("allows same-origin window.location.assign without recording blocked navigation diagnostics", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-assign-allow-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-assign-allow",
          url: `${servers.baseUrl}/assign-allowed-start`,
          goal: "Use allowed assign navigation to reach the target.",
          mode: "keyboard",
          maxSteps: 4,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Same Origin Target" }]
          }
        },
        {
          outDir,
          navigation: { strategy: "same-origin" },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter"], "Same Origin Target")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      expect(session.steps[0]?.execution.ok).toBe(true);
      await expect(access(join(outDir, "diagnostics.jsonl"))).rejects.toThrow();
    } finally {
      await servers.close();
    }
  });

  it("blocks window.location.replace navigations outside the allowed scope and records feedback", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-replace-block-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-replace-block",
          url: `${servers.baseUrl}/replace-start`,
          goal: "Detect blocked replace navigation.",
          mode: "keyboard",
          maxSteps: 3,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Never matches" }]
          }
        },
        {
          outDir,
          navigation: { strategy: "same-origin" },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter"], "Never matches")
        }
      );

      expect(session.aggregate.endedBy).toBe("stuck");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain(`Blocked navigation to ${servers.externalUrl}/replace-outside`);
      expect(blockedStep?.execution.error).toContain('Strategy "same-origin"');
      const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
      expect(diagnostics).toContain("NAVIGATION_BLOCKED");
      expect(diagnostics).toContain(`${servers.externalUrl}/replace-outside`);
    } finally {
      await servers.close();
    }
  });

  it("blocks form submissions outside the allowed scope and continues", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-form-block-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-form-block",
          url: `${servers.baseUrl}/form-start`,
          goal: "Avoid blocked form navigation and reach the fallback target.",
          mode: "keyboard",
          maxSteps: 6,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Same Origin Target" }]
          }
        },
        {
          outDir,
          navigation: { strategy: "same-origin" },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter", "Tab", "Enter"], "Same Origin Target")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain(`Blocked navigation to ${servers.externalUrl}/form-outside`);
      expect(blockedStep?.execution.error).toContain('Strategy "same-origin"');
      const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
      expect(diagnostics).toContain("NAVIGATION_BLOCKED");
      expect(diagnostics).toContain(`${servers.externalUrl}/form-outside`);
    } finally {
      await servers.close();
    }
  });

  it("blocks popup form submissions, records diagnostics, and keeps the run in the current tab", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-form-popup-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-form-popup-block",
          url: `${servers.baseUrl}/form-popup-start`,
          goal: "Avoid popup form navigation and finish in the current tab.",
          mode: "keyboard",
          maxSteps: 6,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Same Origin Target" }]
          }
        },
        {
          outDir,
          navigation: { strategy: "same-origin" },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter", "Tab", "Enter"], "Same Origin Target")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain("Blocked popup/new-tab navigation");
      expect(blockedStep?.execution.error).toContain(`${servers.externalUrl}/form-popup`);
      const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
      expect(diagnostics).toContain("NAVIGATION_BLOCKED");
      expect(diagnostics).toContain("popup/new-tab");
      expect(diagnostics).toContain(`${servers.externalUrl}/form-popup`);
    } finally {
      await servers.close();
    }
  });

  it("normalizes relative link targets before enforcing allow-url-list policies", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-relative-link-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-relative-link-allow-list",
          url: `${servers.baseUrl}/relative-allow-list/start`,
          goal: "Use only allow-listed relative destinations.",
          mode: "keyboard",
          maxSteps: 6,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Relative Allow Listed" }]
          }
        },
        {
          outDir,
          navigation: {
            strategy: "allow-url-list",
            allowUrlList: [`${servers.baseUrl}/relative-allow-list/allowed/`]
          },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter", "Tab", "Enter"], "Relative Allow Listed")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain(`${servers.baseUrl}/relative-allow-list/blocked`);
      expect(blockedStep?.execution.error).toContain(`${servers.baseUrl}/relative-allow-list/allowed/`);
      expect(blockedStep?.execution.error).toContain('Strategy "allow-url-list"');
    } finally {
      await servers.close();
    }
  });

  it("normalizes relative form actions before enforcing allow-url-list policies", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-relative-form-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-relative-form-allow-list",
          url: `${servers.baseUrl}/relative-form-allow-list/start`,
          goal: "Use only allow-listed relative form destinations.",
          mode: "keyboard",
          maxSteps: 6,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Relative Form Allow Listed" }]
          }
        },
        {
          outDir,
          navigation: {
            strategy: "allow-url-list",
            allowUrlList: [`${servers.baseUrl}/relative-form-allow-list/allowed/`]
          },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter", "Tab", "Enter"], "Relative Form Allow Listed")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain(`${servers.baseUrl}/relative-form-allow-list/blocked`);
      expect(blockedStep?.execution.error).toContain(`${servers.baseUrl}/relative-form-allow-list/allowed/`);
      expect(blockedStep?.execution.error).toContain('Strategy "allow-url-list"');
      const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
      expect(diagnostics).toContain("NAVIGATION_BLOCKED");
      expect(diagnostics).toContain(`${servers.baseUrl}/relative-form-allow-list/blocked`);
    } finally {
      await servers.close();
    }
  });

  it("blocks allow-list escapes even when the page tries to register a navigation-forwarding service worker", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-service-worker-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-service-worker-allow-list",
          url: `${servers.baseUrl}/sw-allow-list-start`,
          goal: "Keep blocked service-worker routes from escaping the allow list.",
          mode: "keyboard",
          maxSteps: 6,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "SW Allow Listed" }]
          }
        },
        {
          outDir,
          navigation: {
            strategy: "allow-url-list",
            allowUrlList: [`${servers.baseUrl}/sw-allow-list-allowed/`]
          },
          browserSessionFactory: async (url, options) => {
            const session = await createBrowserSession(url, { headless: true, ...options });
            await session.page.waitForSelector("#sw-links", { state: "visible" });
            return session;
          },
          agent: createKeySequenceAgent(["Tab", "Enter", "Tab", "Enter"], "SW Allow Listed")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain(`${servers.baseUrl}/sw-allow-list-blocked`);
      expect(blockedStep?.execution.error).toContain('Strategy "allow-url-list"');
      const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
      expect(diagnostics).toContain("NAVIGATION_BLOCKED");
      expect(diagnostics).toContain(`${servers.baseUrl}/sw-allow-list-blocked`);
    } finally {
      await servers.close();
    }
  });

  it("records a guard-install warning without losing popup blocking from later hooks", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-nav-guard-warning-"));
    const servers = await createNavigationFixtureServers();

    try {
      const session = await runTask(
        {
          id: "navigation-guard-warning",
          url: `${servers.baseUrl}/guard-warning-start`,
          goal: "Keep popup blocking active even if one navigation guard hook fails to install.",
          mode: "keyboard",
          maxSteps: 6,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Guard Warning Allowed" }]
          }
        },
        {
          outDir,
          navigation: { strategy: "same-origin" },
          browserSessionFactory: (url, options) => createBrowserSession(url, { headless: true, ...options }),
          agent: createKeySequenceAgent(["Tab", "Enter", "Tab", "Enter"], "Guard Warning Allowed")
        }
      );

      expect(session.aggregate.endedBy).toBe("success");
      const blockedStep = session.steps.find((step) => step.execution.ok === false);
      expect(blockedStep?.execution.error).toContain("Blocked popup/new-tab navigation");
      expect(blockedStep?.execution.error).toContain(`${servers.externalUrl}/guard-warning-popup`);
      const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
      expect(diagnostics).toContain("NAVIGATION_GUARD_INSTALL_WARNING");
      expect(diagnostics).toContain("window.open");
      expect(diagnostics).toContain("NAVIGATION_BLOCKED");
      expect(diagnostics).toContain(`${servers.externalUrl}/guard-warning-popup`);
    } finally {
      await servers.close();
    }
  });

  it("runs planning once and feeds reflection updates into later decisions", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-planning-loop-"));
    const agent = createPlanningLoopAgent();

    const session = await runTask(
      {
        id: "planning-loop",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Get started 버튼을 활성화하라.",
        mode: "keyboard",
        maxSteps: 10,
        timeoutMs: 60_000,
        verify: {
          all: [
            { textVisible: "Started!" },
            { titleIncludes: "Completed" }
          ]
        }
      },
      {
        outDir,
        planning: {
          enabled: true,
          reflectionCadence: 5,
          initialDelaySteps: 0,
          firstReflectionDelaySteps: 1
        },
        agent
      }
    );

    expect(agent.planTask).toHaveBeenCalledTimes(1);
    expect(agent.reflectProgress).toHaveBeenCalled();
    expect(agent.decide.mock.calls[0]?.[0].currentFocus).toBe("CTA 영역 찾기");
    expect(agent.decide.mock.calls[1]?.[0].currentFocus).toBe("CTA 활성화");
    expect(session.plan).toEqual({
      steps: ["CTA 영역 찾기", "CTA 활성화", "완료 확인"],
      currentFocus: "CTA 영역 찾기",
      successSignals: ["완료 상태가 읽힘"]
    });
    expect(session.reflections?.[0]?.reflection.updatedFocus).toBe("CTA 활성화");
    expect(session.aggregate.endedBy).toBe("success");
  });

  it("does not run reflection after a terminal verdict step", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-terminal-no-reflection-"));
    const planTask = vi.fn(async () => ({
      steps: ["상태 확인", "종료 판단"],
      currentFocus: "상태 확인",
      successSignals: ["종료 verdict가 기록됨"]
    }));
    const reflectProgress = vi.fn(async () => ({
      status: "flat" as const,
      assessment: "이미 끝난 step이라 reflection이 돌면 안 된다.",
      strategyNote: "이 값은 사용되면 안 된다."
    }));
    const decide = vi.fn(async () => ({
      verdict: "stuck" as const,
      rationale: "Terminate immediately."
    }));

    const session = await runTask(
      {
        id: "terminal-no-reflection",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "첫 step에서 바로 종료하라.",
        mode: "keyboard",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        planning: {
          enabled: true,
          reflectionCadence: 1,
          initialDelaySteps: 0,
          firstReflectionDelaySteps: 1
        },
        agent: {
          decide,
          planTask,
          reflectProgress
        }
      }
    );

    expect(planTask).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(reflectProgress).not.toHaveBeenCalled();
    expect(session.reflections ?? []).toHaveLength(0);
    expect(session.aggregate.endedBy).toBe("stuck");
  });

  it("uses keyboard planning defaults to start planning before the first decision", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-keyboard-planning-default-"));
    const agent = createPlanningLoopAgent();

    await runTask(
      {
        id: "keyboard-planning-default",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Get started 버튼을 활성화하라.",
        mode: "keyboard",
        maxSteps: 10,
        timeoutMs: 60_000,
        verify: {
          all: [
            { textVisible: "Started!" },
            { titleIncludes: "Completed" }
          ]
        }
      },
      {
        outDir,
        agent
      }
    );

    expect(agent.planTask).toHaveBeenCalledTimes(1);
    expect(agent.decide.mock.calls[0]?.[0].currentFocus).toBe("CTA 영역 찾기");
  });

  it("preserves natural keyboard focus without mutating page-root tabindex on startup", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-keyboard-natural-focus-"));
    let page: Awaited<ReturnType<typeof createBrowserSession>>["page"] | undefined;

    const session = await runTask(
      {
        id: "keyboard-natural-focus",
        url: pathToFileURL(resolve("fixtures/email-login.html")).toString(),
        goal: "기존 포커스를 덮어쓰지 말고 그대로 관찰하라.",
        mode: "keyboard",
        maxSteps: 1,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Email Login Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: async (url, options) => {
          const session = await createBrowserSession(url, { headless: true, ...options });
          page = session.page;
          await session.page.evaluate(() => {
            (document.getElementById("email") as HTMLInputElement | null)?.focus();
          });
          return session;
        },
        agent: {
          decide: async (_ctx, observation) => {
            if (observation.kind !== "keyboard") {
              throw new Error("Expected keyboard observation.");
            }
            if (!page) {
              throw new Error("Browser page was not initialized.");
            }

            expect(observation.focusHint).toBe("input[type=email]");
            await expect(page.evaluate(() => ({
              activeId: document.activeElement instanceof HTMLElement ? document.activeElement.id : "",
              bodyHasTabindex: document.body.hasAttribute("tabindex"),
              htmlHasTabindex: document.documentElement.hasAttribute("tabindex")
            }))).resolves.toEqual({
              activeId: "email",
              bodyHasTabindex: false,
              htmlHasTabindex: false
            });

            return {
              verdict: "stuck" as const,
              rationale: "Startup assertions completed."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
  });

  it("ends by maxSteps when the agent never returns a verdict", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-maxsteps-"));
    const session = await runTask(
      {
        id: "max-steps",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Never finish.",
        mode: "keyboard",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agent: {
          decide: async () => ({
            action: { key: "Tab" as const },
            rationale: "Keep moving."
          })
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("maxSteps");
    expect(session.aggregate.totalSteps).toBe(2);
  });

  it("ends by timeout when the deadline is already exhausted", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-timeout-"));
    const session = await runTask(
      {
        id: "timeout",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Time out immediately.",
        mode: "keyboard",
        maxSteps: 20,
        timeoutMs: 0,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agent: createFixtureAgent("simple-cta")
      }
    );

    expect(session.aggregate.endedBy).toBe("timeout");
    expect(session.aggregate.totalSteps).toBe(0);
  });

  it("uses agent-provided memory excerpts and can attach an experience summary", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-memory-summary-"));
    const seenMemoryLengths: number[] = [];
    const recordedMemoryValues: string[] = [];
    const seenSummaryStepCounts: number[] = [];
    const recordedEntries: AgentMemoryEntry[] = [];

    const agent = {
      recordStepOutcome: (entry: AgentMemoryEntry) => {
        recordedMemoryValues.push(entry.action);
        recordedEntries.push(entry);
      },
      getMemoryExcerpt: () => {
        return recordedEntries.slice(-1);
      },
      summarizeExperience: async (input: { steps: Array<unknown> }) => {
        seenSummaryStepCounts.push(input.steps.length);
        return {
          overall: `Recorded ${recordedMemoryValues.length} steps.`,
          blockers: ["Navigation took more than one step."],
          surprise: "The task needed one extra pass before stopping.",
          oneLineFeel: "Short run with one repeated navigation step."
        };
      },
      decide: async (ctx: { memory: unknown[] }) => {
        seenMemoryLengths.push(ctx.memory.length);

        if (seenMemoryLengths.length < 3) {
          return {
            action: { key: "Tab" as const }
          };
        }

        return {
          verdict: "stuck" as const
        };
      }
    };

    const session = await runTask(
      {
        id: "memory-summary",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Inspect memory behavior.",
        mode: "keyboard",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agent
      }
    );

    expect(seenMemoryLengths).toEqual([0, 1, 1]);
    expect(seenSummaryStepCounts).toEqual([3]);
    expect(session.experienceSummary).toEqual({
      overall: "Recorded 3 steps.",
      blockers: ["Navigation took more than one step."],
      surprise: "The task needed one extra pass before stopping.",
      oneLineFeel: "Short run with one repeated navigation step."
    });
  });

  it("records a non-fatal experience summary error when summary generation fails", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-summary-error-"));
    const session = await runTask(
      {
        id: "summary-error",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Trigger a summary failure without failing the run.",
        mode: "keyboard",
        maxSteps: 1,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agent: {
          async decide() {
            return {
              verdict: "stuck",
              rationale: "Stop after the first turn."
            };
          },
          async summarizeExperience() {
            throw new Error("summary parser mismatch");
          }
        }
      }
    );

    expect(session.experienceSummary).toBeUndefined();
    expect(session.experienceSummaryError).toBe("summary parser mismatch");
  });

  it("feeds verification failure back into the next agent turn", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verify-feedback-"));
    const observedMemoryActions: string[][] = [];
    let callCount = 0;

    const session = await runTask(
      {
        id: "verify-feedback",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Need verified success.",
        mode: "keyboard",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        agent: {
          decide: async (ctx) => {
            observedMemoryActions.push(ctx.memory.map((entry) => entry.action));
            callCount += 1;

            if (callCount === 1) {
              return {
                verdict: "success",
                rationale: "Looks done."
              };
            }

            return {
              verdict: "stuck",
              rationale: "Verifier says not done."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps[0].verification).toEqual({
      passed: false,
      failures: ['Verification failed: expected visible text containing "Never appears" was not observed.']
    });
    expect(session.steps[0].verdictAnalysis).toEqual({
      agentVerdict: "success",
      verificationResult: "failed",
      finalResult: "continued",
      completionSource: "agent"
    });
    expect(observedMemoryActions[1]).toContain("verdict(success)");
  });

  it("stops after two failed verified-success attempts", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verify-retries-"));
    let callCount = 0;
    const recordedOutcomes: string[] = [];

    const session = await runTask(
      {
        id: "verify-retries",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Need verified success.",
        mode: "keyboard",
        maxSteps: 6,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        agent: {
          decide: async () => {
            callCount += 1;
            return {
              verdict: "success",
              rationale: `Attempt ${callCount}`
            };
          },
          recordStepOutcome: (entry) => {
            recordedOutcomes.push(entry.outcome);
          }
        }
      }
    );

    expect(callCount).toBe(2);
    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.aggregate.failurePoint?.reason).toContain("Verified success was not reached");
    expect(session.steps).toHaveLength(2);
    expect(session.steps[1].verification?.passed).toBe(false);
    expect(recordedOutcomes).toEqual(["continued", "failure"]);
  });

  it("applies a custom verification retry budget consistently across trace and memory", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verify-retries-custom-"));
    const seenHistorySources: string[][] = [];
    const recordedOutcomes: string[] = [];
    let callCount = 0;

    const session = await runTask(
      {
        id: "verify-retries-custom",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Need verified success.",
        mode: "keyboard",
        maxSteps: 8,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        maxVerificationRetries: 3,
        agent: {
          decide: async (ctx) => {
            callCount += 1;
            seenHistorySources.push(ctx.memory.map((entry) => entry.outcome));
            return {
              verdict: "success",
              rationale: `Attempt ${callCount}`
            };
          },
          recordStepOutcome: (entry) => {
            recordedOutcomes.push(entry.outcome);
          }
        }
      }
    );

    expect(callCount).toBe(3);
    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps).toHaveLength(3);
    expect(session.steps[0].verdictAnalysis?.finalResult).toBe("continued");
    expect(session.steps[1].verdictAnalysis?.finalResult).toBe("continued");
    expect(session.steps[2].verdictAnalysis?.finalResult).toBe("failure");
    expect(seenHistorySources[1]).toContain("continued");
    expect(seenHistorySources[2]).toContain("continued");
    expect(recordedOutcomes).toEqual(["continued", "continued", "failure"]);
  });

  it("ends with an error when named input is used without opt-in input data", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-type-text-disabled-"));

    const session = await runTask(
      {
        id: "type-text-disabled",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Try text input without opt-in.",
        mode: "keyboard",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agent: {
          decide: async () => ({
            action: { typeText: "passport" },
            rationale: "Attempt named input."
          })
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("error");
    expect(session.steps[0].execution.error).toContain("Task text inputs are not enabled");
  });

  it("does not feed gated named input failures back into agent history", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-type-text-gate-fail-"));
    const seenHistory: string[] = [];
    let callCount = 0;

    const session = await runTask(
      {
        id: "type-text-gate-fail",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Try text input on a non-input target.",
        mode: "keyboard",
        maxSteps: 3,
        timeoutMs: 60_000,
        input: { email: "passport" },
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        agent: {
          decide: async (ctx) => {
            callCount += 1;
            seenHistory.push(...ctx.memory.map((entry) => `${entry.action}:${entry.outcome}`));

            if (callCount === 1) {
              return {
                action: { typeText: "passport" },
                rationale: "Try the email input."
              };
            }

            return {
              verdict: "stuck",
              rationale: "No visible progress."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps[0].execution).toEqual({
      ok: false,
      costDelta: 0,
      error: "Action did not produce an observable text-entry state change."
    });
    expect(seenHistory.join(" ")).toContain('typeText("passport")');
  });

  it("completes the email login fixture with a named email input", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-type-text-success-"));
    let typedEmail = false;
    let submitted = false;
    const session = await runTask(
      {
        id: "email-login",
        url: pathToFileURL(resolve("fixtures/email-login.html")).toString(),
        goal: "Enter the task email and send the magic link.",
        mode: "keyboard",
        maxSteps: 10,
        timeoutMs: 60_000,
        input: { email: "traveler@example.com" },
        verify: {
          all: [
            { titleIncludes: "Completed" },
            { textVisible: "Magic link sent." },
            { textVisibleExact: "Magic link sent. traveler@example.com" }
          ]
        }
      },
      {
        outDir,
        agent: {
          decide: async (_ctx, observation) => {
            if (observation.kind !== "keyboard") {
              throw new Error("Expected keyboard observation for the email login fixture.");
            }

            if (observation.browserChrome.title.includes("Completed")) {
              return {
                verdict: "success",
                rationale: "The success state is visible."
              };
            }

            if (!typedEmail && observation.focusHint === "input[type=email]") {
              typedEmail = true;
              return {
                action: { typeText: "traveler@example.com" },
                rationale: "Type the provided email address."
              };
            }

            if (!submitted && observation.focusHint === "button \"Send magic link\"") {
              submitted = true;
              return {
                action: { key: "Enter" },
                rationale: "Submit the sign-in request."
              };
            }

            return {
              action: { key: "Tab" },
              rationale: "Advance focus until the email field and submit button are reached."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.aggregate.actionCounts).toEqual({
      srInvokeCount: 0,
      srReadCount: 0,
      srMaintenanceCount: 0,
      rawKeyCount: 6,
      typeTextCount: 1
    });
    expect(session.steps[3].execution).toEqual({ ok: true, costDelta: 1 });
    expect(session.steps[6].execution).toEqual({ ok: true, costDelta: 1 });
    expect(session.steps[7].verification?.passed).toBe(true);
  });

  it("completes the credential login fixture with multiple named inputs", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-credential-login-"));
    let typedEmail = false;
    let typedPassword = false;
    let submitted = false;

    const session = await runTask(
      {
        id: "credential-login",
        url: pathToFileURL(resolve("fixtures/credential-login.html")).toString(),
        goal: "이메일과 비밀번호 입력칸에 각각 named input 값을 넣고 Sign in 버튼을 눌러라.",
        mode: "keyboard",
        maxSteps: 10,
        timeoutMs: 60_000,
        input: {
          email: "traveler@example.com",
          password: "super-secret"
        },
        verify: {
          all: [
            { titleIncludes: "Credential Login Completed" },
            { textVisible: "Signed in." }
          ]
        }
      },
      {
        outDir,
        agent: {
          decide: async (_ctx, observation) => {
            if (observation.kind !== "keyboard") {
              throw new Error("Expected keyboard observation for the credential login fixture.");
            }

            if (observation.browserChrome.title.includes("Completed")) {
              return {
                verdict: "success",
                rationale: "The signed-in state is visible."
              };
            }

            if (!typedEmail && observation.focusHint === "input[type=email]") {
              typedEmail = true;
              return {
                action: { typeText: "traveler@example.com" },
                rationale: "Fill the email field."
              };
            }

            if (!typedPassword && observation.focusHint === "input[type=password]") {
              typedPassword = true;
              return {
                action: { typeText: "super-secret" },
                rationale: "Fill the password field."
              };
            }

            if (!submitted && observation.focusHint === "button \"Sign in\"") {
              submitted = true;
              return {
                action: { key: "Enter" },
                rationale: "Submit the form."
              };
            }

            return {
              action: { key: "Tab" },
              rationale: "Advance focus until the next required field or submit button is reached."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.aggregate.actionCounts).toEqual({
      srInvokeCount: 0,
      srReadCount: 0,
      srMaintenanceCount: 0,
      rawKeyCount: 4,
      typeTextCount: 2
    });
    expect(session.steps.at(-1)?.verification?.passed).toBe(true);
  });

  it("runs the screenreader path with mocked announcements and screen reader actions", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-"));
    const observedActions: ScreenReaderAction[] = [];
    let observeCalls = 0;

    const session = await runTask(
      {
        id: "screenreader-basic",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Find and activate the main call to action.",
        mode: "screenreader",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => {
              observeCalls += 1;

              if (observeCalls === 1) {
                return {
                  kind: "screenreader",
                  announcement: "Simple CTA heading",
                  announcementCapture: "log"
                };
              }

              return {
                kind: "screenreader",
                announcement: "Get started button",
                announcementCapture: "log"
              };
            }
          },
          controller: {
            execute: async (action) => {
              observedActions.push(action);
              return { ok: true, costDelta: 1 };
            }
          }
        }),
        agent: {
          decide: async (ctx, obs) => {
            expect(ctx.screenReaderActions?.some((action) => action.token === "sr.heading.next")).toBe(true);
            expect(obs.kind).toBe("screenreader");
            expect("domFocus" in obs && obs.domFocus).toBeFalsy();

            if (observeCalls === 1) {
              return {
                action: {
                  srAction: {
                    semantic: "heading.next"
                  }
                },
                rationale: "Move to the next heading."
              };
            }

            return {
              verdict: "success",
              rationale: "The button announcement is present."
            };
          }
        }
      }
    );

    expect(observedActions).toEqual([{
      semantic: "heading.next"
    }]);
    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps[0].observation.kind).toBe("screenreader");
      expect(session.steps[0].decision).toEqual({
        action: {
          srAction: {
            semantic: "heading.next"
          }
        },
      rationale: "Move to the next heading."
    });
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.screenshot?.path).toBe("screenshots/step-000.png");
      expect(session.steps[0].observation.announcementCapture).toBe("log");
      expect(session.steps[0].observation.domFocus).toMatchObject({
        status: "captured",
        targetTagName: "body"
      });
    }
    expect(session.aggregate.actionCounts).toEqual({
      srInvokeCount: 1,
      srReadCount: 0,
      srMaintenanceCount: 0,
      rawKeyCount: 0,
      typeTextCount: 0
    });
  });

  it("uses screenreader defaults to delay planning until after 3 completed steps", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-planning-defaults-"));
    const agent = createScreenreaderPlanningAgent(5);
    let observeCalls = 0;

    const session = await runTask(
      {
        id: "screenreader-planning-defaults",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Find and activate the main call to action.",
        mode: "screenreader",
        maxSteps: 8,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => {
              observeCalls += 1;
              return {
                kind: "screenreader",
                announcement: `Announcement ${observeCalls}`,
                announcementCapture: "log"
              };
            }
          }
        }),
        agent
      }
    );

    expect(agent.planTask).toHaveBeenCalledTimes(1);
    expect(agent.decide.mock.calls[0]?.[0].plan).toBeUndefined();
    expect(agent.decide.mock.calls[1]?.[0].plan).toBeUndefined();
    expect(agent.decide.mock.calls[2]?.[0].plan).toBeUndefined();
    expect(agent.decide.mock.calls[3]?.[0].currentFocus).toBe("핵심 항목 찾기");
    expect(agent.reflectProgress).toHaveBeenCalled();
    expect(session.plan?.currentFocus).toBe("핵심 항목 찾기");
    expect(session.aggregate.endedBy).toBe("success");
  });

  it("triggers early reflection on repeated announcements and respects the cooldown", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-early-reflection-"));
    const agent = createScreenreaderEventReflectionAgent();

    const session = await runTask(
      {
        id: "screenreader-early-reflection",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Find the main action by screen reader exploration.",
        mode: "screenreader",
        maxSteps: 6,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Never matches" }]
        }
      },
      {
        outDir,
        planning: {
          enabled: true,
          reflectionCadence: 10,
          initialDelaySteps: 0,
          firstReflectionDelaySteps: 10
        },
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "반복되는 항목",
              announcementCapture: "log"
            })
          }
        }),
        agent
      }
    );

    expect(agent.planTask).toHaveBeenCalledTimes(1);
    expect(agent.reflectProgress).toHaveBeenCalledTimes(2);
    expect(agent.decide.mock.calls[0]?.[0].currentFocus).toBe("핵심 항목 찾기");
    expect(agent.decide.mock.calls[3]?.[0].currentFocus).toBe("탐색 전략 전환");
    expect(agent.decide.mock.calls[3]?.[0].strategyNote).toBe("반복 감지 3회");
    expect(agent.decide.mock.calls[4]?.[0].strategyNote).toBe("반복 감지 3회");
    expect(agent.decide.mock.calls[5]?.[0].strategyNote).toBe("반복 감지 3회");
    expect(agent.decide.mock.calls[5]?.[0].currentFocus).toBe("탐색 전략 전환");
    expect(session.reflections?.map((entry) => entry.step)).toEqual([2, 5]);
    expect(session.aggregate.endedBy).toBe("maxSteps");
  });

  it("leaves plan unset when the run ends before planning delay is reached", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-no-plan-before-delay-"));
    const agent = createScreenreaderPlanningAgent();

    const session = await runTask(
      {
        id: "screenreader-no-plan-before-delay",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Run out of steps before planning starts.",
        mode: "screenreader",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Bootstrap announcement",
              announcementCapture: "log"
            })
          }
        }),
        agent
      }
    );

    expect(agent.planTask).not.toHaveBeenCalled();
    expect(session.plan).toBeUndefined();
    expect(session.planningError).toBeUndefined();
    expect(session.aggregate.endedBy).toBe("maxSteps");
  });

  it("routes screenreader typeText actions through the screen reader controller", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-type-text-"));
    const observedActions: ScreenReaderAction[] = [];
    let observeCalls = 0;

    const session = await runTask(
      {
        id: "screenreader-type-text",
        url: pathToFileURL(resolve("fixtures/email-login.html")).toString(),
        goal: "Type the email address with the screen reader path.",
        mode: "screenreader",
        maxSteps: 2,
        timeoutMs: 60_000,
        input: {
          email: "traveler@example.com"
        },
        verify: {
          all: [{ titleIncludes: "Email Login Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: async (url) => {
          const session = await createBrowserSession(url, { headless: true });
          await session.page.evaluate(() => {
            (document.getElementById("email") as HTMLInputElement | null)?.focus();
          });
          return session;
        },
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => {
              observeCalls += 1;
              return {
                kind: "screenreader",
                announcement: observeCalls === 1 ? "Email, edit text" : "Email, edit text, traveler@example.com",
                announcementCapture: "log"
              };
            }
          },
          controller: {
            execute: async (action) => {
              observedActions.push(action);
              return { ok: true, costDelta: 1 };
            }
          }
        }),
        agent: {
          decide: async (_ctx, _obs) => {
            if (observeCalls === 1) {
              return {
                action: { typeText: "traveler@example.com" as const },
                rationale: "Type the provided email."
              };
            }

            return {
              verdict: "success",
              rationale: "The email input already contains the task value."
            };
          }
        }
      }
    );

    expect(
      observedActions.filter((action) => action.semantic === "type")
    ).toEqual([{
      semantic: "type",
      text: "traveler@example.com"
    }]);
    expect(session.aggregate.actionCounts).toEqual({
      srInvokeCount: 0,
      srReadCount: 0,
      srMaintenanceCount: 0,
      rawKeyCount: 0,
      typeTextCount: 1
    });
  });

  it("uses a synthetic announcement for VoiceOver typeText actions", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-voiceover-type-text-"));
    const observedActions: ScreenReaderAction[] = [];
    let observeCalls = 0;

    const session = await runTask(
      {
        id: "screenreader-type-text-voiceover",
        url: pathToFileURL(resolve("fixtures/email-login.html")).toString(),
        goal: "Type the email address with a stable VoiceOver-friendly fallback.",
        mode: "screenreader",
        maxSteps: 2,
        timeoutMs: 60_000,
        input: {
          email: "traveler@example.com"
        },
        verify: {
          all: [{ titleIncludes: "Email Login Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: async (url) => {
          const session = await createBrowserSession(url, { headless: true });
          await session.page.evaluate(() => {
            (document.getElementById("email") as HTMLInputElement | null)?.focus();
          });
          return session;
        },
        screenReaderBackendId: "guidepup-voiceover",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => {
              observeCalls += 1;
              return {
                kind: "screenreader",
                announcement: observeCalls === 1 ? "Email, edit text" : "Email, edit text, traveler@examplecom",
                announcementCapture: "log"
              };
            }
          },
          controller: {
            execute: async (action) => {
              observedActions.push(action);
              return { ok: true, costDelta: 1 };
            }
          }
        }),
        agent: {
          decide: async (_ctx, obs) => {
            if (observeCalls === 1) {
              return {
                action: { typeText: "traveler@example.com" as const },
                rationale: "Type the provided email."
              };
            }

            expect(obs.kind).toBe("screenreader");
            if (obs.kind === "screenreader") {
              expect(obs.announcement).toBe("Email, current value traveler@example.com");
              expect(obs.announcementCapture).toBe("synthetic");
            }

            return {
              verdict: "success",
              rationale: "The synthetic announcement reflects the typed email."
            };
          }
        }
      }
    );

    expect(
      observedActions.filter((action) => action.semantic === "type")
    ).toEqual([]);
    expect(session.steps[1]?.observation.kind).toBe("screenreader");
    if (session.steps[1]?.observation.kind === "screenreader") {
      expect(session.steps[1].observation.announcement).toBe("Email, current value traveler@example.com");
      expect(session.steps[1].observation.announcementCapture).toBe("synthetic");
      expect(session.steps[1].observation.observeReason).toBe("synthetic");
    }
  });

  it("can disable developer screenshots for screenreader steps", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-no-shots-"));

    const session = await runTask(
      {
        id: "screenreader-no-shots",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Finish without saving developer screenshots.",
        mode: "screenreader",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        screenshotPolicy: "none",
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Get started button",
              announcementCapture: "log"
            })
          }
        }),
        agent: {
          decide: async () => ({
            verdict: "success",
            rationale: "The button announcement is present."
          })
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps[0].observation.kind).toBe("screenreader");
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.screenshot).toBeUndefined();
    }
  });

  it("fails when the agent still returns a raw key action in screenreader mode", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-keyless-key-"));

    const session = await runTask(
      {
        id: "screenreader-keyless-key",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Do not allow raw keys.",
        mode: "screenreader",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Simple CTA heading",
              announcementCapture: "log"
            })
          }
        }),
        agent: {
          decide: async (ctx) => {
            expect(ctx.keyboardActions).toEqual([]);
            expect(ctx.screenReaderActions?.some((action) => action.token === "sr.heading.next")).toBe(true);
            return {
              action: { key: "Tab" },
              rationale: "This should be rejected because no raw keys are allowed."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("error");
    expect(session.steps[0].execution.error).toBe("Raw key actions are not allowed in the current mode.");
    expect(session.aggregate.actionCounts).toEqual({
      srInvokeCount: 0,
      srReadCount: 0,
      srMaintenanceCount: 0,
      rawKeyCount: 1,
      typeTextCount: 0
    });
  });

  it("runs the screenreader path with screen reader actions only when keyboard actions are disabled", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-keyless-"));
    const observedActions: ScreenReaderAction[] = [];
    let observeCalls = 0;

    const session = await runTask(
      {
        id: "screenreader-keyless-basic",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Find and activate the main call to action.",
        mode: "screenreader",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        keyboardActionPlan: buildKeyboardActionPlan([]),
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => {
              observeCalls += 1;

              if (observeCalls === 1) {
                return {
                  kind: "screenreader",
                  announcement: "Simple CTA heading",
                  announcementCapture: "log"
                };
              }

              return {
                kind: "screenreader",
                announcement: "Get started button",
                announcementCapture: "log"
              };
            }
          },
          controller: {
            execute: async (action) => {
              observedActions.push(action);
              return { ok: true, costDelta: 1 };
            }
          }
        }),
        agent: {
          decide: async (ctx, obs) => {
            expect(ctx.keyboardActions).toEqual([]);
            expect(ctx.screenReaderActions?.some((action) => action.token === "sr.heading.next")).toBe(true);
            expect(obs.kind).toBe("screenreader");

            if (observeCalls === 1) {
              return {
                action: {
                  srAction: {
                    semantic: "heading.next"
                  }
                },
                rationale: "Move to the next heading."
              };
            }

            return {
              verdict: "success",
              rationale: "The button announcement is present."
            };
          }
        }
      }
    );

    expect(observedActions).toEqual([{
      semantic: "heading.next"
    }]);
    expect(session.aggregate.endedBy).toBe("success");
    expect(session.aggregate.actionCounts).toEqual({
      srInvokeCount: 1,
      srReadCount: 0,
      srMaintenanceCount: 0,
      rawKeyCount: 0,
      typeTextCount: 0
    });
    expect(session.aggregate.timings.screenReaderInitMs).toBe(12);
    expect(session.aggregate.timings.firstAnnouncementWaitMs).toBe(34);
    expect(session.steps[1].verdictAnalysis).toEqual({
      agentVerdict: "success",
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "agent"
    });
  });

  it("can auto-complete verified success after a successful action when the option is enabled", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-complete-"));
    let callCount = 0;

    const session = await runTask(
      {
        id: "verifier-auto-complete",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Activate the CTA.",
        mode: "keyboard",
        maxSteps: 6,
        timeoutMs: 60_000,
        verify: {
          all: [
            { textVisible: "Started!" },
            { titleIncludes: "Completed" }
          ]
        }
      },
      {
        outDir,
        verifierAutoComplete: true,
        agent: {
          decide: async () => {
            callCount += 1;

            if (callCount === 1 || callCount === 2) {
              return {
                action: { key: "Tab" as const },
                rationale: "Move focus forward."
              };
            }

            return {
              action: { key: "Enter" as const },
              rationale: "Activate the focused CTA."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps).toHaveLength(3);
    expect(session.steps[2].verification).toEqual({
      passed: true,
      failures: []
    });
    expect(session.steps[2].verdictAnalysis).toEqual({
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "verifier-auto-complete"
    });
  });

  it("does not auto-complete on step 0 before any successful action", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-complete-step0-"));

    const session = await runTask(
      {
        id: "verifier-auto-complete-step0",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Do not auto-complete before the agent acts.",
        mode: "keyboard",
        maxSteps: 1,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        verifierAutoComplete: true,
        agent: {
          decide: async () => ({
            verdict: "stuck" as const,
            rationale: "I am not attempting the task."
          })
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps[0].verification).toBeUndefined();
    expect(session.steps[0].verdictAnalysis).toEqual({
      agentVerdict: "stuck",
      verificationResult: "not-run",
      finalResult: "failure",
      completionSource: "agent"
    });
  });

  it("keeps running when verifier auto-complete is enabled but verification still fails", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-complete-fail-"));
    let callCount = 0;
    const recordedOutcomes: string[] = [];

    const session = await runTask(
      {
        id: "verifier-auto-complete-fail",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Try the CTA even though verify will fail.",
        mode: "keyboard",
        maxSteps: 4,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        verifierAutoComplete: true,
        agent: {
          decide: async () => {
            callCount += 1;
            if (callCount < 4) {
              return {
                action: { key: "Tab" as const },
                rationale: "Keep moving."
              };
            }

            return {
              verdict: "stuck" as const,
              rationale: "This still is not verified."
            };
          },
          recordStepOutcome: (entry) => {
            recordedOutcomes.push(entry.outcome);
          }
        }
      }
    );

    expect(callCount).toBe(4);
    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps.every((step) => step.verification === undefined)).toBe(true);
    expect(session.steps.slice(0, -1).every((step) => step.verdictAnalysis === undefined)).toBe(true);
    expect(recordedOutcomes).toEqual(["continued", "continued", "continued", "failure"]);
  });

  it("can auto-complete using network-only verification rules", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-network-"));

    const session = await runTask(
      {
        id: "verifier-auto-network",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Trigger the checkout network call.",
        mode: "keyboard",
        maxSteps: 6,
        timeoutMs: 60_000,
        verify: {
          all: [{ responseSeen: { urlIncludes: "/api/cart", method: "POST", status: 200 } }]
        }
      },
      {
        outDir,
        verifierAutoComplete: true,
        browserSessionFactory: async (url) => {
          const session = await createBrowserSession(url, { headless: true });
          session.network.responses.push({
            url: "http://fixture.local/api/cart",
            method: "POST",
            status: 200,
            ok: true,
            timestamp: new Date().toISOString()
          });
          return session;
        },
        agent: {
          decide: async () => {
            return {
              action: { key: "Tab" as const },
              rationale: "Perform one successful action before verification."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps.at(-1)?.verification?.passed).toBe(true);
    expect(session.steps.at(-1)?.verdictAnalysis).toEqual({
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "verifier-auto-complete"
    });
  });

  it("can auto-complete using the latest activation announcement in screenreader mode", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-activation-"));
    let observeCalls = 0;

    const session = await runTask(
      {
        id: "verifier-auto-activation",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Activate the cart control.",
        mode: "screenreader",
        maxSteps: 4,
        timeoutMs: 60_000,
        verify: {
          all: [{ activatedAnnouncementIncludes: "장바구니" }]
        }
      },
      {
        outDir,
        verifierAutoComplete: true,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: observeCalls++ === 0 ? "장바구니 버튼" : "로그인 페이지",
              announcementCapture: "log"
            })
          }
        }),
        agent: {
          decide: async (ctx, obs) => {
            expect(ctx.memory).toHaveLength(0);
            expect(obs.kind).toBe("screenreader");
            return {
              action: {
                srAction: {
                  semantic: "act"
                }
              },
              rationale: "Activate the announced cart control."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].verification).toEqual({
      passed: true,
      failures: []
    });
    expect(session.steps[0].verdictAnalysis).toEqual({
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "verifier-auto-complete"
    });
  });

  it("continues with the same screenreader observation flow after a successful srAction", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-interactive-"));
    let observeCalls = 0;

    const session = await runTask(
      {
        id: "screenreader-interactive",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Activate the main button.",
        mode: "screenreader",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => {
              observeCalls += 1;

              if (observeCalls === 1) {
                return {
                  kind: "screenreader",
                  announcement: "Get started button",
                  announcementCapture: "log"
                };
              }

              return {
                kind: "screenreader",
                announcement: "Started!",
                announcementCapture: "log"
              };
            }
          }
        }),
        agent: {
          decide: async () => {
            if (observeCalls === 1) {
              return {
                action: { srAction: { semantic: "click" as const } },
                rationale: "Activate the button."
              };
            }

            return {
              verdict: "success" as const,
              rationale: "The result announcement is present."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
  });

  it("replaces a browser-ui screenreader observation with a recovered observation before agent input", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-runtime-recovery-"));
    let observeCalls = 0;
    const recoverFromUnexpectedBrowserUi = vi.fn(async () => ({
      observation: {
        kind: "screenreader" as const,
        announcement: "Recovered in-page button",
        announcementCapture: "log" as const
      },
      recovered: true,
      feedbackNote: "브라우저 UI 감지 후 자동 복구를 수행했고, 웹 본문으로 다시 정렬했습니다.",
      diagnostics: [{
        scope: "screenReaderInit" as const,
        level: "warn" as const,
        code: "SCREENREADER_RUNTIME_RECOVERY_SUCCEEDED",
        message: "Recovered before agent observation."
      }]
    }));
    const seenAnnouncements: string[] = [];
    const seenReadbacks: Array<ScreenReaderReadback[] | undefined> = [];

    const session = await runTask(
      {
        id: "screenreader-runtime-recovery",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Read the recovered in-page control.",
        mode: "screenreader",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => {
              observeCalls += 1;
              return observeCalls === 1
                ? {
                    kind: "screenreader",
                    announcement: "새 탭 버튼. 현재 그룹 안에 있는 버튼에 있습니다.",
                    announcementCapture: "log"
                  }
                : {
                    kind: "screenreader",
                    announcement: "Recovered in-page button",
                    announcementCapture: "log"
                  };
            }
          },
          recoverFromUnexpectedBrowserUi
        }),
        agent: {
          decide: async (_ctx, obs) => {
            if (obs.kind === "screenreader") {
              seenAnnouncements.push(obs.announcement);
              seenReadbacks.push(obs.readbacks);
            }
            return {
              verdict: "success" as const,
              rationale: "Recovered observation reached the agent."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(recoverFromUnexpectedBrowserUi).toHaveBeenCalledTimes(1);
    expect(seenAnnouncements).toEqual(["Recovered in-page button"]);
    expect(seenReadbacks[0]).toContainEqual({
      kind: "note",
      source: "runtime-recovery",
      value: "브라우저 UI 감지 후 자동 복구를 수행했고, 웹 본문으로 다시 정렬했습니다."
    });
    const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
    expect(diagnostics).toContain("SCREENREADER_RUNTIME_RECOVERY_SUCCEEDED");
  });

  it("passes through the original browser-ui observation with a recovery failure note when runtime recovery fails", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-runtime-recovery-fail-"));
    const recoverFromUnexpectedBrowserUi = vi.fn(async ({ observation }: { observation: ScreenReaderObservation }) => ({
      observation,
      recovered: false,
      feedbackNote: "브라우저 UI를 감지했지만 자동 복구에 실패했습니다. 현재 observation은 웹 본문 밖일 수 있습니다.",
      diagnostics: [{
        scope: "screenReaderInit" as const,
        level: "warn" as const,
        code: "SCREENREADER_RUNTIME_RECOVERY_FAILED",
        message: "Recovery failed before agent observation."
      }]
    }));
    const seenAnnouncements: string[] = [];
    const seenReadbacks: Array<ScreenReaderReadback[] | undefined> = [];

    const session = await runTask(
      {
        id: "screenreader-runtime-recovery-fail",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Surface recovery failure context.",
        mode: "screenreader",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Never matches" }]
        }
      },
      {
        outDir,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "새 탭 버튼. 현재 그룹 안에 있는 버튼에 있습니다.",
              announcementCapture: "log"
            })
          },
          recoverFromUnexpectedBrowserUi
        }),
        agent: {
          decide: async (_ctx, obs) => {
            if (obs.kind === "screenreader") {
              seenAnnouncements.push(obs.announcement);
              seenReadbacks.push(obs.readbacks);
            }
            return {
              verdict: "stuck" as const,
              rationale: "Recovery failure should be visible."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(recoverFromUnexpectedBrowserUi).toHaveBeenCalledTimes(1);
    expect(seenAnnouncements).toEqual(["새 탭 버튼. 현재 그룹 안에 있는 버튼에 있습니다."]);
    expect(seenReadbacks[0]).toContainEqual({
      kind: "note",
      source: "runtime-recovery",
      value: "브라우저 UI를 감지했지만 자동 복구에 실패했습니다. 현재 observation은 웹 본문 밖일 수 있습니다."
    });
    const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
    expect(diagnostics).toContain("SCREENREADER_RUNTIME_RECOVERY_FAILED");
  });

  it("skips runtime recovery for non-browser-ui announcements and does not add recovery readbacks", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-runtime-recovery-skip-"));
    const recoverFromUnexpectedBrowserUi = vi.fn(async ({ observation }: { observation: ScreenReaderObservation }) => ({
      observation,
      recovered: false,
      feedbackNote: "",
      diagnostics: []
    }));
    const seenAnnouncements: string[] = [];
    const seenReadbacks: Array<ScreenReaderReadback[] | undefined> = [];

    const session = await runTask(
      {
        id: "screenreader-runtime-recovery-skip",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Pass through in-page announcements without recovery.",
        mode: "screenreader",
        maxSteps: 2,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Simple CTA Fixture 웹 콘텐츠. Get started 버튼.",
              announcementCapture: "log"
            })
          },
          recoverFromUnexpectedBrowserUi
        }),
        agent: {
          decide: async (_ctx, obs) => {
            if (obs.kind === "screenreader") {
              seenAnnouncements.push(obs.announcement);
              seenReadbacks.push(obs.readbacks);
            }
            return {
              verdict: "success" as const,
              rationale: "Recovery should not run for in-page announcements."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(recoverFromUnexpectedBrowserUi).not.toHaveBeenCalled();
    expect(seenAnnouncements).toEqual(["Simple CTA Fixture 웹 콘텐츠. Get started 버튼."]);
    expect(seenReadbacks[0]).toBeUndefined();
    await expect(access(join(outDir, "diagnostics.jsonl"))).rejects.toThrow();
  });

  it("feeds verifier feedback back into the screenreader path", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-verify-"));
    const seenHistorySources: string[][] = [];
    let callCount = 0;

    const session = await runTask(
      {
        id: "screenreader-verify",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Reach verified success.",
        mode: "screenreader",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Get started button",
              announcementCapture: "log"
            })
          }
        }),
        agent: {
          decide: async (ctx) => {
            seenHistorySources.push(ctx.memory.map((entry) => entry.outcome));
            callCount += 1;

            if (callCount === 1) {
              return {
                verdict: "success",
                rationale: "Sounds complete."
              };
            }

            return {
              verdict: "stuck",
              rationale: "Verifier says it is not complete."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps[0].verification?.passed).toBe(false);
    expect(seenHistorySources[1]).toContain("continued");
  });

  it("stores only failed screenreader steps when screenshot policy is failure-only", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-failure-shots-"));
    let callCount = 0;

    const session = await runTask(
      {
        id: "screenreader-failure-shots",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Reach verified success.",
        mode: "screenreader",
        maxSteps: 3,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Never appears" }]
        }
      },
      {
        outDir,
        screenshotPolicy: "failure-only",
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Get started button",
              announcementCapture: "log"
            })
          }
        }),
        agent: {
          decide: async () => {
            callCount += 1;

            if (callCount === 1) {
              return {
                action: {
                  srAction: {
                    semantic: "heading.next"
                  }
                },
                rationale: "Move once before deciding."
              };
            }

            return {
              verdict: "success",
              rationale: "Sounds complete."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("stuck");
    expect(session.steps[0].observation.kind).toBe("screenreader");
    expect(session.steps[1].observation.kind).toBe("screenreader");
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.screenshot).toBeUndefined();
    }
    if (session.steps[1].observation.kind === "screenreader") {
      expect(session.steps[1].observation.screenshot?.path).toBe("screenshots/step-001.png");
    }
  });

  it("stores verifier auto-complete success steps even when screenshot policy is failure-only", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-verifier-auto-shots-"));

    const session = await runTask(
      {
        id: "verifier-auto-shots",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Reach auto-completed verified success.",
        mode: "screenreader",
        maxSteps: 4,
        timeoutMs: 60_000,
        verify: {
          all: [{ textVisible: "Started!" }]
        }
      },
      {
        outDir,
        screenshotPolicy: "failure-only",
        verifierAutoComplete: true,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async (page) => {
          await page.evaluate(() => {
            const button = document.querySelector("button");
            if (button instanceof HTMLElement) {
              button.focus();
            }
          });

          return createMockScreenReaderRuntime({
            observer: {
              observe: async () => ({
                kind: "screenreader",
                announcement: "Get started button",
                announcementCapture: "log"
              })
            },
            controller: {
              execute: async () => {
                await page.evaluate(() => {
                  document.title = "Completed";
                  const result = document.getElementById("result");
                  if (result instanceof HTMLElement) {
                    result.hidden = false;
                    result.textContent = "Started!";
                  }
                });
                return { ok: true, costDelta: 1 };
              }
            }
          });
        },
        agent: {
          decide: async () => {
            return {
              action: { srAction: { semantic: "click" as const } },
              rationale: "Activate the CTA."
            };
          }
        }
      }
    );

    expect(session.aggregate.endedBy).toBe("success");
    expect(session.steps[0].observation.kind).toBe("screenreader");
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.screenshot?.path).toBe("screenshots/step-000.png");
    }
    expect(session.steps[0].verdictAnalysis).toEqual({
      verificationResult: "passed",
      finalResult: "success",
      completionSource: "verifier-auto-complete"
    });
  });

  it("records VoiceOver cursor screenshots in the trace without exposing them to the agent", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-voiceover-cursor-"));
    const cursorSourcePath = join(outDir, "voiceover-cursor-source.png");
    await writeFile(cursorSourcePath, "fake-cursor-png", "utf8");

    const session = await runTask(
      {
        id: "screenreader-voiceover-cursor",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Capture the current VoiceOver cursor.",
        mode: "screenreader",
        maxSteps: 1,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-voiceover",
        voiceOver: {
          cursorScreenshot: true
        },
        screenReaderRuntimeFactory: async () => createMockScreenReaderRuntime({
          observer: {
            observe: async () => ({
              kind: "screenreader",
              announcement: "Get started button",
              announcementCapture: "log"
            })
          },
          captureCursorScreenshot: async () => ({
            status: "captured",
            sourcePath: cursorSourcePath
          })
        }),
        agent: {
          decide: async (_ctx, obs) => {
            expect(obs.kind).toBe("screenreader");
            expect("cursorScreenshot" in obs && obs.cursorScreenshot).toBeFalsy();
            return {
              verdict: "success",
              rationale: "The button announcement is present."
            };
          }
        }
      }
    );

    expect(session.steps[0].observation.kind).toBe("screenreader");
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.cursorScreenshot).toEqual({
        status: "captured",
        path: "screenshots/step-000-voiceover-cursor.png"
      });
    }
  });

  it("records domFocus capture errors in the trace when focus inspection fails", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-dom-focus-error-"));

    const session = await runTask(
      {
        id: "screenreader-dom-focus-error",
        url: pathToFileURL(resolve("fixtures/simple-cta.html")).toString(),
        goal: "Capture a domFocus inspection failure.",
        mode: "screenreader",
        maxSteps: 1,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Simple CTA Fixture" }]
        }
      },
      {
        outDir,
        screenshotPolicy: "none",
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-virtual",
        screenReaderRuntimeFactory: async (page) => createMockScreenReaderRuntime({
          observer: {
            observe: async () => {
              await page.close();
              return {
                kind: "screenreader",
                announcement: "Get started button",
                announcementCapture: "log"
              };
            }
          }
        }),
        agent: {
          decide: async (_ctx, obs) => {
            expect(obs.kind).toBe("screenreader");
            expect("domFocus" in obs && obs.domFocus).toBeFalsy();
            return {
              verdict: "stuck",
              rationale: "Stop after the forced domFocus capture failure."
            };
          }
        }
      }
    );

    expect(session.steps[0].observation.kind).toBe("screenreader");
    if (session.steps[0].observation.kind === "screenreader") {
      expect(session.steps[0].observation.domFocus).toEqual({
        status: "failed"
      });
    }
    await expect(access(join(outDir, "diagnostics.jsonl"))).resolves.toBeUndefined();
    const diagnostics = await readFile(join(outDir, "diagnostics.jsonl"), "utf8");
    expect(diagnostics).toContain("DOM_FOCUS_CAPTURE_FAILED");
    expect(diagnostics.toLowerCase()).toContain("closed");
  });

  it("keeps the domFocus page.evaluate callback free of tsx helper wrappers", () => {
    expect(String(captureScreenReaderDomFocus)).not.toContain("__name(");
  });

  it("finalizes and publishes outputs when screenreader initialization fails before step 0", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "a11y-runner-screenreader-init-failure-"));

    await expect(runTask(
      {
        id: "screenreader-init-failure",
        url: pathToFileURL(resolve("fixtures/email-login.html")).toString(),
        goal: "Initialize screenreader mode.",
        mode: "screenreader",
        maxSteps: 1,
        timeoutMs: 60_000,
        verify: {
          all: [{ titleIncludes: "Email Login Fixture" }]
        }
      },
      {
        outDir,
        screenshotPolicy: "none",
        browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
        screenReaderBackendId: "guidepup-voiceover",
        screenReaderRuntimeFactory: async () => {
          throw new ScreenReaderInitializationError(
            "Screen reader initialization failed because focus remained in browser UI instead of web content.",
            [
              {
                scope: "screenReaderInit",
                level: "warn",
                code: "SCREENREADER_INIT_BROWSER_UI_DETECTED",
                message: "Screen reader focus started in browser UI instead of web content."
              },
              {
                scope: "screenReaderInit",
                level: "error",
                code: "SCREENREADER_INIT_RECOVERY_FAILED",
                message: "Screen reader initialization could not recover from browser UI focus."
              }
            ],
            {
              screenReaderInitMs: 12,
              firstAnnouncementWaitMs: 34
            }
          );
        },
        agent: createStuckAgent()
      }
    )).rejects.toBeInstanceOf(RunTaskFailedError);

    let failedSession: RunTaskFailedError | undefined;
    try {
      await runTask(
        {
          id: "screenreader-init-failure",
          url: pathToFileURL(resolve("fixtures/email-login.html")).toString(),
          goal: "Initialize screenreader mode.",
          mode: "screenreader",
          maxSteps: 1,
          timeoutMs: 60_000,
          verify: {
            all: [{ titleIncludes: "Email Login Fixture" }]
          }
        },
        {
          outDir,
          screenshotPolicy: "none",
          browserSessionFactory: (url) => createBrowserSession(url, { headless: true }),
          screenReaderBackendId: "guidepup-voiceover",
          screenReaderRuntimeFactory: async () => {
            throw new ScreenReaderInitializationError(
              "Screen reader initialization failed because focus remained in browser UI instead of web content.",
              [
                {
                  scope: "screenReaderInit",
                  level: "warn",
                  code: "SCREENREADER_INIT_BROWSER_UI_DETECTED",
                  message: "Screen reader focus started in browser UI instead of web content."
                },
                {
                  scope: "screenReaderInit",
                  level: "error",
                  code: "SCREENREADER_INIT_RECOVERY_FAILED",
                  message: "Screen reader initialization could not recover from browser UI focus."
                }
              ],
              {
                screenReaderInitMs: 12,
                firstAnnouncementWaitMs: 34
              }
            );
          },
          agent: createStuckAgent()
        }
      );
    } catch (error) {
      failedSession = error as RunTaskFailedError;
    }

    expect(failedSession).toBeInstanceOf(RunTaskFailedError);
    expect(failedSession?.session.aggregate.totalSteps).toBe(0);
    expect(failedSession?.session.aggregate.failurePoint).toEqual({
      stepIndex: -1,
      reason: "Screen reader initialization failed: Screen reader initialization failed because focus remained in browser UI instead of web content."
    });

    const published = await publishRunOutputs(failedSession!.session, outDir, []);
    expect(await readFile(join(outDir, "diagnostics.jsonl"), "utf8")).toContain("SCREENREADER_INIT_RECOVERY_FAILED");
    await expect(access(published.outputPaths.metricsJson)).resolves.toBeUndefined();
    await expect(access(published.outputPaths.traceJson)).resolves.toBeUndefined();
    await expect(access(published.outputPaths.reportHtml)).resolves.toBeUndefined();
  });
});
