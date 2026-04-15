import {
  buildScreenReaderActionPlan,
  createStableScreenReaderActionRef
} from "../packages/action-catalog/src";
import type { ExecutableScreenReaderAction } from "../packages/action-catalog/src";
import {
  createEmptyScreenReaderCapabilities,
  createAnnouncementReader,
  createScreenReaderRuntime,
  findScreenReaderBackendById,
  listScreenReaderBackends,
  resolveScreenReaderCapabilities,
  SCREEN_READER_BACKEND_IDS,
  type ScreenReaderBackend,
  type ScreenReaderSession
} from "@rawstep/runtime";
import type { ScreenReaderAction, ScreenReaderCapabilities } from "@rawstep/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_DOCUMENT = (globalThis as { document?: unknown }).document;
const ORIGINAL_HTML_ELEMENT = (globalThis as { HTMLElement?: unknown }).HTMLElement;
const TEST_CAPABILITIES: ScreenReaderCapabilities = {
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
  ]
};

afterEach(() => {
  Object.defineProperty(process, "platform", {
    value: ORIGINAL_PLATFORM,
    configurable: true
  });

  if (ORIGINAL_DOCUMENT === undefined) {
    delete (globalThis as { document?: unknown }).document;
  } else {
    (globalThis as { document?: unknown }).document = ORIGINAL_DOCUMENT;
  }

  if (ORIGINAL_HTML_ELEMENT === undefined) {
    delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
  } else {
    (globalThis as { HTMLElement?: unknown }).HTMLElement = ORIGINAL_HTML_ELEMENT;
  }
});

