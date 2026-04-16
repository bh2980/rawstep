import {
  type AnnouncementReader,
  type ScreenReaderSession,
  type ScreenReaderObserveProfile,
} from "./types";
import {
  DEFAULT_SCREEN_READER_OBSERVE_PROFILE
} from "./registry";
import type { ScreenReaderObserveConfig } from "@rawstep/definition";
import type { AnnouncementReadOptions } from "./types";

const ALERT_FOLLOW_UP_MAX_WAIT_MS = 1_200;
const ALERT_FOLLOW_UP_SILENCE_MS = 700;

export function createAnnouncementReader(
  session: Pick<ScreenReaderSession, "lastSpokenPhrase" | "spokenPhraseLog" | "clearSpokenPhraseLog">,
  overrides: ScreenReaderObserveConfig = {},
  defaults: ScreenReaderObserveProfile = DEFAULT_SCREEN_READER_OBSERVE_PROFILE
): AnnouncementReader {
  const profile = resolveObserveProfile(defaults, overrides);

  return async (options: AnnouncementReadOptions = {}) => {
    const collected: string[] = [];
    const startedAt = Date.now();
    let lastNewPhraseAt: number | undefined;
    let alertFollowUpDeadlineAt: number | undefined;
    let alertFollowUpArmed = false;

    while (
      Date.now() - startedAt < profile.maxObserveMs
      || (alertFollowUpDeadlineAt !== undefined && Date.now() < alertFollowUpDeadlineAt)
    ) {
      const phrases = await readAndClearSpokenPhrases(session);
      if (phrases.length > 0) {
        collected.push(...phrases);
        lastNewPhraseAt = Date.now();
      }

      if (collected.length > 0) {
        const silenceWindowMs = alertFollowUpDeadlineAt === undefined
          ? profile.silenceWindowMs
          : ALERT_FOLLOW_UP_SILENCE_MS;

        if (lastNewPhraseAt !== undefined && Date.now() - lastNewPhraseAt >= silenceWindowMs) {
          if (
            options.followUpAfterAlert
            && !alertFollowUpArmed
            && shouldExtendForAlertFollowUp(collected)
          ) {
            alertFollowUpArmed = true;
            alertFollowUpDeadlineAt = Date.now() + ALERT_FOLLOW_UP_MAX_WAIT_MS;
            lastNewPhraseAt = Date.now();
            continue;
          }

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

function shouldExtendForAlertFollowUp(collected: readonly string[]): boolean {
  return containsValidationAlert(collected) && !containsFieldContext(collected);
}

function containsValidationAlert(collected: readonly string[]): boolean {
  return collected.some((phrase) => {
    const normalized = phrase.toLowerCase();
    return normalized.includes("enter a valid")
      || normalized.includes("before signing in")
      || normalized.includes("before requesting")
      || normalized.includes("invalid")
      || normalized.includes("error")
      || normalized.includes("유효하지 않은")
      || normalized.includes("필수 사항");
  });
}

function containsFieldContext(collected: readonly string[]): boolean {
  return collected.some((phrase) => {
    const normalized = phrase.toLowerCase();
    return normalized.includes("text field")
      || normalized.includes("security text field")
      || normalized.includes("checkbox")
      || normalized.includes("button")
      || normalized.includes("텍스트 필드")
      || normalized.includes("보안 텍스트 필드")
      || normalized.includes("체크박스")
      || normalized.includes("버튼")
      || normalized.includes("텍스트 끝부분에 삽입")
      || normalized.includes("형식 요소");
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
