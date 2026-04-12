import type { AgentProvider } from "@a11y-task/agent";
import type { ScreenshotPolicy, Task, UserModel } from "@a11y-task/core";

export type CliRunOptions = {
  taskFile: string;
  mode?: UserModel;
  outDir: string;
  screenshotPolicy?: ScreenshotPolicy;
  verifierAutoComplete?: boolean;
  agentMemoryWindow?: number;
  agentMemoryAll?: boolean;
  includeExperienceSummary?: boolean;
  includeRationale?: boolean;
  provider?: AgentProvider;
  model?: string;
  baseURL?: string;
};

export type TaskFileShape = Partial<Task> & {
  url?: string;
  goal?: string;
  id?: string;
};

export function validateTaskInput(raw: unknown): Task["input"] {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error('Task input must be an object with a non-empty "text" field.');
  }

  const text = (raw as { text?: unknown }).text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error('Task input.text must be a non-empty string.');
  }

  return { text };
}

export function parseUserModel(value: unknown): UserModel {
  if (
    value === "keyboard"
    || value === "screenreader-strict"
    || value === "screenreader-hybrid"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported mode: ${String(value)}. Expected one of keyboard, screenreader-strict, screenreader-hybrid.`
  );
}

export function parseScreenshotPolicy(value: unknown): ScreenshotPolicy {
  if (
    value === "all"
    || value === "important"
    || value === "failure-only"
    || value === "none"
  ) {
    return value;
  }

  throw new Error(
    `Unsupported screenshot policy: ${String(value)}. Expected one of all, important, failure-only, none.`
  );
}
