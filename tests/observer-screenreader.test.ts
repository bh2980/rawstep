import {
  createAnnouncementReader,
  createVoiceOverRuntime
} from "../packages/observer-screenreader/src";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_PLATFORM = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", {
    value: ORIGINAL_PLATFORM,
    configurable: true
  });
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
        maxObserveMs: 3
      }
    });

    await expect(reader()).resolves.toEqual({
      announcement: "Heading\nGet started button",
      announcementCapture: "log"
    });
    await expect(reader()).resolves.toEqual({
      announcement: "",
      announcementCapture: "none"
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
      announcementCapture: "fallback"
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
      announcementCapture: "log"
    });
  });

  it("rejects screenreader runtime creation on non-macOS platforms", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true
    });

    await expect(
      createVoiceOverRuntime(
        {
          bringToFront: vi.fn(async () => undefined)
        } as never
      )
    ).rejects.toThrow("supports only macOS VoiceOver");
  });

  it("creates a runtime that maps canonical commands to Guidepup keyboard commands", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const next = vi.fn(async () => undefined);
    const previous = vi.fn(async () => undefined);
    const act = vi.fn(async () => undefined);
    const perform = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    const clearSpokenPhraseLog = vi.fn(async () => undefined);
    const spokenPhraseLog = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(["Initial announcement"])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["After next item"])
      .mockResolvedValueOnce([]);

    const evaluate = vi.fn(async () => undefined);
    const runtime = await createVoiceOverRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate
      } as never,
      {
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
        },
        importGuidepup: async () => ({
          voiceOver: {
            start,
            stop,
            next,
            previous,
            act,
            perform,
            lastSpokenPhrase: vi.fn(async () => "Fallback phrase"),
            spokenPhraseLog,
            clearSpokenPhraseLog,
            keyboardCommands: {
              findNextHeading: "findNextHeading",
              findPreviousHeading: "findPreviousHeading",
              findNextControl: "findNextControl",
              findPreviousControl: "findPreviousControl"
            }
          }
        })
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
    expect(firstObservation).toEqual({
      kind: "screenreader",
      announcement: "Initial announcement",
      announcementCapture: "log"
    });
    expect(secondObservation).toEqual({
      kind: "screenreader",
      announcement: "After next item",
      announcementCapture: "log",
      previousAnnouncement: "Initial announcement"
    });
    expect(runtime.setupTimings.voiceOverInitMs).toBeGreaterThanOrEqual(0);
    expect(runtime.setupTimings.firstAnnouncementWaitMs).toBeGreaterThanOrEqual(0);
    expect(next).toHaveBeenCalled();
    expect(previous).toHaveBeenCalled();
    expect(perform).toHaveBeenCalledWith("findNextHeading");
    expect(perform).toHaveBeenCalledWith("findPreviousHeading");
    expect(perform).toHaveBeenCalledWith("findNextControl");
    expect(perform).toHaveBeenCalledWith("findPreviousControl");
    expect(act).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("retries the initial observation once when the first capture is empty", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true
    });

    const evaluate = vi.fn(async () => undefined);
    const runtime = await createVoiceOverRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate
      } as never,
      {
        observeProfiles: {
          initial: {
            pollIntervalMs: 1,
            silenceWindowMs: 1,
            maxObserveMs: 3
          }
        },
        importGuidepup: async () => ({
          voiceOver: {
            start: vi.fn(async () => undefined),
            stop: vi.fn(async () => undefined),
            next: vi.fn(async () => undefined),
            previous: vi.fn(async () => undefined),
            act: vi.fn(async () => undefined),
            perform: vi.fn(async () => undefined),
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
            clearSpokenPhraseLog: vi.fn(async () => undefined),
            keyboardCommands: {
              findNextHeading: "findNextHeading",
              findPreviousHeading: "findPreviousHeading",
              findNextControl: "findNextControl",
              findPreviousControl: "findPreviousControl"
            }
          }
        })
      }
    );

    const firstObservation = await runtime.observer.observe();
    await runtime.close();

    expect(firstObservation).toEqual({
      kind: "screenreader",
      announcement: "Recovered initial announcement",
      announcementCapture: "fallback"
    });
    expect(evaluate).toHaveBeenCalledTimes(4);
  });
});
