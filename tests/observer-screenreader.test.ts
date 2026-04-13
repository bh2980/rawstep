import {
  createAnnouncementReader,
  createScreenReaderRuntime,
  findScreenReaderBackendById,
  type ScreenReaderBackend,
  type ScreenReaderSession
} from "../packages/observer-screenreader/src";
import { SCREENREADER_COMMANDS } from "../packages/core/src";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_DOCUMENT = (globalThis as { document?: unknown }).document;
const ORIGINAL_HTML_ELEMENT = (globalThis as { HTMLElement?: unknown }).HTMLElement;

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

describe("observer-screenreader", () => {
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

  it("creates a runtime that delegates canonical commands to the configured backend session", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const stop = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    const execute = vi.fn(async () => undefined);
    const clearSpokenPhraseLog = vi.fn(async () => undefined);
    const spokenPhraseLog = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["Initial announcement"])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["After next item"])
      .mockResolvedValueOnce([]);

    const session: ScreenReaderSession = {
      start,
      stop,
      execute,
      lastSpokenPhrase: vi.fn(async () => "Fallback phrase"),
      spokenPhraseLog,
      clearSpokenPhraseLog
    };
    const backend: ScreenReaderBackend = {
      id: "guidepup-virtual",
      supportedCommands: SCREENREADER_COMMANDS,
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
    await runtime.controller.execute("nextItem");
    const secondObservation = await runtime.observer.observe();
    await runtime.controller.execute("previousItem");
    await runtime.controller.execute("nextHeading");
    await runtime.controller.execute("previousHeading");
    await runtime.controller.execute("nextFormControl");
    await runtime.controller.execute("previousFormControl");
    await runtime.controller.execute("act");
    await runtime.close();

    expect(start).toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(firstObservation.kind).toBe("screenreader");
    expect(firstObservation.announcement).toContain("Initial announcement");
    expect(firstObservation.announcementCapture).toBe("log");
    expect(firstObservation.announcementCount).toBeGreaterThanOrEqual(1);
    expect(firstObservation.observeReason).toBe("silence");
    expect(secondObservation.kind).toBe("screenreader");
    expect(secondObservation.announcement).toContain("After next item");
    expect(secondObservation.announcementCapture).toBe("log");
    expect(secondObservation.announcementCount).toBeGreaterThanOrEqual(1);
    expect(secondObservation.observeReason).toBe("silence");
    expect(runtime.setupTimings.screenReaderInitMs).toBeGreaterThanOrEqual(0);
    expect(runtime.setupTimings.firstAnnouncementWaitMs).toBeGreaterThanOrEqual(0);
    expect(backend.createSession).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith("nextItem");
    expect(execute).toHaveBeenCalledWith("previousItem");
    expect(execute).toHaveBeenCalledWith("nextHeading");
    expect(execute).toHaveBeenCalledWith("previousHeading");
    expect(execute).toHaveBeenCalledWith("nextFormControl");
    expect(execute).toHaveBeenCalledWith("previousFormControl");
    expect(execute).toHaveBeenCalledWith("act");
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
          id: "guidepup-virtual",
          supportedCommands: SCREENREADER_COMMANDS,
          supports: () => true,
          createSession: async () => ({
            start: vi.fn(async () => undefined),
            stop: vi.fn(async () => undefined),
            execute: vi.fn(async () => undefined),
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
    const { page, adapterState, addScriptTag } = createGuidepupVirtualTestPage();
    const session = await findScreenReaderBackendById("guidepup-virtual").createSession(page as never);

    await session.start();
    await session.execute("nextItem");
    await session.execute("nextHeading");
    expect(await session.lastSpokenPhrase()).toBe("command:nextHeading");
    expect(await session.spokenPhraseLog()).toEqual([
      "virtual-started",
      "command:nextItem",
      "command:nextHeading"
    ]);

    await session.clearSpokenPhraseLog();
    expect(await session.spokenPhraseLog()).toEqual([]);
    await session.stop();

    expect(addScriptTag).toHaveBeenCalledTimes(1);
    expect(adapterState.operations).toEqual([
      "start",
      "execute:nextItem",
      "execute:nextHeading",
      "lastSpokenPhrase",
      "spokenPhraseLog",
      "clearSpokenPhraseLog",
      "spokenPhraseLog",
      "stop"
    ]);
  });

  it("rejects commands that the backend does not support", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    await expect(
      createScreenReaderRuntime(
        {
          bringToFront: vi.fn(async () => undefined)
        } as never,
        {
          backend: {
            id: "guidepup-virtual",
            supportedCommands: ["nextItem"],
            supports: () => true,
            createSession: async () => {
              throw new Error("should not be called");
            }
          },
          allowedCommands: ["nextItem", "act"]
        }
      )
    ).rejects.toThrow('does not support commands: act');
  });
});

function createGuidepupVirtualTestPage(): {
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
    async execute(command: string): Promise<void> {
      adapterState.operations.push(`execute:${command}`);
      if (!adapterState.started) {
        adapterState.started = true;
      }
      adapterState.phrases.push(`command:${command}`);
    },
    async lastSpokenPhrase(): Promise<string> {
      adapterState.operations.push("lastSpokenPhrase");
      return adapterState.phrases.at(-1) ?? "";
    },
    async spokenPhraseLog(): Promise<string[]> {
      adapterState.operations.push("spokenPhraseLog");
      return [...adapterState.phrases];
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
    if (adapterState.injected) {
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
