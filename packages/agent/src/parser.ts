import {
  parseKeyboardActionCandidate,
  type KeyboardActionDescriptor,
  type KeyboardActionPlan,
  parseScreenReaderIntentCandidate,
  type ScreenReaderActionDescriptor
} from "@rawstep/action-catalog";
import {
  type Action,
  type Decision,
  type ExperienceSummary,
  type PlanState,
  type ReflectionState,
  type TaskInput
} from "@rawstep/definition";
import type { PromptPart } from "./shared";

export function parseDecision(
  raw: string,
  taskInput?: TaskInput,
  keyboardActions?: readonly KeyboardActionDescriptor[] | KeyboardActionPlan,
  screenReaderActions?: readonly ScreenReaderActionDescriptor[]
): Decision {
  const result = parseDecisionResult(raw, taskInput, keyboardActions, screenReaderActions);

  if (result.status === "ok") {
    return result.decision;
  }

  if (result.status === "invalid-input-value") {
    return invalidInputValueDecision(result.snippet, result.actionKind, result.value, result.allowedValues);
  }

  return malformedDecision(result.snippet);
}

export type ParseDecisionResult =
  | { status: "ok"; decision: Decision }
  | { status: "missing-stuck-rationale"; snippet: string }
  | {
      status: "invalid-input-value";
      snippet: string;
      actionKind: "typeText" | "replaceText";
      value: string;
      allowedValues: string[];
    }
  | { status: "malformed"; snippet: string };

export function parseDecisionResult(
  raw: string,
  taskInput?: TaskInput,
  keyboardActions?: readonly KeyboardActionDescriptor[] | KeyboardActionPlan,
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

      const parsedAction = parseStringActionCandidate(
        candidate,
        taskInput,
        keyboardActions,
        screenReaderActions
      );
      if (parsedAction.status === "invalid-input-value") {
        return {
          status: "invalid-input-value",
          snippet,
          actionKind: parsedAction.actionKind,
          value: parsedAction.value,
          allowedValues: parsedAction.allowedValues
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
  taskInput?: TaskInput,
  keyboardActions?: readonly KeyboardActionDescriptor[] | KeyboardActionPlan,
  screenReaderActions?: readonly ScreenReaderActionDescriptor[]
):
  | { status: "ok"; action: Action }
  | {
      status: "invalid-input-value";
      actionKind: "typeText" | "replaceText";
      value: string;
      allowedValues: string[];
    }
  | { status: "malformed" } {
  const value = typeof candidate.action === "string" ? candidate.action.trim() : "";
  if (!value) {
    return { status: "malformed" };
  }

  const parsedKeyboardAction = parseKeyboardActionCandidate(candidate, keyboardActions);
  if (parsedKeyboardAction.status === "matched") {
    return { status: "ok", action: parsedKeyboardAction.action };
  }
  if (parsedKeyboardAction.status === "malformed") {
    return { status: "malformed" };
  }

  if (value === "typeText" || value === "replaceText") {
    if (hasUnexpectedKeys(candidate, ["action", "value", "rationale"])) {
      return { status: "malformed" };
    }

    const actionKind = value === "typeText"
      ? "typeText" as const
      : "replaceText" as const;
    if (typeof candidate.value !== "string" || !candidate.value.trim()) {
      return { status: "malformed" };
    }

    const inputValue = candidate.value;
    const allowedValues = dedupe(Object.values(taskInput ?? {}));
    if (allowedValues.length === 0) {
      return { status: "invalid-input-value", actionKind, value: inputValue, allowedValues: [] };
    }

    if (!allowedValues.includes(inputValue)) {
      return { status: "invalid-input-value", actionKind, value: inputValue, allowedValues };
    }

    return {
      status: "ok",
      action: actionKind === "typeText"
        ? { typeText: inputValue }
        : { replaceText: inputValue }
    };
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
    blockers?: unknown;
    surprise?: unknown;
    oneLineFeel?: unknown;
  };

  if (
    typeof candidate.overall !== "string"
    || !Array.isArray(candidate.blockers)
    || !(typeof candidate.surprise === "string" || candidate.surprise === null)
    || typeof candidate.oneLineFeel !== "string"
  ) {
    throw new Error("agent returned malformed experience summary");
  }

  const overall = candidate.overall.trim();
  const oneLineFeel = candidate.oneLineFeel.trim();
  const blockers = candidate.blockers
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 5);

  const surprise = candidate.surprise === null ? null : candidate.surprise.trim();

  if (!overall || !oneLineFeel || (surprise !== null && !surprise)) {
    throw new Error("agent returned malformed experience summary");
  }

  return {
    overall,
    blockers,
    surprise,
    oneLineFeel
  };
}

export function parsePlanState(raw: string): PlanState {
  const candidate = JSON.parse(extractJsonObject(raw)) as {
    steps?: unknown;
    currentFocus?: unknown;
    successSignals?: unknown;
  };

  if (
    !Array.isArray(candidate.steps)
    || typeof candidate.currentFocus !== "string"
    || !Array.isArray(candidate.successSignals)
  ) {
    throw new Error("agent returned malformed plan state");
  }

  const steps = candidate.steps
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 5);
  const currentFocus = candidate.currentFocus.trim();
  const successSignals = candidate.successSignals
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 5);

  if (!currentFocus || steps.length === 0 || successSignals.length === 0) {
    throw new Error("agent returned malformed plan state");
  }

  return {
    steps,
    currentFocus,
    successSignals
  };
}

export function parseReflectionState(raw: string): ReflectionState {
  const candidate = JSON.parse(extractJsonObject(raw)) as {
    status?: unknown;
    assessment?: unknown;
    strategyNote?: unknown;
    updatedFocus?: unknown;
  };

  if (
    (candidate.status !== "progressing" && candidate.status !== "flat" && candidate.status !== "drifting")
    || typeof candidate.assessment !== "string"
    || typeof candidate.strategyNote !== "string"
    || !(candidate.updatedFocus === undefined || typeof candidate.updatedFocus === "string")
  ) {
    throw new Error("agent returned malformed reflection state");
  }

  const assessment = candidate.assessment.trim();
  const strategyNote = candidate.strategyNote.trim();
  const updatedFocus = typeof candidate.updatedFocus === "string"
    ? candidate.updatedFocus.trim()
    : undefined;

  if (!assessment || !strategyNote) {
    throw new Error("agent returned malformed reflection state");
  }

  return {
    status: candidate.status,
    assessment,
    strategyNote,
    ...(updatedFocus ? { updatedFocus } : {})
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
        "The previous response had verdict=\"stuck\" but no rationale.",
        "You may keep the same judgment.",
        "Return JSON only again.",
        "If you keep `stuck`, the rationale must include one sentence explaining why ending here is justified.",
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

function invalidInputValueDecision(
  snippet: string,
  actionKind: "typeText" | "replaceText",
  value: string,
  allowedValues: string[]
): Decision {
  const allowed = allowedValues.length > 0
    ? allowedValues.map((item) => JSON.stringify(item)).join(", ")
    : "(none)";
  return {
    verdict: "stuck",
    rationale: `agent returned invalid ${actionKind} value ${JSON.stringify(value)}. Allowed input values: ${allowed}. Raw response: ${snippet || "<empty response>"}`
  };
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
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