function createMockScreenReaderSession(overrides: Partial<ScreenReaderSession> = {}): ScreenReaderSession {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    next: vi.fn(async () => undefined),
    previous: vi.fn(async () => undefined),
    act: vi.fn(async () => undefined),
    interact: vi.fn(async () => undefined),
    stopInteracting: vi.fn(async () => undefined),
    perform: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    type: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    itemText: vi.fn(async () => ""),
    lastSpokenPhrase: vi.fn(async () => ""),
    itemTextLog: vi.fn(async () => []),
    spokenPhraseLog: vi.fn(async () => []),
    clearItemTextLog: vi.fn(async () => undefined),
    clearSpokenPhraseLog: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("observer-screenreader", () => {
  it("lists built-in backends in catalog order", () => {
    expect(listScreenReaderBackends().map((backend) => backend.id)).toEqual(SCREEN_READER_BACKEND_IDS);
  });

  it("returns empty capabilities when no runtime or backend context is available", () => {
    expect(resolveScreenReaderCapabilities({})).toEqual(createEmptyScreenReaderCapabilities());
  });

  it("reads the spoken phrase log first and then reports none when no text was captured", async () => {
    const reader = createAnnouncementReader({
      spokenPhraseLog: vi
        .fn<() => Promise<string[]>>()
        .mockResolvedValueOnce(["Heading", "Get started button"])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      clearSpokenPhraseLog: vi.fn(async () => undefined),
      lastSpokenPhrase: vi.fn(async () => "Welcome")
    }, {
      default: {
        pollIntervalMs: 1,
        silenceWindowMs: 1,
        maxObserveMs: 4
      }
    });

    await expect(reader()).resolves.toMatchObject({
      announcement: "Heading\nGet started button",
      announcementCapture: "log",
      announcementCount: 2
    });
    await expect(reader()).resolves.toEqual({
      announcement: "",
      announcementCapture: "none",
      announcementCount: 0,
      observeReason: "timeout"
    });
  });

  it("uses the last spoken phrase for the initial observation when the log is empty", async () => {
    const reader = createAnnouncementReader({
      spokenPhraseLog: vi
        .fn<() => Promise<string[]>>()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      clearSpokenPhraseLog: vi.fn(async () => undefined),
      lastSpokenPhrase: vi.fn(async () => "Main landmark")
    }, {
      initial: {
        pollIntervalMs: 1,
        silenceWindowMs: 1,
        maxObserveMs: 3
      }
    });

    await expect(reader("initial")).resolves.toEqual({
      announcement: "Main landmark",
      announcementCapture: "fallback",
      announcementCount: 1,
      observeReason: "fallback"
    });
  });

  it("keeps polling until spoken phrases go quiet and then returns the collected text", async () => {
    const reader = createAnnouncementReader({
      spokenPhraseLog: vi
        .fn<() => Promise<string[]>>()
        .mockResolvedValueOnce(["Welcome"])
        .mockResolvedValueOnce(["Main landmark"])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      clearSpokenPhraseLog: vi.fn(async () => undefined),
      lastSpokenPhrase: vi.fn(async () => "")
    }, {
      default: {
        pollIntervalMs: 1,
        silenceWindowMs: 1,
        maxObserveMs: 6
      }
    });

    await expect(reader()).resolves.toEqual({
      announcement: "Welcome\nMain landmark",
      announcementCapture: "log",
      announcementCount: 2,
      observeReason: "silence"
    });
  });

  it("rejects screenreader runtime creation when screenReaderBackend is missing", async () => {
    await expect(
      createScreenReaderRuntime(
        {
          bringToFront: vi.fn(async () => undefined)
        } as never
      )
    ).rejects.toThrow("screenreader mode requires an explicit screenReaderBackend");
  });

  it("creates a runtime that delegates configured screen reader actions to the backend session", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const stop = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    const perform = vi.fn(async () => undefined);
    const press = vi.fn(async () => undefined);
    const type = vi.fn(async () => undefined);
    const interact = vi.fn(async () => undefined);
    const stopInteracting = vi.fn(async () => undefined);
    const click = vi.fn(async () => undefined);
    const clearSpokenPhraseLog = vi.fn(async () => undefined);
    const spokenPhraseLog = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["Initial announcement"])
      .mockResolvedValueOnce([])
      .mockResolvedValue(["After next item"]);

    const session: ScreenReaderSession = createMockScreenReaderSession({
      start,
      stop,
      perform,
      press,
      type,
      interact,
      stopInteracting,
      click,
      lastSpokenPhrase: vi.fn(async () => "Fallback phrase"),
      spokenPhraseLog,
      clearSpokenPhraseLog
    });
    const backend: ScreenReaderBackend = {
      ...findScreenReaderBackendById("guidepup-virtual"),
      capabilities: TEST_CAPABILITIES,
      supports: vi.fn(() => true),
      createSession: vi.fn(async () => session)
    };

    const evaluate = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate
      } as never,
      {
        backend,
        observeProfiles: {
          initial: {
            pollIntervalMs: 1,
            silenceWindowMs: 1,
            maxObserveMs: 6
          },
          default: {
            pollIntervalMs: 1,
            silenceWindowMs: 1,
            maxObserveMs: 6
          }
        }
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.controller.execute({
      semantic: "heading.next"
    });
    const secondObservation = await runtime.observer.observe();
    await runtime.controller.execute({ semantic: "press", key: "ArrowDown" });
    await runtime.controller.execute({ semantic: "type", text: "hello" });
    await runtime.controller.execute({ semantic: "interact" });
    await runtime.controller.execute({ semantic: "stopInteracting" });
    await runtime.controller.execute({ semantic: "click", button: "right", clickCount: 2 });
    await runtime.close();

    expect(start).toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(firstObservation.kind).toBe("screenreader");
    expect(firstObservation.announcement).toContain("Initial announcement");
    expect(firstObservation.announcementCapture).toBe("log");
    expect(firstObservation.announcementCount).toBeGreaterThanOrEqual(1);
    expect(["silence", "timeout"]).toContain(firstObservation.observeReason);
    expect(secondObservation.kind).toBe("screenreader");
    expect(secondObservation.announcement).toContain("After next item");
    expect(secondObservation.announcementCapture).toBe("log");
    expect(secondObservation.announcementCount).toBeGreaterThanOrEqual(1);
    expect(secondObservation.observeReason).toBe("timeout");
    expect(runtime.setupTimings.screenReaderInitMs).toBeGreaterThanOrEqual(0);
    expect(runtime.setupTimings.firstAnnouncementWaitMs).toBeGreaterThanOrEqual(0);
    expect(backend.createSession).toHaveBeenCalled();
    expect(perform).toHaveBeenCalledWith({ source: "catalog", id: "commands.moveToNextHeading" }, undefined);
    expect(press).toHaveBeenCalledWith("ArrowDown", undefined);
    expect(type).toHaveBeenCalledWith("hello", undefined);
    expect(interact).toHaveBeenCalledWith(undefined);
    expect(stopInteracting).toHaveBeenCalledWith(undefined);
    expect(click).toHaveBeenCalledWith({ button: "right", clickCount: 2 });
    expect(stop).toHaveBeenCalled();
  });

  it("retries the initial observation once when the first capture is empty", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const evaluate = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-virtual"),
          capabilities: TEST_CAPABILITIES,
          supports: () => true,
          createSession: async () => createMockScreenReaderSession({
            lastSpokenPhrase: vi
              .fn<() => Promise<string>>()
              .mockResolvedValueOnce("")
              .mockResolvedValueOnce("Recovered initial announcement"),
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([]),
            clearSpokenPhraseLog: vi.fn(async () => undefined)
          })
        },
        observeProfiles: {
          initial: {
            pollIntervalMs: 1,
            silenceWindowMs: 1,
            maxObserveMs: 3
          }
        }
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.close();

    expect(firstObservation).toEqual({
      kind: "screenreader",
      announcement: "Recovered initial announcement",
      announcementCapture: "fallback",
      announcementCount: 1,
      observeReason: "fallback"
    });
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it("rejects explicitly configured backends that do not support the current platform", async () => {
    await expect(
      createScreenReaderRuntime(
        {
          bringToFront: vi.fn(async () => undefined)
        } as never,
        {
          backendId: "guidepup-nvda",
          platform: "darwin"
        }
      )
    ).rejects.toThrow('Screen reader backend "guidepup-nvda" is not supported on platform "darwin"');
  });

  it("implements the guidepup-virtual session through a page adapter", async () => {
    const { page, adapterState, addScriptTag } = createGuidepupVirtualTestPage({
      injectAfterEvaluateCalls: 1
    });
    const session = await findScreenReaderBackendById("guidepup-virtual").createSession(page as never);

    await session.start();
    await session.perform({ source: "catalog", id: "commands.moveToNextHeading" });
    await session.click({ button: "right", clickCount: 2 });
    expect(await session.lastSpokenPhrase()).toBe("click:right:2");
    expect(await session.spokenPhraseLog()).toEqual([
      "virtual-started",
      "perform:commands.moveToNextHeading",
      "click:right:2"
    ]);

    await session.clearSpokenPhraseLog();
    expect(await session.spokenPhraseLog()).toEqual([]);
    await session.stop();

    expect(addScriptTag).toHaveBeenCalledTimes(1);
    expect(adapterState.operations).toEqual([
      "start",
      "perform:commands.moveToNextHeading",
      "click:right:2",
      "lastSpokenPhrase",
      "spokenPhraseLog",
      "clearSpokenPhraseLog",
      "spokenPhraseLog",
      "stop"
    ]);
  });

  it("rejects actions that the backend does not support", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    await expect(async () =>
      createScreenReaderRuntime(
        {
          bringToFront: vi.fn(async () => undefined)
        } as never,
        {
          backend: {
            ...findScreenReaderBackendById("guidepup-virtual"),
            capabilities: {
              ...TEST_CAPABILITIES,
              invoke: {
                ...TEST_CAPABILITIES.invoke,
                click: false
              }
            },
            supports: () => true,
            createSession: async () => {
              throw new Error("should not be called");
            }
          },
          actionPlan: buildScreenReaderActionPlan(
            [
              createStableScreenReaderActionRef("heading.next"),
              createStableScreenReaderActionRef("click")
            ],
            "guidepup-virtual",
            {
              ...TEST_CAPABILITIES,
              invoke: {
                ...TEST_CAPABILITIES.invoke,
                click: false
              }
            }
          )
        }
      )
    ).rejects.toThrow('does not support action sr.click');
  });
});

