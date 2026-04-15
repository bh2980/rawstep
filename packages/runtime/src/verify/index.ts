import { z } from "zod";
import type { BrowserSession } from "../browser";
import type {
  RequestVerificationRule,
  ResolvedTask,
  ResponseVerificationRule,
  VerificationRecord,
  VerifyRule,
  VerifySpec
} from "@rawstep/definition";

export const MAX_VERIFICATION_RETRIES = 2;

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

export async function verifyTask(
  task: ResolvedTask,
  browser: BrowserSession
): Promise<VerificationRecord> {
  const failures: string[] = [];
  for (const rule of task.verify.all) {
    const failure = await evaluateVerifyRule(rule, browser);
    if (failure) {
      failures.push(failure);
    }
  }

  return {
    passed: failures.length === 0,
    failures
  };
}

export async function evaluateVerifyRule(
  rule: VerifyRule,
  browser: BrowserSession
): Promise<string | undefined> {
  if ("titleIncludes" in rule) {
    const title = await browser.page.title();
    if (!title.includes(rule.titleIncludes)) {
      return `Verification failed: expected title to include "${rule.titleIncludes}".`;
    }
    return undefined;
  }

  if ("urlIncludes" in rule) {
    const url = browser.page.url();
    if (!url.includes(rule.urlIncludes)) {
      return `Verification failed: expected URL to include "${rule.urlIncludes}".`;
    }
    return undefined;
  }

  if ("textVisible" in rule) {
    const locator = browser.page.getByText(rule.textVisible, { exact: false }).first();
    const count = await locator.count();
    const isVisible = count > 0 ? await locator.isVisible() : false;

    if (!isVisible) {
      return `Verification failed: expected visible text "${rule.textVisible}" was not observed.`;
    }

    return undefined;
  }

  if ("requestSeen" in rule) {
    return matchRequestRule(rule, browser);
  }

  return matchResponseRule(rule as ResponseVerificationRule, browser);
}

export function formatVerificationFeedback(result: VerificationRecord): string {
  if (result.passed || result.failures.length === 0) {
    return "Verification passed.";
  }

  return result.failures[0];
}

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

function matchRequestRule(
  rule: RequestVerificationRule,
  browser: BrowserSession
): string | undefined {
  const matched = browser.network.requests.some((request) =>
    request.url.includes(rule.requestSeen.urlIncludes)
    && matchesMethod(request.method, rule.requestSeen.method)
  );

  if (!matched) {
    return formatRequestFailure(rule.requestSeen.urlIncludes, rule.requestSeen.method);
  }

  return undefined;
}

function matchResponseRule(
  rule: ResponseVerificationRule,
  browser: BrowserSession
): string | undefined {
  const matched = browser.network.responses.some((response) =>
    response.url.includes(rule.responseSeen.urlIncludes)
    && matchesMethod(response.method, rule.responseSeen.method)
    && (rule.responseSeen.status === undefined || response.status === rule.responseSeen.status)
  );

  if (!matched) {
    return formatResponseFailure(
      rule.responseSeen.urlIncludes,
      rule.responseSeen.method,
      rule.responseSeen.status
    );
  }

  return undefined;
}

function matchesMethod(actual: string, expected?: string): boolean {
  return expected === undefined || actual.toUpperCase() === expected.toUpperCase();
}

function formatRequestFailure(urlIncludes: string, method?: string): string {
  return method
    ? `Verification failed: no matching ${method.toUpperCase()} request for "${urlIncludes}" was observed.`
    : `Verification failed: no matching request for "${urlIncludes}" was observed.`;
}

function formatResponseFailure(urlIncludes: string, method?: string, status?: number): string {
  const methodPart = method ? `${method.toUpperCase()} ` : "";
  const statusPart = status !== undefined ? ` with status ${status}` : "";
  return `Verification failed: no matching ${methodPart}response for "${urlIncludes}"${statusPart} was observed.`;
}
