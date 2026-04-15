import { z } from "zod";
import type {
  RequestVerificationRule,
  ResponseVerificationRule,
  VerifyRule,
  VerifySpec,
} from "./index";

const nonEmptyString = z.string().trim().min(1, "Must be a non-empty string.");

const verifyRuleSchemas = {
  titleIncludes: z.object({ titleIncludes: nonEmptyString }).strict(),
  urlIncludes: z.object({ urlIncludes: nonEmptyString }).strict(),
  textVisible: z.object({ textVisible: nonEmptyString }).strict(),
  requestSeen: z.object({
    requestSeen: z.object({
      urlIncludes: nonEmptyString,
      method: z.string().optional()
    }).strict()
  }).strict() as z.ZodType<RequestVerificationRule>,
  responseSeen: z.object({
    responseSeen: z.object({
      urlIncludes: nonEmptyString,
      method: z.string().optional(),
      status: z.number().optional()
    }).strict()
  }).strict() as z.ZodType<ResponseVerificationRule>
} satisfies Record<string, z.ZodType<VerifyRule>>;

const supportedVerifyRuleKeys = Object.keys(verifyRuleSchemas) as Array<keyof typeof verifyRuleSchemas>;

export function validateVerifySpec(raw: unknown): VerifySpec {
  if (raw === undefined || raw === null) {
    throw new Error('Task file must include verify with a non-empty "all" array.');
  }

  if (typeof raw !== "object" || !("all" in (raw as object))) {
    throw new Error('Task verify must be an object with a non-empty "all" array.');
  }

  const all = (raw as { all?: unknown }).all;
  if (!Array.isArray(all) || all.length === 0) {
    throw new Error('Task verify must include a non-empty "all" array.');
  }

  return {
    all: all.map((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new Error(`Task verify.all[${index}] must be an object with exactly one rule type.`);
      }

      const topLevelKeys = Object.keys(item as Record<string, unknown>);
      if (topLevelKeys.length !== 1) {
        throw new Error(`Task verify.all[${index}] must be an object with exactly one rule type.`);
      }

      const ruleKey = topLevelKeys[0] as string;
      if (!isSupportedVerifyRuleKey(ruleKey)) {
        throw new Error(
          `Unsupported verify rule: ${ruleKey}. Expected one of ${supportedVerifyRuleKeys.join(", ")}.`
        );
      }

      const result = verifyRuleSchemas[ruleKey].safeParse(item);
      if (!result.success) {
        throw new Error(formatVerifyRuleParseError(index, result.error.issues[0]));
      }

      return result.data;
    })
  };
}

function isSupportedVerifyRuleKey(value: string): value is keyof typeof verifyRuleSchemas {
  return value in verifyRuleSchemas;
}

function formatVerifyRuleParseError(index: number, issue: z.ZodIssue | undefined): string {
  if (!issue) {
    return `Task verify.all[${index}] is invalid.`;
  }

  const path = issue.path.map(String).join(".");
  const location = path
    ? `Task verify.all[${index}].${path}`
    : `Task verify.all[${index}]`;

  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.map((key) => `"${key}"`).join(", ");
    return `${location}: Unrecognized key ${keys}.`;
  }

  return `${location}: ${normalizeVerifyIssueMessage(issue.message)}`;
}

function normalizeVerifyIssueMessage(message: string): string {
  const normalized = message.replace(/^Invalid input:\s*/i, "");
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : normalized;
}
