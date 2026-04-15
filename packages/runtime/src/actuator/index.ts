import {
  type Action,
  type ExecutionRecord,
  type ScreenReaderBackendId,
  type ScreenReaderAction,
  type TaskInput
} from "@rawstep/definition";
import {
  createEmptyKeyCounts,
  isAllowedKey,
  type AllowedKey
} from "@rawstep/action-catalog";
import type { Page } from "playwright";
import { resolveKeyboardPressKey } from "./keys";

export class NotAllowedActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAllowedActionError";
  }
}

export type ActionExecutionResult = ExecutionRecord;

export interface ScreenReaderController {
  execute(action: ScreenReaderAction): Promise<ActionExecutionResult>;
  executeInternal?(action: ScreenReaderAction): Promise<ActionExecutionResult>;
}

export class Actuator {
  readonly keyCounts: Record<AllowedKey, number>;
  cost = 0;

  constructor(
    private readonly page: Page,
    private readonly options: {
      screenReaderController?: ScreenReaderController;
      useScreenReaderTextEntry?: boolean;
      screenReaderBackendId?: ScreenReaderBackendId;
      allowedKeys?: readonly AllowedKey[];
    } = {}
  ) {
    this.keyCounts = createEmptyKeyCounts();
  }

  async press(key: AllowedKey | string): Promise<void> {
    if (!isAllowedKey(key)) {
      throw new NotAllowedActionError(`Key "${key}" is not allowed in keyboard mode.`);
    }

    if (this.options.allowedKeys && !this.options.allowedKeys.includes(key)) {
      throw new NotAllowedActionError(`Key "${key}" is not allowed by the configured allowedKeys.`);
    }

    await this.page.keyboard.press(resolveKeyboardPressKey(key));
    this.cost += 1;
    this.keyCounts[key] += 1;
  }

  async execute(action: Action, taskInput?: TaskInput): Promise<ActionExecutionResult> {
    if ("key" in action) {
      await this.press(action.key);
      return { ok: true, costDelta: 1 };
    }

    if ("srAction" in action) {
      if (!this.options.screenReaderController) {
        throw new NotAllowedActionError(
          "Screen reader actions are not available without a screen reader controller."
        );
      }

      const execution = await this.options.screenReaderController.execute(action.srAction);
      this.cost += execution.costDelta;
      return execution;
    }

    if (!taskInput) {
      throw new NotAllowedActionError("Named task inputs are not enabled for this task.");
    }

    const inputValue = taskInput[action.typeText];
    if (typeof inputValue !== "string") {
      return {
        ok: false,
        costDelta: 0,
        error: `Task input key "${action.typeText}" is not available for this task.`
      };
    }

    const isTextInputTarget = await this.page.evaluate(() => {
      const active = document.activeElement;
      if (!active || !(active instanceof HTMLElement)) {
        return false;
      }

      if (active instanceof HTMLInputElement) {
        const textLikeTypes = new Set([
          "text",
          "search",
          "email",
          "url",
          "tel",
          "password",
          "number",
          "date",
          "datetime-local",
          "month",
          "time",
          "week"
        ]);
        const type = (active.type || "text").toLowerCase();
        return !active.disabled && !active.readOnly && textLikeTypes.has(type);
      }

      if (active instanceof HTMLTextAreaElement) {
        return !active.disabled && !active.readOnly;
      }

      return active.isContentEditable;
    });

    if (!isTextInputTarget) {
      return {
        ok: false,
        costDelta: 0,
        error: "Action did not produce an observable text-entry state change."
      };
    }

    if (this.options.useScreenReaderTextEntry) {
      if (this.options.screenReaderBackendId === "guidepup-voiceover") {
        await this.page.keyboard.type(inputValue);
        this.cost += 1;

        const textEntryResult = await this.readTextEntryResult(inputValue);
        if (!textEntryResult.verified) {
          return {
            ok: false,
            costDelta: 0,
            error: "Action did not produce the expected text-entry value.",
            textEntryResult
          };
        }

        return {
          ok: true,
          costDelta: 1,
          textEntryResult
        };
      }

      if (!this.options.screenReaderController) {
        throw new NotAllowedActionError(
          "Screen reader text entry is not available without a screen reader controller."
        );
      }

      const executeInternal = this.options.screenReaderController.executeInternal
        ?? this.options.screenReaderController.execute.bind(this.options.screenReaderController);
      const execution = await executeInternal({
        semantic: "type",
        text: inputValue
      });
      this.cost += execution.costDelta;
      return execution;
    }

    await this.page.keyboard.type(inputValue);
    this.cost += 1;
    return { ok: true, costDelta: 1 };
  }

  private async readTextEntryResult(expected: string): Promise<NonNullable<ExecutionRecord["textEntryResult"]>> {
    const snapshot = await this.page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) {
        return {
          observed: "",
          role: undefined,
          label: undefined,
          labelledByText: "",
          labelsText: "",
          placeholder: undefined,
          isSensitive: false
        };
      }

      const observed = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        ? active.value
        : active.isContentEditable
          ? active.textContent ?? ""
          : "";

      return {
        observed,
        role: active.getAttribute("role")
          ?? (active instanceof HTMLTextAreaElement
            ? "textbox"
            : active instanceof HTMLInputElement
              ? active.type || "text"
              : active.isContentEditable
                ? "textbox"
                : undefined),
        label: active.getAttribute("aria-label") ?? undefined,
        labelledByText: (active.getAttribute("aria-labelledby") ?? "")
          .split(/\s+/)
          .filter((id) => id.length > 0)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" "),
        labelsText: active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
          ? Array.from(active.labels ?? [])
            .map((label) => label.textContent ?? "")
            .join(" ")
          : "",
        placeholder: active.getAttribute("placeholder") ?? undefined,
        isSensitive: active instanceof HTMLInputElement && active.type.toLowerCase() === "password"
      };
    });

    const fieldLabel = normalizeText(snapshot.label)
      ?? normalizeText(snapshot.labelledByText)
      ?? normalizeText(snapshot.labelsText)
      ?? normalizeText(snapshot.placeholder);
    const fieldRole = normalizeText(snapshot.role);
    const verified = snapshot.observed === expected;

    return {
      expected,
      observed: snapshot.observed,
      verified,
      fieldLabel,
      fieldRole,
      isSensitive: snapshot.isSensitive,
      syntheticAnnouncement: verified
        ? buildSyntheticAnnouncement({
            value: expected,
            label: fieldLabel,
            role: fieldRole,
            isSensitive: snapshot.isSensitive
          })
        : undefined
    };
  }
}

function normalizeText(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  return trimmed ? trimmed.replace(/\s+/g, " ") : undefined;
}

function buildSyntheticAnnouncement(input: {
  value: string;
  label?: string;
  role?: string;
  isSensitive?: boolean;
}): string {
  const field = input.label ?? humanizeFieldRole(input.role);
  if (input.isSensitive) {
    return field ? `${field}, updated` : "Field updated";
  }

  return field ? `${field}, ${input.value}` : `Field updated, ${input.value}`;
}

function humanizeFieldRole(role: string | undefined): string | undefined {
  if (!role) {
    return undefined;
  }

  switch (role.toLowerCase()) {
    case "email":
      return "Email";
    case "search":
      return "Search";
    case "url":
      return "URL";
    case "textbox":
    case "text":
      return "Text field";
    default:
      return role;
  }
}
