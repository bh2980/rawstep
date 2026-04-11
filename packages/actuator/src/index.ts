import { createEmptyKeyCounts, isAllowedKey, type Action, type AllowedKey, type TaskInput } from "@a11y-task/core";
import type { Page } from "playwright";

export class NotAllowedActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAllowedActionError";
  }
}

export type ActionExecutionResult = {
  ok: boolean;
  costDelta: number;
  error?: string;
};

export class Actuator {
  readonly keyCounts: Record<AllowedKey, number>;
  cost = 0;

  constructor(private readonly page: Page) {
    this.keyCounts = createEmptyKeyCounts();
  }

  async press(key: AllowedKey | string): Promise<void> {
    if (!isAllowedKey(key)) {
      throw new NotAllowedActionError(`Key "${key}" is not allowed in keyboard mode.`);
    }

    await this.page.keyboard.press(key);
    this.cost += 1;
    this.keyCounts[key] += 1;
  }

  async execute(action: Action, taskInput?: TaskInput): Promise<ActionExecutionResult> {
    if ("key" in action) {
      await this.press(action.key);
      return { ok: true, costDelta: 1 };
    }

    if (!taskInput) {
      throw new NotAllowedActionError("Task-scoped text input is not enabled for this task.");
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

    await this.page.keyboard.type(taskInput.text);
    this.cost += 1;
    return { ok: true, costDelta: 1 };
  }
}
