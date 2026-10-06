import type { BrowserSession } from "../browser/index.js";
import type { ObserverEvent } from "../observer/index.js";
import { matchesText } from "@rawstep/core/contracts";
import { runScriptCheck } from "./script.js";
export { runScriptCheck, SCRIPT_TIMEOUT_MS } from "./script.js";
export type { ScriptCheckResult } from "./script.js";
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
  /** Page observer changes recorded so far in this run, unredacted; never visible to the policy. */
  timeline?: readonly ObserverEvent[];
};

export async function verifyTask(
  task: Task,
  browser: BrowserSession,
  context?: VerificationContext
): Promise<VerificationRecord> {
  const failures: string[] = [];
  const rules: VerificationRuleRecord[] = [];
  for (const [ruleIndex, rule] of task.verify.all.entries()) {
    const { unavailable: _unavailable, ...result } = await observeVerifyRule(rule, browser, context, true);
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
type ObservedRule = Omit<VerificationRuleRecord, 'ruleIndex'> & { unavailable?: true };

async function observeVerifyRule(
  rule: VerifyRule,
  browser: BrowserSession,
  context: VerificationContext | undefined,
  collectWitnesses: boolean
): Promise<ObservedRule> {
  const result = (ruleType: VerifyRuleType, failure: string | undefined, witnesses: VerificationWitness[] = []): ObservedRule => ({
    ruleType, passed: failure === undefined, ...(failure ? { failure } : {}), witnesses: collectWitnesses ? witnesses : []
  });
  // Unobservable is not the same as "did not happen": `not` must fail closed on it.
  const unavailable = (ruleType: VerifyRuleType, failure: string): ObservedRule => ({ ...result(ruleType, failure), unavailable: true });
  if ("event" in rule) {
    const timeline = context?.timeline;
    if (!timeline) return unavailable('event', 'Verification failed: page observer events are unavailable, so event rules cannot be checked.');
    const from = rule.after === 'lastActivation' ? context?.latestActivation?.step : 1;
    if (from === undefined) return result('event', 'Verification failed: no activation has happened yet for an after: lastActivation event rule.');
    const expected = rule.event;
    const matches = timeline.filter(event => event.step >= from && event.kind === expected.kind && (expected.role === undefined || event.role === expected.role)
      && (expected.attr === undefined || event.attr === expected.attr) && (expected.value === undefined || event.value === expected.value)
      && (expected.name === undefined || matchesText(expected.name, event.name)) && (expected.text === undefined || matchesText(expected.text, event.text))
      && (expected.url === undefined || matchesText(expected.url, event.url)));
    return result('event', matches.length ? undefined : `Verification failed: no ${expected.kind} change matching the rule was observed ${rule.after === 'lastActivation' ? 'since the last activation' : 'after the initial load'}.`,
      matches.slice(0, 5).map(observerWitness));
  }

  if ("focused" in rule) {
    const latest = currentFocus(context?.timeline ?? []);
    if (!context?.timeline) return unavailable('focused', 'Verification failed: page observer events are unavailable, so focus rules cannot be checked.');
    const matched = latest?.kind === 'focus' && (rule.focused.role === undefined || latest.role === rule.focused.role) && (rule.focused.name === undefined || matchesText(rule.focused.name, latest.name));
    return result('focused', matched ? undefined : `Verification failed: keyboard focus is ${latest?.kind === 'focus' ? 'on a different element' : 'not on any recorded element'}.`, latest ? [observerWitness(latest)] : []);
  }

  if ("not" in rule) {
    const inner = await observeVerifyRule(rule.not, browser, context, collectWitnesses);
    if (inner.unavailable) return unavailable('not', `Verification failed: the absence of a ${inner.ruleType} change cannot be established without its evidence source.`);
    // When the inner rule holds, its witnesses are the evidence of the violation.
    return result('not', inner.passed ? `Verification failed: a ${inner.ruleType} rule that must not hold was observed.` : undefined, inner.passed ? inner.witnesses : []);
  }

  if ("any" in rule) {
    const inner = [];
    for (const child of rule.any) inner.push(await observeVerifyRule(child, browser, context, collectWitnesses));
    const passed = inner.filter(child => child.passed);
    if (!passed.length && inner.every(child => child.unavailable)) return unavailable('any', `Verification failed: none of ${inner.length} alternative rules could be checked.`);
    return result('any', passed.length ? undefined : `Verification failed: none of ${inner.length} alternative rules held.`, passed.flatMap(child => child.witnesses));
  }

  if ("script" in rule) {
    const { description, source } = rule.script;
    // The observer timeline is the event history a script may reason about; no timeline means an empty one.
    const checked = await runScriptCheck(browser.page, source, { timeline: (context?.timeline ?? []).map(event => observerWitnessEvent(event)) });
    const witness: VerificationWitness = { kind: 'script', description, result: checked.result, ...('error' in checked ? { error: checked.error } : {}) };
    if (checked.result === null) return { ...result('script', `Verification failed: the script check could not decide (${'error' in checked ? checked.error : 'unknown'}).`, [witness]), unavailable: true };
    return result('script', checked.result ? undefined : `Verification failed: the script check returned false (${description}).`, [witness]);
  }

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

function observerWitness(event: ObserverEvent): VerificationWitness {
  return { kind: 'observer-event', event: observerWitnessEvent(event) };
}
function observerWitnessEvent(event: ObserverEvent) {
  const { kind, step, role, name, text, attr, value, url, sameDocument } = event;
  return { kind, step, ...(role !== undefined ? { role } : {}), ...(name !== undefined ? { name } : {}), ...(text !== undefined ? { text } : {}), ...(attr !== undefined ? { attr } : {}), ...(value !== undefined ? { value } : {}), ...(url !== undefined ? { url } : {}), ...(sameDocument !== undefined ? { sameDocument } : {}) };
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

/**
 * The focus record that still holds at the end of the timeline. A later focus-lost, a cross-document navigation,
 * or the page losing focus (without regaining it) ends an earlier focus record.
 */
function currentFocus(timeline: readonly ObserverEvent[]): ObserverEvent | undefined {
  let regained = false;
  for (let index = timeline.length - 1; index >= 0; index--) {
    const event = timeline[index]!;
    if (event.kind === 'focus' || event.kind === 'focus-lost') return event;
    if (event.kind === 'navigation' && event.sameDocument === false) return event;
    if (event.kind === 'page-focus') regained = true;
    else if (event.kind === 'page-blur') { if (!regained) return event; regained = false; }
  }
  return undefined;
}
