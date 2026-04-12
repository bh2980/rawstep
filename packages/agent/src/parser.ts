import {
  isAllowedKey,
  isScreenReaderCommand,
  type Decision,
  type ExperienceSummary
} from "@a11y-task/core";
import type { PromptPart } from "./shared";

export function parseDecision(raw: string): Decision {
  const result = parseDecisionResult(raw);

  if (result.status === "ok") {
    return result.decision;
  }

  return malformedDecision(result.snippet);
}

export type ParseDecisionResult =
  | { status: "ok"; decision: Decision }
  | { status: "missing-stuck-rationale"; snippet: string }
  | { status: "malformed"; snippet: string };

export function parseDecisionResult(raw: string): ParseDecisionResult {
  const snippet = raw.trim().slice(0, 240);

  try {
    const candidate = JSON.parse(extractJsonObject(raw)) as {
      action?: { key?: string; typeText?: string; srCommand?: string };
      verdict?: string;
      rationale?: string;
    };

    const rationale = typeof candidate.rationale === "string" && candidate.rationale.trim()
      ? candidate.rationale.trim()
      : undefined;

    const hasAction = candidate.action !== undefined;
    const hasVerdict = candidate.verdict !== undefined;

    if (hasAction === hasVerdict) {
      return { status: "malformed", snippet };
    }

    if (candidate.action) {
      const key = candidate.action.key;
      const typeText = candidate.action.typeText;
      const srCommand = candidate.action.srCommand;

      if ([key, typeText, srCommand].filter(Boolean).length !== 1) {
        return { status: "malformed", snippet };
      }

      if (key) {
        if (!isAllowedKey(key)) {
          return { status: "malformed", snippet };
        }

        return {
          status: "ok",
          decision: {
            action: { key },
            ...withOptionalRationale(rationale)
          }
        };
      }

      if (typeText === "task") {
        return {
          status: "ok",
          decision: {
            action: { typeText: "task" },
            ...withOptionalRationale(rationale)
          }
        };
      }

      if (srCommand && isScreenReaderCommand(srCommand)) {
        return {
          status: "ok",
          decision: {
            action: { srCommand },
            ...withOptionalRationale(rationale)
          }
        };
      }

      return { status: "malformed", snippet };
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

function extractJsonObject(raw: string): string {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  return raw.trim();
}
