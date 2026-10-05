import type { BrowserSession } from "../browser/index.js";
import type {
  PolicyAction,
  Observation,
  Task,
  VerificationRecord,
  VerificationRuleRecord,
  VerificationWitness,
  VerifyRuleType,
  VerifyRule
} from "@rawstep/core/contracts";

export const MAX_VERIFICATION_RETRIES = 2;

export type VerificationContext = {
  latestActivation?: {
    step: number;
    action: PolicyAction;
    observation: Observation;
  };
};

export async function verifyTask(
  task: Task,
  browser: BrowserSession,
  context?: VerificationContext
): Promise<VerificationRecord> {
  const failures: string[] = [];
  const rules: VerificationRuleRecord[] = [];
  for (const [ruleIndex, rule] of task.verify.all.entries()) {
    const result = await observeVerifyRule(rule, browser, context, true);
    rules.push({ ruleIndex, ...result });
    if (result.failure) {
      failures.push(result.failure);
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    rules
  };
}

export async function evaluateVerifyRule(
  rule: VerifyRule,
  browser: BrowserSession,
  context?: VerificationContext
): Promise<string | undefined> {
  return (await observeVerifyRule(rule, browser, context, false)).failure;
}

/** Collect once so reported grounds describe the observations used for the decision. */
async function observeVerifyRule(
  rule: VerifyRule,
  browser: BrowserSession,
  context: VerificationContext | undefined,
  collectWitnesses: boolean
): Promise<Omit<VerificationRuleRecord, 'ruleIndex'>> {
  const result = (ruleType: VerifyRuleType, failure: string | undefined, witnesses: VerificationWitness[] = []): Omit<VerificationRuleRecord, 'ruleIndex'> => ({
    ruleType, passed: failure === undefined, ...(failure ? { failure } : {}), witnesses: collectWitnesses ? witnesses : []
  });
  if ("titleIncludes" in rule) {
    const title = await browser.page.title();
    return result('titleIncludes', title.includes(rule.titleIncludes) ? undefined :
      `Verification failed: expected title to include "${rule.titleIncludes}".`, [{ kind: 'title', title }]);
  }

  if ("urlIncludes" in rule) {
    const url = browser.page.url();
    return result('urlIncludes', url.includes(rule.urlIncludes) ? undefined :
      `Verification failed: expected URL to include "${rule.urlIncludes}".`, [{ kind: 'url', url }]);
  }

  if ("textVisible" in rule || "textVisibleExact" in rule) {
    const exact = 'textVisibleExact' in rule;
    const expected = exact ? rule.textVisibleExact : rule.textVisible;
    const ruleType = exact ? 'textVisibleExact' : 'textVisible';
    const locator = browser.page.getByText(expected, { exact });
    const count = await locator.count();
    for (let index = 0; index < count; index++) {
      const match = locator.nth(index);
      if (await match.isVisible()) {
        // Reading the matched node, rather than repeating the expected string, makes
        // partial matches inspectable without fabricating page text from the task.
        const observedText = collectWitnesses ? await match.evaluate((element) => {
          // Playwright also matches input buttons by their displayed value. These
          // controls have no text child, so textContent alone would erase the match.
          if (element instanceof HTMLInputElement && ['submit', 'button'].includes(element.type)) {
            return { text: element.value, textSource: 'input-value' as const };
          }
          return { text: element.textContent, textSource: 'text-content' as const };
        }) : undefined;
        const witnesses: VerificationWitness[] = observedText ? [{
          kind: 'visible-text', ...observedText, matchIndex: index, visible: true
        }] : [];
        return result(ruleType, undefined, witnesses);
      }
    }
    return result(ruleType, exact
      ? `Verification failed: expected exact visible text "${expected}" was not observed.`
      : `Verification failed: expected visible text containing "${expected}" was not observed.`);
  }

  if ("activatedAnnouncementIncludes" in rule) {
    const activation = context?.latestActivation;
    if (!activation || activation.observation.kind !== 'screenreader') {
      return result('activatedAnnouncementIncludes', formatActivatedAnnouncementMissingFailure(rule.activatedAnnouncementIncludes));
    }
    const { observation } = activation;
    const observedAnnouncement = observation.speech.join('\n').trim();
    const failure = observedAnnouncement.includes(rule.activatedAnnouncementIncludes) ? undefined :
      `Verification failed: expected output collected in the latest activation window to include "${rule.activatedAnnouncementIncludes}", no matching output was recorded in that window.`;
    return result('activatedAnnouncementIncludes', failure, observedAnnouncement ? [{
      kind: 'activation-speech', ...(observation.provenance ? { provenance: observation.provenance } : {}), speech: [...observation.speech], outputEventIds: [...observation.outputEventIds],
      activationStep: activation.step, window: { ...observation.window }, association: 'temporal-only'
    }] : []);
  }

  if ("domEventSeen" in rule) {
    const expected = rule.domEventSeen;
    const matched = browser.domEvents.find((event) => event.selector === expected.selector && event.event === expected.event);
    const observed = matched ? [matched] : browser.domEvents.filter((event) => event.selector === expected.selector);
    return result('domEventSeen', matched ? undefined :
      `Verification failed: expected event "${expected.event}" on selector "${expected.selector}" was not observed.`,
    observed.map(({ selector, event, url, timestamp }) => ({ kind: 'dom-event', selector, event, url, timestamp })));
  }

  if ("requestSeen" in rule) {
    const expected = rule.requestSeen;
    const candidates = browser.network.requests.filter((request) => request.url.includes(expected.urlIncludes));
    const matched = candidates.find((request) => matchesMethod(request.method, expected.method));
    return result('requestSeen', matched ? undefined : formatRequestFailure(expected.urlIncludes, expected.method),
      (matched ? [matched] : candidates).map(({ url, method, timestamp }) => ({ kind: 'request', url, method, timestamp })));
  }

  const expected = rule.responseSeen;
  const candidates = browser.network.responses.filter((response) => response.url.includes(expected.urlIncludes));
  const matched = candidates.find((response) => matchesMethod(response.method, expected.method)
    && (expected.status === undefined || response.status === expected.status));
  return result('responseSeen', matched ? undefined : formatResponseFailure(expected.urlIncludes, expected.method, expected.status),
    (matched ? [matched] : candidates).map(({ url, method, status, ok, timestamp }) => ({ kind: 'response', url, method, status, ok, timestamp })));
}

export function formatVerificationFeedback(result: VerificationRecord): string {
  if (result.passed || result.failures.length === 0) {
    return "Verification passed.";
  }

  return result.failures[0];
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
  return `Verification failed: no screenreader activation-window output including "${expected}" was recorded.`;
}
