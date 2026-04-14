import {
  type Action,
  isAllowedKey,
  type Decision,
  type ExperienceSummary,
  type ResolvedPromptScreenReaderAction
} from "@rawstep/core";
import { formatResolvedPromptScreenReaderActionName } from "./action-strings";
import type { PromptPart } from "./shared";

export function parseDecision(
  raw: string,
  taskInputKeys?: string[],
  screenReaderActions?: readonly ResolvedPromptScreenReaderAction[]
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
  screenReaderActions?: readonly ResolvedPromptScreenReaderAction[]
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
  screenReaderActions?: readonly ResolvedPromptScreenReaderAction[]
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

  const promptAction = screenReaderActions?.find(
    (action) => formatResolvedPromptScreenReaderActionName(action) === value
  );
  if (promptAction) {
    return parseResolvedPromptScreenReaderActionCandidate(promptAction, candidate);
  }

  if (value.startsWith("sr.read.")) {
    if (hasUnexpectedKeys(candidate, ["action", "rationale"])) {
      return { status: "malformed" };
    }

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

  if (value.startsWith("sr.clear.")) {
    if (hasUnexpectedKeys(candidate, ["action", "rationale"])) {
      return { status: "malformed" };
    }

    const method = value.slice("sr.clear.".length);
    switch (method) {
      case "itemTextLog":
        return {
          status: "ok",
          action: { srAction: { kind: "maintenance", method: "clearItemTextLog" } }
        };
      case "spokenPhraseLog":
        return {
          status: "ok",
          action: { srAction: { kind: "maintenance", method: "clearSpokenPhraseLog" } }
        };
      default:
        return { status: "malformed" };
    }
  }

  if (value === "sr.next" || value === "sr.previous" || value === "sr.act" || value === "sr.interact" || value === "sr.stopInteracting") {
    if (hasUnexpectedKeys(candidate, ["action", "rationale"])) {
      return { status: "malformed" };
    }

    return {
      status: "ok",
      action: {
        srAction: {
          kind: "invoke",
          method: value.slice("sr.".length) as "next" | "previous" | "act" | "interact" | "stopInteracting"
        }
      }
    };
  }

  if (value === "sr.press") {
    return parsePressPromptActionCandidate(candidate);
  }

  if (value === "sr.type") {
    return parseTypePromptActionCandidate(candidate);
  }

  if (value === "sr.click") {
    return parseClickPromptActionCandidate(candidate);
  }

  if (value.startsWith("sr.catalog.")) {
    return parseExplicitCatalogCandidate(value, candidate);
  }

  if (value === "sr.rawPerform") {
    return parseRawPerformCandidate(candidate);
  }

  return { status: "malformed" };
}

function parseResolvedPromptScreenReaderActionCandidate(
  promptAction: ResolvedPromptScreenReaderAction,
  candidate: Record<string, unknown>
):
  | { status: "ok"; action: Action }
  | { status: "malformed" } {
  switch (promptAction.semantic) {
    case "catalog":
      return parseCatalogPromptActionCandidate(promptAction, candidate);
    case "rawPerform":
      return parseRawPerformCandidate(candidate);
    case "press":
      return parsePressPromptActionCandidate(candidate);
    case "type":
      return parseTypePromptActionCandidate(candidate);
    case "click":
      return parseClickPromptActionCandidate(candidate);
    default:
      if (hasUnexpectedKeys(candidate, ["action", "rationale"])) {
        return { status: "malformed" };
      }

      return {
        status: "ok",
        action: toActionFromResolvedPromptRuntimeAction(promptAction.runtimeAction)
      };
  }
}

function parseCatalogPromptActionCandidate(
  promptAction: Extract<ResolvedPromptScreenReaderAction, { semantic: "catalog" }>,
  candidate: Record<string, unknown>
):
  | { status: "ok"; action: Action }
  | { status: "malformed" } {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "args"])) {
    return { status: "malformed" };
  }

  const args = candidate.args === undefined ? undefined : parseRecord(candidate.args);
  if (candidate.args !== undefined && !args) {
    return { status: "malformed" };
  }

  return {
    status: "ok",
    action: {
      srAction: {
        kind: "invoke",
        method: "perform",
        command: {
          source: "catalog",
          id: promptAction.runtimeAction.id,
          ...(args ? { args } : {})
        }
      }
    }
  };
}

