import {
  parseScreenReaderIntentCandidate,
  type ScreenReaderActionDescriptor
} from "@rawstep/action-catalog";
import {
  type Action,
  isAllowedKey,
  type Decision,
  type ExperienceSummary
} from "@rawstep/core";
import type { PromptPart } from "./shared";

export function parseDecision(
  raw: string,
  taskInputKeys?: string[],
  screenReaderActions?: readonly ScreenReaderActionDescriptor[]
): Decision {
  const result = parseDecisionResult(raw, taskInputKeys, screenReaderActions);

  if (result.status === "ok") {
    return result.decision;
  }

  if (result.status === "invalid-typeText-key") {
    return invalidTypeTextKeyDecision(result.snippet, result.key, result.allowedKeys);
  }

  return malformedDecision(result.snippet);
}

export type ParseDecisionResult =
  | { status: "ok"; decision: Decision }
  | { status: "missing-stuck-rationale"; snippet: string }
  | { status: "invalid-typeText-key"; snippet: string; key: string; allowedKeys: string[] }
  | { status: "malformed"; snippet: string };

export function parseDecisionResult(
  raw: string,
  taskInputKeys?: string[],
  screenReaderActions?: readonly ScreenReaderActionDescriptor[]
): ParseDecisionResult {
  const snippet = raw.trim().slice(0, 240);

  try {
    const candidate = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;

    const rationale = typeof candidate.rationale === "string" && candidate.rationale.trim()
      ? candidate.rationale.trim()
      : undefined;

    const hasAction = candidate.action !== undefined;
    const hasVerdict = candidate.verdict !== undefined;

    if (hasAction === hasVerdict) {
      return { status: "malformed", snippet };
    }

    if (hasAction) {
      if (typeof candidate.action !== "string" || !candidate.action.trim()) {
        return { status: "malformed", snippet };
      }

      const parsedAction = parseStringActionCandidate(candidate, taskInputKeys, screenReaderActions);
      if (parsedAction.status === "invalid-typeText-key") {
        return {
          status: "invalid-typeText-key",
          snippet,
          key: parsedAction.key,
          allowedKeys: parsedAction.allowedKeys
        };
      }

      if (parsedAction.status === "malformed") {
        return { status: "malformed", snippet };
      }

      return {
        status: "ok",
        decision: {
          action: parsedAction.action,
          ...withOptionalRationale(rationale)
        }
      };
    }

    if (candidate.verdict === "success" || candidate.verdict === "stuck") {
      if (candidate.verdict === "stuck" && !rationale) {
        return { status: "missing-stuck-rationale", snippet };
      }

      return {
        status: "ok",
        decision: {
          verdict: candidate.verdict,
          ...withOptionalRationale(rationale)
        }
      };
    }

    return { status: "malformed", snippet };
  } catch {
    return { status: "malformed", snippet };
  }
}

function parseStringActionCandidate(
  candidate: Record<string, unknown>,
  taskInputKeys?: string[],
  screenReaderActions?: readonly ScreenReaderActionDescriptor[]
):
  | { status: "ok"; action: Action }
  | { status: "invalid-typeText-key"; key: string; allowedKeys: string[] }
  | { status: "malformed" } {
  const value = typeof candidate.action === "string" ? candidate.action.trim() : "";
  if (!value) {
    return { status: "malformed" };
  }

  if (value.startsWith("key.")) {
    if (hasUnexpectedKeys(candidate, ["action", "rationale"])) {
      return { status: "malformed" };
    }

    const key = value.slice("key.".length);
    if (!isAllowedKey(key)) {
      return { status: "malformed" };
    }

    return { status: "ok", action: { key } };
  }

  if (value.startsWith("typeText.")) {
    if (hasUnexpectedKeys(candidate, ["action", "rationale"])) {
      return { status: "malformed" };
    }

    const key = value.slice("typeText.".length);
    if (!taskInputKeys || taskInputKeys.length === 0) {
      return { status: "invalid-typeText-key", key, allowedKeys: [] };
    }

    if (!taskInputKeys.includes(key)) {
      return { status: "invalid-typeText-key", key, allowedKeys: [...taskInputKeys] };
    }

    return { status: "ok", action: { typeText: key } };
  }

  const parsedScreenReaderIntent = parseScreenReaderIntentCandidate(candidate, screenReaderActions);
  if (parsedScreenReaderIntent.status === "matched") {
    return {
      status: "ok",
      action: { srAction: parsedScreenReaderIntent.intent }
    };
  }

  return parsedScreenReaderIntent.status === "malformed"
    ? { status: "malformed" }
    : { status: "malformed" };
}

function hasUnexpectedKeys(candidate: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(candidate).some((key) => !allowedKeys.includes(key));
}

export function parseExperienceSummary(raw: string): ExperienceSummary {
  const candidate = JSON.parse(extractJsonObject(raw)) as {
    overall?: unknown;
    biggestFriction?: unknown;
    nextChecks?: unknown;
  };

  if (
    typeof candidate.overall !== "string"
    || typeof candidate.biggestFriction !== "string"
    || !Array.isArray(candidate.nextChecks)
  ) {
    throw new Error("agent returned malformed experience summary");
  }

  const nextChecks = candidate.nextChecks
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 2);

  return {
    overall: candidate.overall.trim(),
    biggestFriction: candidate.biggestFriction.trim(),
    nextChecks
  };
}

export function withOptionalRationale(rationale: string | undefined): { rationale?: string } {
  return rationale ? { rationale } : {};
}

export function buildStuckRationaleRetryPromptParts(
  promptParts: PromptPart[],
  previousRawText: string
): PromptPart[] {
  return [
    ...promptParts,
    {
      type: "text",
      text: [
        "이전 응답은 verdict=\"stuck\" 이었지만 rationale이 없었다.",
        "같은 판단을 유지해도 좋다.",
        "다시 JSON만 반환하라.",
        "stuck을 유지한다면 rationale에 종료가 타당한 이유를 한 문장으로 반드시 포함하라.",
        `previous response: ${JSON.stringify(previousRawText.trim())}`
      ].join("\n")
    }
  ];
}

function malformedDecision(snippet: string): Decision {
  return {
    verdict: "stuck",
    rationale: `agent returned malformed decision: ${snippet || "<empty response>"}`
  };
}

function invalidTypeTextKeyDecision(
  snippet: string,
  key: string,
  allowedKeys: string[]
): Decision {
  const allowed = allowedKeys.length > 0 ? allowedKeys.join(", ") : "(none)";
  return {
    verdict: "stuck",
    rationale: `agent returned invalid typeText key "${key}". Allowed input keys: ${allowed}. Raw response: ${snippet || "<empty response>"}`
  };
}

function extractJsonObject(raw: string): string {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1] : raw;
  const start = candidate.indexOf("{");
  if (start === -1) {
    throw new Error("no JSON object found");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(start, index + 1);
      }
    }
  }

  throw new Error("no complete JSON object found");
}
