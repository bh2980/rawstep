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
        .mockResolvedValueOnce([]),
      clearSpokenPhraseLog: vi.fn(async () => undefined),
      lastSpokenPhrase: vi.fn(async () => "Welcome")
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
      spokenPhraseLog: vi.fn(async () => []),
      clearSpokenPhraseLog: vi.fn(async () => undefined),
      lastSpokenPhrase: vi.fn(async () => "Main landmark")
    });

    await expect(reader()).resolves.toEqual({
      announcement: "Main landmark",
      announcementCapture: "fallback"
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
      .mockResolvedValueOnce(["After next item"]);

    const evaluate = vi.fn(async () => undefined);
    const runtime = await createVoiceOverRuntime(
      {
        bringToFront: vi.fn(async () => undefined),
        evaluate
      } as never,
      {
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
});
