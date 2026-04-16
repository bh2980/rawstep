import {
  buildScreenReaderActionPlan,
  createStableScreenReaderActionRef
} from "@rawstep/action-catalog";
import type { ExecutableScreenReaderAction } from "@rawstep/action-catalog";
import {
  createEmptyScreenReaderCapabilities,
  createAnnouncementReader,
  createScreenReaderRuntime,
  findScreenReaderBackendById,
  listScreenReaderBackends,
  resolveScreenReaderCapabilities,
  ScreenReaderInitializationError,
  type ScreenReaderBackend,
  type ScreenReaderSession
} from "@rawstep/runtime";
import {
  SCREEN_READER_BACKEND_IDS,
  type ScreenReaderAction,
  type ScreenReaderCapabilities
} from "@rawstep/definition";
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
    takeCursorScreenshot: vi.fn(async () => "/tmp/voiceover-cursor.png"),
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
      pollIntervalMs: 1,
      silenceWindowMs: 1,
      maxObserveMs: 4
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

  it("uses the last spoken phrase when the log is empty", async () => {
    const reader = createAnnouncementReader({
      spokenPhraseLog: vi
        .fn<() => Promise<string[]>>()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      clearSpokenPhraseLog: vi.fn(async () => undefined),
      lastSpokenPhrase: vi.fn(async () => "Main landmark")
    }, {
      pollIntervalMs: 1,
      silenceWindowMs: 1,
      maxObserveMs: 3,
      allowFallback: true
    });

    await expect(reader()).resolves.toEqual({
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
      pollIntervalMs: 1,
      silenceWindowMs: 1,
      // Leave enough room for the quiet-period check to win over the wall-clock limit.
      maxObserveMs: 20
    });

    await expect(reader()).resolves.toEqual({
      announcement: "Welcome\nMain landmark",
      announcementCapture: "log",
      announcementCount: 2,
      observeReason: "silence"
    });
  });

  it("keeps listening for a field follow-up after a validation alert when requested", async () => {
    const reader = createAnnouncementReader({
      spokenPhraseLog: vi
        .fn<() => Promise<string[]>>()
        .mockResolvedValueOnce(["Enter a valid email address like name@example.com."])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          "traveler@example.comtraveler@example.com inserted at end of text. Email required invalid email data"
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      clearSpokenPhraseLog: vi.fn(async () => undefined),
      lastSpokenPhrase: vi.fn(async () => "")
    }, {
      pollIntervalMs: 1,
      silenceWindowMs: 1,
      maxObserveMs: 3
    });

    await expect(reader({ followUpAfterAlert: true })).resolves.toEqual({
      announcement: [
        "Enter a valid email address like name@example.com.",
        "traveler@example.comtraveler@example.com inserted at end of text. Email required invalid email data"
      ].join("\n"),
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
      .mockResolvedValueOnce(["Initial announcement web content"])
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
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 6
        }
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.controller.execute({
      semantic: "heading.next"
    });
    const secondObservation = await runtime.observer.observe();
    await runtime.controller.execute({ semantic: "press", key: "ArrowDown" });
    await runtime.controller.execute({ semantic: "key.mod.a" });
    await runtime.controller.execute({ semantic: "type", text: "hello" });
    await runtime.controller.execute({ semantic: "interact" });
    await runtime.controller.execute({ semantic: "stopInteracting" });
    await runtime.controller.execute({ semantic: "click", button: "right", clickCount: 2 });
    await runtime.close();

    expect(start).toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(firstObservation.kind).toBe("screenreader");
    expect(firstObservation.announcement).toContain("Initial announcement web content");
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
    expect(press).toHaveBeenCalledWith("Meta+A", undefined);
    expect(type).toHaveBeenCalledWith("hello", undefined);
    expect(interact).toHaveBeenCalledWith(undefined);
    expect(stopInteracting).toHaveBeenCalledWith(undefined);
    expect(click).toHaveBeenCalledWith({ button: "right", clickCount: 2 });
    expect(stop).toHaveBeenCalled();
  });

  it("uses backend-native startup positioning during startup when the backend supports it", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const press = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            perform,
            press,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Email Login Fixture web content"])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    await runtime.close();

    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
    expect(press).not.toHaveBeenCalledWith("Escape", { capture: "initial" });
  });

  it("fails startup when non-page speech never resolves to web content", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    let error: unknown;
    try {
      await createScreenReaderRuntime(
        {
          bringToFront: vi.fn(async () => undefined),
          evaluate: vi.fn(async () => undefined)
        } as never,
        {
          backend: {
            ...findScreenReaderBackendById("guidepup-voiceover"),
            createSession: async () => createMockScreenReaderSession({
              spokenPhraseLog: vi
                .fn<() => Promise<string[]>>()
                .mockResolvedValueOnce(["Welcome to macOS. VoiceOver is on."])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(["VoiceOver remains on."])
                .mockResolvedValueOnce([])
                .mockResolvedValue([])
            })
          },
          observe: {
            pollIntervalMs: 1,
            silenceWindowMs: 1,
            maxObserveMs: 3
          }
        }
      );
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(ScreenReaderInitializationError);
    expect((error as ScreenReaderInitializationError).message).toContain(
      "did not provide enough evidence of web content"
    );
    expect((error as ScreenReaderInitializationError).diagnostics).toContainEqual(expect.objectContaining({
      code: "SCREENREADER_INIT_UNKNOWN_ANNOUNCEMENT"
    }));
  });

  it("retries an unknown first announcement and succeeds when web content appears", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Email"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Email Login Fixture web content. Email required email."])
              .mockResolvedValueOnce([])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.close();

    expect(firstObservation.announcement).toContain("Email Login Fixture web content");
  });

  it("accepts a mixed startup announcement after an unknown first announcement without another sync command", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => ({
          title: "Email Login Fixture",
          heading: "Email Login Fixture"
        }))
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            perform,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["No landmarks found"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Outside Email Login Fixture - Chrome for Testing group", "web content"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.close();

    expect(firstObservation.announcement).toContain("Chrome for Testing");
    expect(firstObservation.announcement).toContain("web content");
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("recovers when a mixed startup announcement downgrades to pure browser UI", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => ({
          title: "Email Login Fixture",
          heading: "Email Login Fixture"
        }))
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            perform,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Outside Email Login Fixture - Chrome for Testing group", "web content"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["New tab button. You are on a button in the current group."])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Email Login Fixture web content. Email required email."])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.close();

    expect(firstObservation.announcement).toContain("Email Login Fixture web content");
    expect(perform).toHaveBeenNthCalledWith(
      1,
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenNthCalledWith(
      2,
      { source: "catalog", id: "keyboard.stopAction" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenNthCalledWith(
      3,
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
  });

  it("stabilizes repeated unknown startup speech before accepting web content", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => ({
          title: "Email Login Fixture",
          heading: "Email Login Fixture"
        }))
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            perform,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Email"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["No landmarks found"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Email Login Fixture web content. Email required email."])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.close();

    expect(firstObservation.announcement).toContain("Email Login Fixture web content");
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("records mixed and stabilized diagnostics when a mixed startup announcement still ends in browser UI failure", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    let error: unknown;
    try {
      await createScreenReaderRuntime(
        {
          bringToFront: vi.fn(async () => undefined),
          evaluate: vi.fn(async () => ({
            title: "Email Login Fixture",
            heading: "Email Login Fixture"
          }))
        } as never,
        {
          backend: {
            ...findScreenReaderBackendById("guidepup-voiceover"),
            createSession: async () => createMockScreenReaderSession({
              spokenPhraseLog: vi
                .fn<() => Promise<string[]>>()
                .mockResolvedValueOnce(["Outside Email Login Fixture - Chrome for Testing group", "web content"])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(["New tab button. You are on a button in the current group."])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(["Minimize button. You are on the current button."])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
            })
          },
          observe: {
            pollIntervalMs: 1,
            silenceWindowMs: 1,
            maxObserveMs: 3
          }
        }
      );
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(ScreenReaderInitializationError);
    expect((error as ScreenReaderInitializationError).diagnostics).toContainEqual(expect.objectContaining({
      code: "SCREENREADER_INIT_MIXED_ANNOUNCEMENT"
    }));
    expect((error as ScreenReaderInitializationError).diagnostics).toContainEqual(expect.objectContaining({
      code: "SCREENREADER_INIT_STABILIZED_AFTER_RETRY"
    }));
  });

  it("recovers from an empty first announcement by retrying screen reader focus sync", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            perform,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Email required email. You are on a text field in web content."])
              .mockResolvedValueOnce([])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.close();

    expect(firstObservation.announcement).toContain("Email required email");
    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
  });

  it("recovers from browser UI focus during startup with Escape and a sync retry", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const { page, body } = createDomBackedScreenReaderPage({
      title: "Email Login Fixture",
      heading: "Email Login Fixture"
    });
    const perform = vi.fn(async () => undefined);
    const press = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      page as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            perform,
            press,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["New tab button. You are on a button in the current group."])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Email Login Fixture web content. Email required email."])
              .mockResolvedValueOnce([])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 6
        }
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.close();

    expect(firstObservation.announcement).toContain("Email Login Fixture web content");
    expect(press).not.toHaveBeenCalledWith("Escape", { capture: "initial" });
    expect(perform).toHaveBeenNthCalledWith(
      1,
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenNthCalledWith(
      2,
      { source: "catalog", id: "keyboard.stopAction" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenNthCalledWith(
      3,
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
    expect(page.bringToFront).toHaveBeenCalledTimes(3);
    expect(body.hasAttribute("tabindex")).toBe(false);
  });

  it("fails startup when browser UI focus persists after recovery", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const { page, body } = createDomBackedScreenReaderPage({
      title: "Email Login Fixture",
      heading: "Email Login Fixture"
    });
    const perform = vi.fn(async () => undefined);
    const press = vi.fn(async () => undefined);

    await expect(createScreenReaderRuntime(
      page as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            perform,
            press,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["New tab button. You are on a button in the current group."])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Minimize button. You are on the current button."])
              .mockResolvedValueOnce([])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 6
        }
      }
    )).rejects.toThrow("Screen reader initialization failed because focus remained in browser UI instead of web content.");

    expect(press).not.toHaveBeenCalledWith("Escape", { capture: "initial" });
    expect(perform).toHaveBeenNthCalledWith(
      1,
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenNthCalledWith(
      2,
      { source: "catalog", id: "keyboard.stopAction" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenNthCalledWith(
      3,
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
    expect(body.hasAttribute("tabindex")).toBe(false);
  });

  it("does not mutate page-root tabindex during successful initialization", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const { page, body } = createDomBackedScreenReaderPage({
      title: "Email Login Fixture",
      heading: "Email Login Fixture"
    });
    const runtime = await createScreenReaderRuntime(
      page as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Email Login Fixture web content"])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    await runtime.close();

    expect(body.hasAttribute("tabindex")).toBe(false);
  });

  it("recovers an unexpected browser-ui observation during runtime before returning it to the agent path", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            perform,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Email Login Fixture web content"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Email Login Fixture web content. Email required email."])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const recovery = await runtime.recoverFromUnexpectedBrowserUi({
      observation: {
        kind: "screenreader",
        announcement: "New tab button. You are on a button in the current group.",
        announcementCapture: "log"
      },
      domFocus: {
        hasDocumentFocus: false
      }
    });
    await runtime.close();

    expect(recovery.recovered).toBe(true);
    expect(recovery.observation.announcement).toContain("Email Login Fixture web content");
    expect(recovery.feedbackNote).toContain("automatic recovery");
    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.stopAction" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
  });

  it("returns the original observation without recovery work when the announcement is already in web content", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            perform,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Email Login Fixture web content"])
              .mockResolvedValueOnce([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const observation = {
      kind: "screenreader" as const,
      announcement: "Email Login Fixture web content",
      announcementCapture: "log" as const
    };
    perform.mockClear();
    const recovery = await runtime.recoverFromUnexpectedBrowserUi({
      observation,
      domFocus: {
        hasDocumentFocus: true
      }
    });
    await runtime.close();

    expect(recovery.recovered).toBe(false);
    expect(recovery.observation).toEqual(observation);
    expect(recovery.feedbackNote).toBe("");
    expect(recovery.diagnostics).toEqual([]);
    expect(perform).not.toHaveBeenCalled();
  });

  it("uses focus-based realignment first when document focus is still in the page", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const voiceOverBackend = findScreenReaderBackendById("guidepup-voiceover");
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...voiceOverBackend,
          capabilities: {
            ...voiceOverBackend.capabilities,
            performCatalog: [
              ...voiceOverBackend.capabilities.performCatalog,
              {
                id: "keyboard.moveCursorToKeyboardFocus",
                label: "moveCursorToKeyboardFocus",
                description: "Move the screen reader cursor to the keyboard focus."
              }
            ]
          },
          createSession: async () => createMockScreenReaderSession({
            perform,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Email Login Fixture web content"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Email Login Fixture web content. Email required email."])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const recovery = await runtime.recoverFromUnexpectedBrowserUi({
      observation: {
        kind: "screenreader",
        announcement: "New tab button. You are on a button in the current group.",
        announcementCapture: "log"
      },
      domFocus: {
        hasDocumentFocus: true
      }
    });
    await runtime.close();

    expect(recovery.recovered).toBe(true);
    expect(recovery.observation.announcement).toContain("Email Login Fixture web content");
    expect(recovery.feedbackNote).toContain("automatic recovery");
    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.moveCursorToKeyboardFocus" },
      { capture: "initial" }
    );
    expect(perform).not.toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.stopAction" },
      { capture: "initial" }
    );
    expect(recovery.diagnostics.some((event) => event.message.includes("focus-based screen reader realignment"))).toBe(true);
  });

  it("falls back to browser-ui escape and document re-entry when focus-based recovery does not return web content", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const voiceOverBackend = findScreenReaderBackendById("guidepup-voiceover");
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...voiceOverBackend,
          capabilities: {
            ...voiceOverBackend.capabilities,
            performCatalog: [
              ...voiceOverBackend.capabilities.performCatalog,
              {
                id: "keyboard.moveCursorToKeyboardFocus",
                label: "moveCursorToKeyboardFocus",
                description: "Move the screen reader cursor to the keyboard focus."
              }
            ]
          },
          createSession: async () => createMockScreenReaderSession({
            perform,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Email Login Fixture web content"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["New tab button. You are on a button in the current group."])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Email Login Fixture web content. Email required email."])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const recovery = await runtime.recoverFromUnexpectedBrowserUi({
      observation: {
        kind: "screenreader",
        announcement: "New tab button. You are on a button in the current group.",
        announcementCapture: "log"
      },
      domFocus: {
        hasDocumentFocus: true
      }
    });
    await runtime.close();

    expect(recovery.recovered).toBe(true);
    expect(recovery.observation.announcement).toContain("Email Login Fixture web content");
    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.moveCursorToKeyboardFocus" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.stopAction" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
    expect(recovery.diagnostics.some((event) => event.message.includes("browser-ui escape and document re-entry"))).toBe(true);
  });

  it("keeps the original observation when both focus-based and fallback runtime recovery paths fail", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const voiceOverBackend = findScreenReaderBackendById("guidepup-voiceover");
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...voiceOverBackend,
          capabilities: {
            ...voiceOverBackend.capabilities,
            performCatalog: [
              ...voiceOverBackend.capabilities.performCatalog,
              {
                id: "keyboard.moveCursorToKeyboardFocus",
                label: "moveCursorToKeyboardFocus",
                description: "Move the screen reader cursor to the keyboard focus."
              }
            ]
          },
          createSession: async () => createMockScreenReaderSession({
            perform,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Email Login Fixture web content"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["New tab button. You are on a button in the current group."])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["Minimize button. You are on the current button."])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const recovery = await runtime.recoverFromUnexpectedBrowserUi({
      observation: {
        kind: "screenreader",
        announcement: "New tab button. You are on a button in the current group.",
        announcementCapture: "log"
      },
      domFocus: {
        hasDocumentFocus: true
      }
    });
    await runtime.close();

    expect(recovery.recovered).toBe(false);
    expect(recovery.observation.announcement).toContain("New tab button");
    expect(recovery.feedbackNote).toContain("automatic recovery failed");
    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.moveCursorToKeyboardFocus" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.stopAction" },
      { capture: "initial" }
    );
    expect(perform).toHaveBeenCalledWith(
      { source: "catalog", id: "keyboard.moveToNextAutoWebSpot" },
      { capture: "initial" }
    );
    expect(recovery.diagnostics.some((event) => event.code === "SCREENREADER_RUNTIME_RECOVERY_FAILED")).toBe(true);
  });

  it("keeps the original runtime observation when browser-ui recovery fails", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const perform = vi.fn(async () => undefined);
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            perform,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Email Login Fixture web content"])
              .mockResolvedValueOnce(["Email Login Fixture web content"])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce(["New tab button. You are on a button in the current group."])
              .mockResolvedValueOnce(["Minimize button. You are on the current button."])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    const recovery = await runtime.recoverFromUnexpectedBrowserUi({
      observation: {
        kind: "screenreader",
        announcement: "New tab button. You are on a button in the current group.",
        announcementCapture: "log"
      },
      domFocus: {
        hasDocumentFocus: false
      }
    });
    await runtime.close();

    expect(recovery.recovered).toBe(false);
    expect(recovery.observation.announcement).toContain("New tab button");
    expect(recovery.feedbackNote).toContain("automatic recovery failed");
    expect(recovery.diagnostics.some((event) => event.code === "SCREENREADER_RUNTIME_RECOVERY_FAILED")).toBe(true);
  });

  it("captures VoiceOver cursor screenshots only when the voiceOver option is enabled", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const takeCursorScreenshot = vi.fn(async () => "/tmp/voiceover-cursor.png");
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            takeCursorScreenshot,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Initial announcement web content"])
              .mockResolvedValue([])
          })
        },
        voiceOver: {
          cursorScreenshot: true
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    await expect(runtime.captureCursorScreenshot()).resolves.toEqual({
      status: "captured",
      sourcePath: "/tmp/voiceover-cursor.png"
    });
    expect(takeCursorScreenshot).toHaveBeenCalledTimes(1);

    await runtime.close();
  });

  it("returns disabled when VoiceOver cursor screenshots are not enabled", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const takeCursorScreenshot = vi.fn(async () => "/tmp/voiceover-cursor.png");
    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            takeCursorScreenshot,
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Initial announcement web content"])
              .mockResolvedValue([])
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    await expect(runtime.captureCursorScreenshot()).resolves.toEqual({
      status: "disabled"
    });
    expect(takeCursorScreenshot).not.toHaveBeenCalled();

    await runtime.close();
  });

  it("returns failed with diagnostics when VoiceOver cursor capture throws", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend: {
          ...findScreenReaderBackendById("guidepup-voiceover"),
          createSession: async () => createMockScreenReaderSession({
            takeCursorScreenshot: vi.fn(async () => {
              throw new Error("capture blew up");
            }),
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce(["Initial announcement web content"])
              .mockResolvedValue([])
          })
        },
        voiceOver: {
          cursorScreenshot: true
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    await expect(runtime.captureCursorScreenshot()).resolves.toEqual({
      status: "failed",
      diagnostic: {
        scope: "cursorScreenshot",
        level: "error",
        code: "CURSOR_SCREENSHOT_CAPTURE_FAILED",
        message: "Failed to capture the VoiceOver cursor screenshot.",
        error: "capture blew up",
        stack: expect.any(String)
      }
    });

    await runtime.close();
  });

  it("lets internal screen reader text entry bypass the public action plan", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const type = vi.fn(async () => undefined);
    const session: ScreenReaderSession = createMockScreenReaderSession({
      type,
      spokenPhraseLog: vi
        .fn<() => Promise<string[]>>()
        .mockResolvedValueOnce(["Initial announcement web content"])
        .mockResolvedValue([])
    });
    const backend: ScreenReaderBackend = {
      ...findScreenReaderBackendById("guidepup-virtual"),
      capabilities: TEST_CAPABILITIES,
      createSession: vi.fn(async () => session)
    };

    const runtime = await createScreenReaderRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined)
      } as never,
      {
        backend,
        actionPlan: buildScreenReaderActionPlan(
          [createStableScreenReaderActionRef("heading.next")],
          backend.id,
          backend.capabilities
        ),
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3
        }
      }
    );

    await expect(runtime.controller.execute({
      semantic: "type",
      text: "hello"
    })).rejects.toThrow(
      "Screen reader action is not allowed by the configured allowedScreenReaderActions: sr.type(hello)."
    );

    const executeInternal = runtime.controller.executeInternal;
    expect(executeInternal).toBeTypeOf("function");

    await expect(executeInternal!({
      semantic: "type",
      text: "hello"
    })).resolves.toEqual({
      ok: true,
      costDelta: 1
    });

    expect(type).toHaveBeenCalledWith("hello", undefined);
    await runtime.close();
  });

  it("uses the fallback phrase for the first observation when the log is empty", async () => {
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
          createSession: async () => createMockScreenReaderSession({
            lastSpokenPhrase: vi
              .fn<() => Promise<string>>()
              .mockResolvedValueOnce("Recovered initial announcement web content"),
            spokenPhraseLog: vi
              .fn<() => Promise<string[]>>()
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([])
              .mockResolvedValueOnce([]),
              clearSpokenPhraseLog: vi.fn(async () => undefined)
          })
        },
        observe: {
          pollIntervalMs: 1,
          silenceWindowMs: 1,
          maxObserveMs: 3,
          allowFallback: true
        }
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.close();

    expect(firstObservation).toEqual({
      kind: "screenreader",
      announcement: "Recovered initial announcement web content",
      announcementCapture: "fallback",
      announcementCount: 1,
      observeReason: "fallback"
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
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

function createDomBackedScreenReaderPage(options?: {
  title?: string;
  heading?: string;
}): {
  page: {
    bringToFront: ReturnType<typeof vi.fn>;
    evaluate: ReturnType<typeof vi.fn>;
  };
  body: {
    hasAttribute(name: string): boolean;
  };
} {
  class HTMLElementMock {
    private readonly attributes = new Map<string, string>();
    readonly textContent: string;

    constructor(textContent = "") {
      this.textContent = textContent;
    }

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
  const heading = new HTMLElementMock(options?.heading ?? "");
  const focusWindow = vi.fn(() => undefined);
  const documentMock = {
    title: options?.title ?? "",
    body,
    documentElement: body,
    querySelector(selector: string): HTMLElementMock | null {
      if (selector === "h1, h2, h3, h4, h5, h6") {
        return heading.textContent ? heading : null;
      }

      return null;
    }
  };

  const evaluate = vi.fn(async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
    const globals = globalThis as Record<string, unknown>;
    const previousDocument = globals.document;
    const previousHTMLElement = globals.HTMLElement;
    const previousFocus = globals.focus;

    globals.document = documentMock;
    globals.HTMLElement = HTMLElementMock;
    globals.focus = focusWindow;

    try {
      const isolated = (0, eval)(`(${fn.toString()})`) as (input?: unknown) => unknown;
      return await isolated(arg);
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

      if (previousFocus === undefined) {
        delete globals.focus;
      } else {
        globals.focus = previousFocus;
      }
    }
  });

  return {
    page: {
      bringToFront: vi.fn(async () => undefined),
      evaluate
    },
    body
  };
}
