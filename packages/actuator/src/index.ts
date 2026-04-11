import { createEmptyKeyCounts, isAllowedKey, type AllowedKey } from "@a11y-task/core";
import type { Page } from "playwright";

export class NotAllowedKeyError extends Error {
  constructor(key: string) {
    super(`Key "${key}" is not allowed in keyboard mode.`);
    this.name = "NotAllowedKeyError";
  }
}

export class Actuator {
  readonly keyCounts: Record<AllowedKey, number>;
  cost = 0;

  constructor(private readonly page: Page) {
    this.keyCounts = createEmptyKeyCounts();
  }

  async press(key: AllowedKey | string): Promise<void> {
    if (!isAllowedKey(key)) {
      throw new NotAllowedKeyError(key);
    }

    await this.page.keyboard.press(key);
    this.cost += 1;
    this.keyCounts[key] += 1;
  }
}
