import type { BrowserSession } from "../browser";
import type {
  RequestVerificationRule,
  ResolvedTask,
  ResponseVerificationRule,
  VerificationRecord,
  VerifyRule
} from "@rawstep/definition";

export const MAX_VERIFICATION_RETRIES = 2;

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
      return `Verification failed: expected visible text containing "${rule.textVisible}" was not observed.`;
    }

    return undefined;
  }

  if ("textVisibleExact" in rule) {
    const locator = browser.page.getByText(rule.textVisibleExact, { exact: true }).first();
    const count = await locator.count();
    const isVisible = count > 0 ? await locator.isVisible() : false;

    if (!isVisible) {
      return `Verification failed: expected exact visible text "${rule.textVisibleExact}" was not observed.`;
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
