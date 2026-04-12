import type { VoiceOverApi } from "./types";
import {
  DEFAULT_OBSERVE_PROFILES,
  type AnnouncementReader,
  type ScreenReaderObserveProfile,
  type ScreenReaderObserveProfileName
} from "./types";

export function createAnnouncementReader(voiceOver: Pick<
  VoiceOverApi,
  "lastSpokenPhrase" | "spokenPhraseLog" | "clearSpokenPhraseLog"
>,
profiles: Partial<Record<ScreenReaderObserveProfileName, Partial<ScreenReaderObserveProfile>>> = {}
): AnnouncementReader {
  const resolvedProfiles = resolveObserveProfiles(profiles);

  return async (profileName = "default") => {
    const profile = resolvedProfiles[profileName];
    const collected: string[] = [];
    const startedAt = Date.now();
    let lastNewPhraseAt: number | undefined;

    while (Date.now() - startedAt < profile.maxObserveMs) {
      const phrases = await readAndClearSpokenPhrases(voiceOver);
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
      const fallback = (await voiceOver.lastSpokenPhrase()).trim();
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

async function readAndClearSpokenPhrases(voiceOver: Pick<
  VoiceOverApi,
  "spokenPhraseLog" | "clearSpokenPhraseLog"
>): Promise<string[]> {
  const log = (await voiceOver.spokenPhraseLog()) ?? [];
  const phrases = log
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);

  await voiceOver.clearSpokenPhraseLog();
  return phrases;
}

function resolveObserveProfiles(
  profiles: Partial<Record<ScreenReaderObserveProfileName, Partial<ScreenReaderObserveProfile>>>
): Record<ScreenReaderObserveProfileName, ScreenReaderObserveProfile> {
  return {
    initial: { ...DEFAULT_OBSERVE_PROFILES.initial, ...profiles.initial },
    default: { ...DEFAULT_OBSERVE_PROFILES.default, ...profiles.default },
    interactive: { ...DEFAULT_OBSERVE_PROFILES.interactive, ...profiles.interactive }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
