import {
  isAllowedKey,
  type ClickOptions,
  type CommandOptions,
  type Decision,
  type KeyboardOptions,
  type ScreenReaderAction,
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
      action?: { key?: string; typeText?: string; srAction?: unknown; srCommand?: unknown };
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
      const srAction = candidate.action.srAction;

      if ([key, typeText, srAction].filter((value) => value !== undefined).length !== 1) {
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

      if (typeText) {
        if (!taskInputKeys || taskInputKeys.length === 0) {
          return { status: "invalid-typeText-key", snippet, key: typeText, allowedKeys: [] };
        }

        if (!taskInputKeys.includes(typeText)) {
          return {
            status: "invalid-typeText-key",
            snippet,
            key: typeText,
            allowedKeys: [...taskInputKeys]
          };
        }

        return {
          status: "ok",
          decision: {
            action: { typeText },
            ...withOptionalRationale(rationale)
          }
        };
      }

      const parsedScreenReaderAction = parseScreenReaderAction(srAction);
      if (parsedScreenReaderAction) {
        return {
          status: "ok",
          decision: {
            action: { srAction: parsedScreenReaderAction },
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

function parseScreenReaderAction(value: unknown): ScreenReaderAction | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "read") {
    return parseReadAction(candidate);
  }

  if (candidate.kind === "maintenance") {
    return parseMaintenanceAction(candidate);
  }

  if (candidate.kind !== "invoke" || typeof candidate.method !== "string") {
    return undefined;
  }

  switch (candidate.method) {
    case "next":
    case "previous":
    case "act":
    case "interact":
    case "stopInteracting":
      return {
        kind: "invoke",
        method: candidate.method,
        ...(parseCommandOptions(candidate.options) ? { options: parseCommandOptions(candidate.options)! } : {})
      };
    case "press": {
      if (typeof candidate.key !== "string" || !candidate.key.trim()) {
        return undefined;
      }

      const options = parseKeyboardOptions(candidate.options);
      if (candidate.options !== undefined && !options) {
        return undefined;
      }

      return {
        kind: "invoke",
        method: "press",
        key: candidate.key,
        ...(options ? { options } : {})
      };
    }
    case "type": {
      if (typeof candidate.text !== "string") {
        return undefined;
      }

      const options = parseKeyboardOptions(candidate.options);
      if (candidate.options !== undefined && !options) {
        return undefined;
      }

      return {
        kind: "invoke",
        method: "type",
        text: candidate.text,
        ...(options ? { options } : {})
      };
    }
    case "click": {
      const options = parseClickOptions(candidate.options);
      if (candidate.options !== undefined && !options) {
        return undefined;
      }

      return {
        kind: "invoke",
        method: "click",
        ...(options ? { options } : {})
      };
    }
    case "perform": {
      const command = parsePerformCommand(candidate.command);
      if (!command) {
        return undefined;
      }

      const options = parseCommandOptions(candidate.options);
      if (candidate.options !== undefined && !options) {
        return undefined;
      }

      return {
        kind: "invoke",
        method: "perform",
        command,
        ...(options ? { options } : {})
      };
    }
    default:
      return undefined;
  }
}

function parseReadAction(candidate: Record<string, unknown>): ScreenReaderAction | undefined {
  switch (candidate.method) {
    case "itemText":
    case "itemTextLog":
    case "lastSpokenPhrase":
    case "spokenPhraseLog":
      return {
        kind: "read",
        method: candidate.method
      };
    default:
      return undefined;
  }
}

function parseMaintenanceAction(candidate: Record<string, unknown>): ScreenReaderAction | undefined {
  switch (candidate.method) {
    case "clearItemTextLog":
    case "clearSpokenPhraseLog":
      return {
        kind: "maintenance",
        method: candidate.method
      };
    default:
      return undefined;
  }
}

function parsePerformCommand(
  value: unknown
): Extract<ScreenReaderAction, { kind: "invoke"; method: "perform" }>["command"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.source === "catalog") {
    if (typeof candidate.id !== "string" || !candidate.id.trim()) {
      return undefined;
    }

    if (
      candidate.args !== undefined
      && (typeof candidate.args !== "object" || candidate.args === null || Array.isArray(candidate.args))
    ) {
      return undefined;
    }

    return {
      source: "catalog",
      id: candidate.id.trim(),
      ...(candidate.args ? { args: candidate.args as Record<string, unknown> } : {})
    };
  }

  if (
    candidate.source === "raw"
    && typeof candidate.payload === "object"
    && candidate.payload !== null
    && !Array.isArray(candidate.payload)
  ) {
    return {
      source: "raw",
      payload: candidate.payload as Record<string, unknown>
    };
  }

  return undefined;
}

function parseCommandOptions(value: unknown): CommandOptions | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.capture !== undefined
    && candidate.capture !== true
    && candidate.capture !== false
    && candidate.capture !== "initial"
  ) {
    return undefined as never;
  }

  if (
    candidate.retries !== undefined
    && (typeof candidate.retries !== "number" || !Number.isInteger(candidate.retries))
  ) {
    return undefined as never;
  }

  if (
    candidate.timeout !== undefined
    && (typeof candidate.timeout !== "number" || !Number.isInteger(candidate.timeout))
  ) {
    return undefined;
  }

  return {
    ...(candidate.capture !== undefined ? { capture: candidate.capture } : {}),
    ...(candidate.retries !== undefined ? { retries: candidate.retries } : {}),
    ...(candidate.timeout !== undefined ? { timeout: candidate.timeout } : {})
  };
}

function parseKeyboardOptions(value: unknown): KeyboardOptions | undefined {
  const commandOptions = parseCommandOptions(value);
  if (value !== undefined && !commandOptions) {
    return undefined;
  }

  if (value === undefined) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.application !== undefined && typeof candidate.application !== "string") {
    return undefined;
  }

  return {
    ...(commandOptions ?? {}),
    ...(candidate.application !== undefined ? { application: candidate.application } : {})
  };
}

function parseClickOptions(value: unknown): ClickOptions | undefined {
  const commandOptions = parseCommandOptions(value);
  if (value !== undefined && !commandOptions) {
    return undefined;
  }

  if (value === undefined) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.button !== undefined && candidate.button !== "left" && candidate.button !== "right") {
    return undefined;
  }

  if (
    candidate.clickCount !== undefined
    && (typeof candidate.clickCount !== "number" || !Number.isInteger(candidate.clickCount))
  ) {
    return undefined;
  }

  return {
    ...(commandOptions ?? {}),
    ...(candidate.button !== undefined ? { button: candidate.button } : {}),
    ...(candidate.clickCount !== undefined ? { clickCount: candidate.clickCount as 1 | 2 | 3 } : {})
  };
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
