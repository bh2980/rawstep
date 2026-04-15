import {
  type AnnouncementReader,
  type ScreenReaderSession,
  type ScreenReaderObserveProfile,
} from "./types";
import {
  DEFAULT_SCREEN_READER_OBSERVE_PROFILE
} from "./registry";
import type { ScreenReaderObserveConfig } from "@rawstep/definition";

export function createAnnouncementReader(
  session: Pick<ScreenReaderSession, "lastSpokenPhrase" | "spokenPhraseLog" | "clearSpokenPhraseLog">,
  overrides: ScreenReaderObserveConfig = {},
  defaults: ScreenReaderObserveProfile = DEFAULT_SCREEN_READER_OBSERVE_PROFILE
): AnnouncementReader {
  const profile = resolveObserveProfile(defaults, overrides);

  return async () => {
    const collected: string[] = [];
    const startedAt = Date.now();
    let lastNewPhraseAt: number | undefined;

    while (Date.now() - startedAt < profile.maxObserveMs) {
      const phrases = await readAndClearSpokenPhrases(session);
      if (phrases.length > 0) {
        collected.push(...phrases);
        lastNewPhraseAt = Date.now();
      }

      if (collected.length > 0) {
        if (lastNewPhraseAt !== undefined && Date.now() - lastNewPhraseAt >= profile.silenceWindowMs) {
          return {
            announcement: collected.join("\n"),
            announcementCapture: "log",
            announcementCount: collected.length,
            observeReason: "silence"
          };
        }
      }

      await sleep(profile.pollIntervalMs);
    }

    if (collected.length > 0) {
      return {
        announcement: collected.join("\n"),
        announcementCapture: "log",
        announcementCount: collected.length,
        observeReason: "timeout"
      };
    }

    if (profile.allowFallback) {
      const fallback = (await session.lastSpokenPhrase()).trim();
      return fallback
        ? {
            announcement: fallback,
            announcementCapture: "fallback",
            announcementCount: 1,
            observeReason: "fallback"
          }
        : {
            announcement: "",
            announcementCapture: "none",
            announcementCount: 0,
            observeReason: "timeout"
          };
    }

    return {
      announcement: "",
      announcementCapture: "none",
      announcementCount: 0,
      observeReason: "timeout"
    };
  };
}

async function readAndClearSpokenPhrases(
  session: Pick<ScreenReaderSession, "spokenPhraseLog" | "clearSpokenPhraseLog">
): Promise<string[]> {
  const log = (await session.spokenPhraseLog()) ?? [];
  const phrases = log
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);

  await session.clearSpokenPhraseLog();
  return phrases;
}

function resolveObserveProfile(
  defaults: ScreenReaderObserveProfile,
  overrides: ScreenReaderObserveConfig
): ScreenReaderObserveProfile {
  return {
    ...defaults,
    ...overrides
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
