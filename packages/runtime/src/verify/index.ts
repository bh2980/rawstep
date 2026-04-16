import type { BrowserSession } from "../browser";
import type {
  Action,
  ActivatedAnnouncementVerificationRule,
  DomEventVerificationRule,
  Observation,
  RequestVerificationRule,
  ResolvedTask,
  ResponseVerificationRule,
  VerificationRecord,
  VerifyRule
} from "@rawstep/definition";

export const MAX_VERIFICATION_RETRIES = 2;

export type VerificationContext = {
  latestActivation?: {
    step: number;
    action: Action;
    observation: Observation;
  };
};

export async function verifyTask(
  task: ResolvedTask,
  browser: BrowserSession,
  context?: VerificationContext
): Promise<VerificationRecord> {
  const failures: string[] = [];
  for (const rule of task.verify.all) {
    const failure = await evaluateVerifyRule(rule, browser, context);
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
  browser: BrowserSession,
  context?: VerificationContext
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

  if ("activatedAnnouncementIncludes" in rule) {
    return matchActivatedAnnouncementRule(rule, context);
  }

  if ("domEventSeen" in rule) {
    return matchDomEventRule(rule, browser);
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

function matchActivatedAnnouncementRule(
  rule: ActivatedAnnouncementVerificationRule,
  context?: VerificationContext
): string | undefined {
  const latestActivation = context?.latestActivation;

  if (!latestActivation) {
    return formatActivatedAnnouncementMissingFailure(rule.activatedAnnouncementIncludes);
  }

  if (latestActivation.observation.kind !== "screenreader") {
    return formatActivatedAnnouncementMissingFailure(rule.activatedAnnouncementIncludes);
  }

  const observedAnnouncement = latestActivation.observation.announcement.trim();
  if (observedAnnouncement.includes(rule.activatedAnnouncementIncludes)) {
    return undefined;
  }

  return `Verification failed: expected latest activation announcement to include "${rule.activatedAnnouncementIncludes}", observed "${observedAnnouncement || "(empty)"}".`;
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

function matchDomEventRule(
  rule: DomEventVerificationRule,
  browser: BrowserSession
): string | undefined {
  const matched = browser.domEvents.some((event) =>
    event.selector === rule.domEventSeen.selector
    && event.event === rule.domEventSeen.event
  );

  if (!matched) {
    return `Verification failed: expected event "${rule.domEventSeen.event}" on selector "${rule.domEventSeen.selector}" was not observed.`;
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

function formatActivatedAnnouncementMissingFailure(expected: string): string {
  return `Verification failed: no screenreader activation announcement including "${expected}" was recorded.`;
}
