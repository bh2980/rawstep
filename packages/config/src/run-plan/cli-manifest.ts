import {
  formatScreenReaderBackendIdList,
  parseScreenReaderBackendId,
  parseUserModel,
  USER_MODEL_VALUES,
  type ScreenReaderBackendId,
  type ScreenshotPolicy,
  type UserModel
} from "@rawstep/definition";
import {
  parseCommaSeparatedConfiguredScreenReaderActions,
} from "../screenreader-actions";
import {
  AGENT_PROVIDER_VALUES,
  parseAgentProvider,
  type AgentProvider,
} from "../project/provider";
import {
  parseAllowedKeyNames,
  parseOptionalNonNegativeInteger,
  parseScreenshotPolicy,
  SCREENSHOT_POLICY_VALUES,
} from "../project/schema";
import type { RunPlanCliOverrides } from "./precedence";

type RunCommandArgField = Exclude<keyof RunPlanCliOverrides, "taskFile">;

export type RunCommandArgValueManifestEntry = {
  kind: "value";
  flag: string;
  field: RunCommandArgField;
  placeholder: string;
  parse: (value: string, label: string) => RunPlanCliOverrides[RunCommandArgField];
  resolvePath?: boolean;
};

export type RunCommandArgToggleManifestEntry = {
  kind: "toggle";
  flag: string;
  negativeFlag?: string;
  field: RunCommandArgField;
  positiveValue: RunPlanCliOverrides[RunCommandArgField];
  negativeValue?: RunPlanCliOverrides[RunCommandArgField];
};

export type RunCommandArgManifestEntry =
  | RunCommandArgValueManifestEntry
  | RunCommandArgToggleManifestEntry;

const MODE_USAGE = USER_MODEL_VALUES.join("|");
const BACKEND_USAGE = formatScreenReaderBackendIdList("|");
const PROVIDER_USAGE = AGENT_PROVIDER_VALUES.join("|");
const SCREENSHOT_USAGE = SCREENSHOT_POLICY_VALUES.join("|");

export const RUN_COMMAND_ARG_MANIFEST = [
  {
    kind: "value",
    flag: "--config",
    field: "configFile",
    placeholder: "<rawstep.config.ts>",
    parse: parseConfigFilePath,
    resolvePath: true
  },
  {
    kind: "value",
    flag: "--mode",
    field: "mode",
    placeholder: MODE_USAGE,
    parse: (value) => parseUserModel(value) as UserModel
  },
  {
    kind: "value",
    flag: "--out",
    field: "outDir",
    placeholder: "<dir>",
    parse: parseIdentityString,
    resolvePath: true
  },
  {
    kind: "toggle",
    flag: "--headless",
    negativeFlag: "--headed",
    field: "headless",
    positiveValue: true,
    negativeValue: false
  },
  {
    kind: "value",
    flag: "--screenshots",
    field: "screenshotPolicy",
    placeholder: SCREENSHOT_USAGE,
    parse: (value) => parseScreenshotPolicy(value) as ScreenshotPolicy
  },
  {
    kind: "value",
    flag: "--max-steps",
    field: "maxSteps",
    placeholder: "<n>",
    parse: (value, label) => parseOptionalNonNegativeInteger(value, label)
  },
  {
    kind: "value",
    flag: "--timeout-ms",
    field: "timeoutMs",
    placeholder: "<n>",
    parse: (value, label) => parseOptionalNonNegativeInteger(value, label)
  },
  {
    kind: "value",
    flag: "--screen-reader-backend",
    field: "screenReaderBackendId",
    placeholder: BACKEND_USAGE,
    parse: (value, label) => parseScreenReaderBackendId(value, label) as ScreenReaderBackendId
  },
  {
    kind: "value",
    flag: "--allowed-keys",
    field: "allowedKeys",
    placeholder: "<key1,key2>",
    parse: (value, label) => parseAllowedKeyNames(parseCommaSeparatedValues(value, label), label)
  },
  {
    kind: "value",
    flag: "--allowed-screen-reader-actions",
    field: "allowedScreenReaderActions",
    placeholder: "<sr.token1,sr.token2>",
    parse: (value, label) => parseCommaSeparatedConfiguredScreenReaderActions(value, label)
  },
  {
    kind: "toggle",
    flag: "--verifier-auto-complete",
    negativeFlag: "--no-verifier-auto-complete",
    field: "verifierAutoComplete",
    positiveValue: true,
    negativeValue: false
  },
  {
    kind: "value",
    flag: "--agent-memory-window",
    field: "agentMemoryWindow",
    placeholder: "<n>",
    parse: (value, label) => parseOptionalNonNegativeInteger(value, label)
  },
  {
    kind: "toggle",
    flag: "--agent-memory-all",
    negativeFlag: "--no-agent-memory-all",
    field: "agentMemoryAll",
    positiveValue: true,
    negativeValue: false
  },
  {
    kind: "toggle",
    flag: "--include-experience-summary",
    negativeFlag: "--no-include-experience-summary",
    field: "includeExperienceSummary",
    positiveValue: true,
    negativeValue: false
  },
  {
    kind: "toggle",
    flag: "--include-rationale",
    negativeFlag: "--no-include-rationale",
    field: "includeRationale",
    positiveValue: true,
    negativeValue: false
  },
  {
    kind: "value",
    flag: "--provider",
    field: "provider",
    placeholder: PROVIDER_USAGE,
    parse: (value) => parseAgentProvider(value) as AgentProvider
  },
  {
    kind: "value",
    flag: "--model",
    field: "model",
    placeholder: "<id>",
    parse: parseIdentityString
  },
  {
    kind: "value",
    flag: "--base-url",
    field: "baseURL",
    placeholder: "<url>",
    parse: parseIdentityString
  }
] as const satisfies readonly RunCommandArgManifestEntry[];

export function formatRunCommandUsage(command = "rawstep run"): string {
  const optionSegments = RUN_COMMAND_ARG_MANIFEST.map((entry) => {
    if (entry.kind === "value") {
      return `[${entry.flag} ${entry.placeholder}]`;
    }

    const toggleEntry = entry as RunCommandArgToggleManifestEntry;

    if (toggleEntry.negativeFlag) {
      return `[${toggleEntry.flag}|${toggleEntry.negativeFlag}]`;
    }

    return `[${toggleEntry.flag}]`;
  });

  return `Usage: ${command} <task-file>${optionSegments.length > 0 ? ` ${optionSegments.join(" ")}` : ""}`;
}

function parseConfigFilePath(value: string): string {
  if (!value.endsWith(".ts")) {
    throw new Error("--config only accepts rawstep.config.ts files.");
  }

  return value;
}

function parseIdentityString(value: string): string {
  return value;
}

function parseCommaSeparatedValues(value: unknown, label: string): string[] {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a comma-separated string.`);
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error(`${label} must include at least one value.`);
  }

  return entries;
}