function parseExplicitCatalogCandidate(
  value: string,
  candidate: Record<string, unknown>
):
  | { status: "ok"; action: Action }
  | { status: "malformed" } {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "args"])) {
    return { status: "malformed" };
  }

  const id = value.slice("sr.catalog.".length).trim();
  if (!id) {
    return { status: "malformed" };
  }

  const args = candidate.args === undefined ? undefined : parseRecord(candidate.args);
  if (candidate.args !== undefined && !args) {
    return { status: "malformed" };
  }

  return {
    status: "ok",
    action: {
      srAction: {
        kind: "invoke",
        method: "perform",
        command: {
          source: "catalog",
          id,
          ...(args ? { args } : {})
        }
      }
    }
  };
}

function parseRawPerformCandidate(
  candidate: Record<string, unknown>
):
  | { status: "ok"; action: Action }
  | { status: "malformed" } {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "payload"])) {
    return { status: "malformed" };
  }

  const payload = parseRecord(candidate.payload);
  if (!payload) {
    return { status: "malformed" };
  }

  return {
    status: "ok",
    action: {
      srAction: {
        kind: "invoke",
        method: "perform",
        command: { source: "raw", payload }
      }
    }
  };
}

function parsePressPromptActionCandidate(
  candidate: Record<string, unknown>
):
  | { status: "ok"; action: Action }
  | { status: "malformed" } {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "key"])) {
    return { status: "malformed" };
  }

  const key = typeof candidate.key === "string" && candidate.key.trim()
    ? candidate.key.trim()
    : undefined;
  if (!key) {
    return { status: "malformed" };
  }

  return {
    status: "ok",
    action: { srAction: { kind: "invoke", method: "press", key } }
  };
}

function parseTypePromptActionCandidate(
  candidate: Record<string, unknown>
):
  | { status: "ok"; action: Action }
  | { status: "malformed" } {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "text"])) {
    return { status: "malformed" };
  }

  const text = typeof candidate.text === "string" && candidate.text.length > 0
    ? candidate.text
    : undefined;
  if (!text) {
    return { status: "malformed" };
  }

  return {
    status: "ok",
    action: { srAction: { kind: "invoke", method: "type", text } }
  };
}

function parseClickPromptActionCandidate(
  candidate: Record<string, unknown>
):
  | { status: "ok"; action: Action }
  | { status: "malformed" } {
  if (hasUnexpectedKeys(candidate, ["action", "rationale", "button", "clickCount"])) {
    return { status: "malformed" };
  }

  const button = parseClickButton(candidate.button);
  if (candidate.button !== undefined && button === undefined) {
    return { status: "malformed" };
  }

  const clickCount = parseClickCount(candidate.clickCount);
  if (candidate.clickCount !== undefined && clickCount === undefined) {
    return { status: "malformed" };
  }

  const options = button !== undefined || clickCount !== undefined
    ? {
        ...(button !== undefined ? { button } : {}),
        ...(clickCount !== undefined ? { clickCount } : {})
      }
    : undefined;

  return {
    status: "ok",
    action: {
      srAction: {
        kind: "invoke",
        method: "click",
        ...(options ? { options } : {})
      }
    }
  };
}

function toActionFromResolvedPromptRuntimeAction(
  action: ResolvedPromptScreenReaderAction["runtimeAction"]
): Action {
  if (action.kind === "read") {
    return { srAction: { kind: "read", method: action.method } };
  }

  if (action.kind === "maintenance") {
    return { srAction: { kind: "maintenance", method: action.method } };
  }

  if (action.method === "perform") {
    if (action.source === "catalog") {
      return {
        srAction: {
          kind: "invoke",
          method: "perform",
          command: { source: "catalog", id: action.id }
        }
      };
    }

    return {
      srAction: {
        kind: "invoke",
        method: "perform",
        command: { source: "raw", payload: {} }
      }
    };
  }

  switch (action.method) {
    case "next":
    case "previous":
    case "act":
    case "interact":
    case "stopInteracting":
      return {
        srAction: {
          kind: "invoke",
          method: action.method
        }
      };
    case "press":
    case "type":
    case "click":
      throw new Error(`Parameterized action "${action.method}" must be parsed with dedicated fields.`);
  }
}

function hasUnexpectedKeys(candidate: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(candidate).some((key) => !allowedKeys.includes(key));
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function parseClickButton(value: unknown): "left" | "right" | undefined {
  return value === "left" || value === "right" ? value : undefined;
}

function parseClickCount(value: unknown): 1 | 2 | 3 | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
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