function createGuidepupVirtualTestPage(options?: {
  injectAfterEvaluateCalls?: number;
}): {
  page: {
    addScriptTag: ReturnType<typeof vi.fn>;
    bringToFront: ReturnType<typeof vi.fn>;
    evaluate: ReturnType<typeof vi.fn>;
  };
  addScriptTag: ReturnType<typeof vi.fn>;
  adapterState: {
    operations: string[];
    phrases: string[];
    started: boolean;
    injected: boolean;
  };
} {
  class HTMLElementMock {
    private readonly attributes = new Map<string, string>();

    focus(): void {}

    hasAttribute(name: string): boolean {
      return this.attributes.has(name);
    }

    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }

    removeAttribute(name: string): void {
      this.attributes.delete(name);
    }
  }

  const body = new HTMLElementMock();
  const adapterState = {
    operations: [] as string[],
    phrases: [] as string[],
    started: false,
    injected: false
  };
  let remainingEvaluateCallsUntilInjection = options?.injectAfterEvaluateCalls ?? 0;
  const adapter = {
    async start(): Promise<void> {
      adapterState.operations.push("start");
      adapterState.started = true;
      adapterState.phrases.push("virtual-started");
    },
    async stop(): Promise<void> {
      adapterState.operations.push("stop");
      adapterState.started = false;
    },
    async next(): Promise<void> {
      adapterState.operations.push("next");
      adapterState.phrases.push("next");
    },
    async previous(): Promise<void> {
      adapterState.operations.push("previous");
      adapterState.phrases.push("previous");
    },
    async act(): Promise<void> {
      adapterState.operations.push("act");
      adapterState.phrases.push("act");
    },
    async interact(): Promise<void> {
      adapterState.operations.push("interact");
      adapterState.phrases.push("interact");
    },
    async stopInteracting(): Promise<void> {
      adapterState.operations.push("stopInteracting");
      adapterState.phrases.push("stopInteracting");
    },
    async perform(action: Extract<ExecutableScreenReaderAction, { kind: "invoke"; method: "perform" }>): Promise<void> {
      if (action.command.source !== "catalog") {
        throw new Error("test virtual adapter only supports catalog perform commands");
      }

      adapterState.operations.push(`perform:${action.command.id}`);
      adapterState.phrases.push(`perform:${action.command.id}`);
    },
    async press(input: { key: string }): Promise<void> {
      adapterState.operations.push(`press:${input.key}`);
      adapterState.phrases.push(`press:${input.key}`);
    },
    async type(input: { text: string }): Promise<void> {
      adapterState.operations.push(`type:${input.text}`);
      adapterState.phrases.push(`type:${input.text}`);
    },
    async click(options?: { button?: "left" | "right"; clickCount?: 1 | 2 | 3 }): Promise<void> {
      const button = options?.button ?? "left";
      const clickCount = options?.clickCount ?? 1;
      adapterState.operations.push(`click:${button}:${clickCount}`);
      adapterState.phrases.push(`click:${button}:${clickCount}`);
    },
    async itemText(): Promise<string> {
      adapterState.operations.push("itemText");
      return adapterState.phrases.at(-1) ?? "";
    },
    async lastSpokenPhrase(): Promise<string> {
      adapterState.operations.push("lastSpokenPhrase");
      return adapterState.phrases.at(-1) ?? "";
    },
    async itemTextLog(): Promise<string[]> {
      adapterState.operations.push("itemTextLog");
      return [...adapterState.phrases];
    },
    async spokenPhraseLog(): Promise<string[]> {
      adapterState.operations.push("spokenPhraseLog");
      return [...adapterState.phrases];
    },
    async clearItemTextLog(): Promise<void> {
      adapterState.operations.push("clearItemTextLog");
      adapterState.phrases = [];
    },
    async clearSpokenPhraseLog(): Promise<void> {
      adapterState.operations.push("clearSpokenPhraseLog");
      adapterState.phrases = [];
    }
  };
  const documentMock = {
    body,
    documentElement: body,
    querySelector(selector: string): HTMLElementMock | null {
      return selector === "[data-a11y-bootstrap-tabindex='true']" && body.hasAttribute("data-a11y-bootstrap-tabindex")
        ? body
        : null;
    }
  };
  const addScriptTag = vi.fn(async () => {
    adapterState.injected = true;
  });
  const evaluate = vi.fn(async (fn: (arg: unknown) => unknown, arg?: unknown) => {
    const globals = globalThis as Record<string, unknown>;
    const previousDocument = globals.document;
    const previousHTMLElement = globals.HTMLElement;
    const previousAdapter = globals.__rawstepGuidepupVirtualAdapter;

    globals.document = documentMock;
    globals.HTMLElement = HTMLElementMock;
    if (adapterState.injected && remainingEvaluateCallsUntilInjection > 0) {
      remainingEvaluateCallsUntilInjection -= 1;
      delete globals.__rawstepGuidepupVirtualAdapter;
    } else if (adapterState.injected) {
      globals.__rawstepGuidepupVirtualAdapter = adapter;
    } else {
      delete globals.__rawstepGuidepupVirtualAdapter;
    }

    try {
      return await fn(arg);
    } finally {
      if (previousDocument === undefined) {
        delete globals.document;
      } else {
        globals.document = previousDocument;
      }

      if (previousHTMLElement === undefined) {
        delete globals.HTMLElement;
      } else {
        globals.HTMLElement = previousHTMLElement;
      }

      if (previousAdapter === undefined) {
        delete globals.__rawstepGuidepupVirtualAdapter;
      } else {
        globals.__rawstepGuidepupVirtualAdapter = previousAdapter;
      }
    }
  });

  return {
    page: {
      addScriptTag,
      bringToFront: vi.fn(async () => undefined),
      evaluate
    },
    addScriptTag,
    adapterState
  };
}
