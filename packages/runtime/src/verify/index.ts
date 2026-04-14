import type { BrowserSession } from "../browser";
import type {
  RequestVerificationRule,
  ResponseVerificationRule,
  Task,
  VerificationRecord,
  VerifyRule,
  VerifySpec
} from "@rawstep/core";

export const MAX_VERIFICATION_RETRIES = 2;

export async function verifyTask(
  task: Task,
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

  return matchResponseRule(rule, browser);
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

  if (typeof raw !== "object" || !("all" in raw)) {
    throw new Error('Task verify must be an object with a non-empty "all" array.');
  }

  const all = (raw as { all?: unknown }).all;
  if (!Array.isArray(all) || all.length === 0) {
    throw new Error('Task verify must include a non-empty "all" array.');
  }

  return {
    all: all.map((item) => validateVerifyRule(item))
  };
}

function validateVerifyRule(raw: unknown): VerifyRule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Each verify rule must be an object.");
  }

  const entries = Object.entries(raw);
  if (entries.length !== 1) {
    throw new Error("Each verify rule must contain exactly one rule type.");
  }

  const [key, value] = entries[0];
  if (key === "titleIncludes" || key === "urlIncludes" || key === "textVisible") {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Verify rule "${key}" must be a non-empty string.`);
    }

    return { [key]: value } as VerifyRule;
  }

  if (key === "requestSeen") {
    return { requestSeen: validateRequestRule(value) };
  }

  if (key === "responseSeen") {
    return { responseSeen: validateResponseRule(value) };
  }

  throw new Error(`Unsupported verify rule: ${key}.`);
}

function validateRequestRule(raw: unknown): RequestVerificationRule["requestSeen"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error('Verify rule "requestSeen" must be an object.');
  }

  const urlIncludes = (raw as { urlIncludes?: unknown }).urlIncludes;
  const method = (raw as { method?: unknown }).method;

  if (typeof urlIncludes !== "string" || !urlIncludes.trim()) {
    throw new Error('Verify rule "requestSeen.urlIncludes" must be a non-empty string.');
  }

  if (method !== undefined && typeof method !== "string") {
    throw new Error('Verify rule "requestSeen.method" must be a string when provided.');
  }

  return {
    urlIncludes,
    method
  };
}

function validateResponseRule(raw: unknown): ResponseVerificationRule["responseSeen"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error('Verify rule "responseSeen" must be an object.');
  }

  const urlIncludes = (raw as { urlIncludes?: unknown }).urlIncludes;
  const method = (raw as { method?: unknown }).method;
  const status = (raw as { status?: unknown }).status;

  if (typeof urlIncludes !== "string" || !urlIncludes.trim()) {
    throw new Error('Verify rule "responseSeen.urlIncludes" must be a non-empty string.');
  }

  if (method !== undefined && typeof method !== "string") {
    throw new Error('Verify rule "responseSeen.method" must be a string when provided.');
  }

  if (status !== undefined && typeof status !== "number") {
    throw new Error('Verify rule "responseSeen.status" must be a number when provided.');
  }

  return {
    urlIncludes,
    method,
    status
  };
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
