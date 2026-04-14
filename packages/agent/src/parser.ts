import {
  type Action,
  isAllowedKey,
  type Decision,
  type ExperienceSummary
} from "@rawstep/core";
import type { PromptPart } from "./shared";

export function parseDecision(raw: string, taskInputKeys?: string[]): Decision {
  const result = parseDecisionResult(raw, taskInputKeys);

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

export function parseDecisionResult(raw: string, taskInputKeys?: string[]): ParseDecisionResult {
  const snippet = raw.trim().slice(0, 240);

  try {
    const candidate = JSON.parse(extractJsonObject(raw)) as {
      action?: string;
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
      if (typeof candidate.action !== "string" || !candidate.action.trim()) {
        return { status: "malformed", snippet };
      }

      const parsedAction = parseStringAction(candidate.action, taskInputKeys);
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

function parseStringAction(
  value: string,
  taskInputKeys?: string[]
):
  | { status: "ok"; action: Action }
  | { status: "invalid-typeText-key"; key: string; allowedKeys: string[] }
  | { status: "malformed" } {
  if (value.startsWith("key.")) {
    const key = value.slice("key.".length);
    if (!isAllowedKey(key)) {
      return { status: "malformed" };
    }

    return { status: "ok", action: { key } };
  }

  if (value.startsWith("typeText.")) {
    const key = value.slice("typeText.".length);
    if (!taskInputKeys || taskInputKeys.length === 0) {
      return { status: "invalid-typeText-key", key, allowedKeys: [] };
    }

    if (!taskInputKeys.includes(key)) {
      return { status: "invalid-typeText-key", key, allowedKeys: [...taskInputKeys] };
    }

    return { status: "ok", action: { typeText: key } };
  }

  if (value.startsWith("sr.invoke.")) {
    const method = value.slice("sr.invoke.".length);
    switch (method) {
      case "next":
      case "previous":
      case "act":
      case "interact":
      case "stopInteracting":
        return {
          status: "ok",
          action: { srAction: { kind: "invoke", method } }
        };
      default:
        return { status: "malformed" };
    }
  }

  if (value.startsWith("sr.read.")) {
    const method = value.slice("sr.read.".length);
    switch (method) {
      case "itemText":
      case "itemTextLog":
      case "lastSpokenPhrase":
      case "spokenPhraseLog":
        return {
          status: "ok",
          action: { srAction: { kind: "read", method } }
        };
      default:
        return { status: "malformed" };
    }
  }

  if (value.startsWith("sr.maintenance.")) {
    const method = value.slice("sr.maintenance.".length);
    switch (method) {
      case "clearItemTextLog":
      case "clearSpokenPhraseLog":
        return {
          status: "ok",
          action: { srAction: { kind: "maintenance", method } }
        };
      default:
        return { status: "malformed" };
    }
  }

  const catalogMatch = value.match(/^sr\.perform\.catalog\((.+)\)$/);
  if (catalogMatch) {
    const id = catalogMatch[1]?.trim();
    if (!id) {
      return { status: "malformed" };
    }

    return {
      status: "ok",
      action: {
        srAction: {
          kind: "invoke",
          method: "perform",
          command: { source: "catalog", id }
        }
      }
    };
  }

  return { status: "malformed" };
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
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const balancedObject = findFirstBalancedJsonObject(raw);
  if (balancedObject) {
    return balancedObject;
  }

  return raw.trim();
}

function findFirstBalancedJsonObject(raw: string): string | undefined {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (character === "\\") {
        escaping = true;
        continue;
      }

      if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (character === "}") {
      if (depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && start !== -1) {
        return raw.slice(start, index + 1).trim();
      }
    }
  }

  return undefined;
}
