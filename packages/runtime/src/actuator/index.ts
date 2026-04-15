import {
  type Action,
  type ExecutionRecord,
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
}

export class Actuator {
  readonly keyCounts: Record<AllowedKey, number>;
  cost = 0;

  constructor(
    private readonly page: Page,
    private readonly options: {
      screenReaderController?: ScreenReaderController;
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

    await this.page.keyboard.type(inputValue);
    this.cost += 1;
    return { ok: true, costDelta: 1 };
  }
}
