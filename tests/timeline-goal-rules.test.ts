import { describe, expect, it } from 'vitest';
import { evaluateVerifyRule, verifyTask, type VerificationContext } from '@rawstep/browser/verify';
import type { BrowserSession } from '@rawstep/browser/browser';
import type { ObserverEvent } from '@rawstep/browser/observer';
import { matchesText, resolveTask, type Task, type TextMatcher, type VerifyRule } from '@rawstep/core/contracts';

const raw = (...all: unknown[]) => ({ url: 'https://example.test', goal: 'Verify timeline rules', verify: { all } });
const accepted = (rule: unknown) => resolveTask(raw(rule)).verify.all[0];
const rejected = (rule: unknown, message?: RegExp) => expect(() => resolveTask(raw(rule))).toThrow(message);
const nest = (depth: number, leaf: unknown): unknown => depth === 0 ? leaf : { not: nest(depth - 1, leaf) };

describe('timeline goal rule validation', () => {
  it('accepts event rules with every field and either after value', () => {
    const rule = { event: { kind: 'appeared', role: 'alert', name: { regex: 'cart', flags: 'i' }, text: { equals: 'Done' }, attr: 'aria-expanded', value: 'true', url: { includes: '/cart' } }, after: 'lastActivation' };
    expect(accepted(rule)).toEqual(rule);
    expect(accepted({ event: { kind: 'focus' } })).toEqual({ event: { kind: 'focus' } });
    expect(accepted({ event: { kind: 'state' }, after: 'start' })).toEqual({ event: { kind: 'state' }, after: 'start' });
    for (const kind of ['focus', 'focus-lost', 'appeared', 'disappeared', 'live-region', 'state', 'submit', 'navigation']) expect(accepted({ event: { kind } })).toEqual({ event: { kind } });
  });
  it('accepts focused, not, any and nested combinations', () => {
    expect(accepted({ focused: { role: 'button' } })).toEqual({ focused: { role: 'button' } });
    expect(accepted({ focused: { name: 'Save' } })).toEqual({ focused: { name: 'Save' } });
    expect(accepted({ focused: { role: 'button', name: { equals: 'Save' } } })).toEqual({ focused: { role: 'button', name: { equals: 'Save' } } });
    expect(accepted({ not: { event: { kind: 'focus-lost' } } })).toEqual({ not: { event: { kind: 'focus-lost' } } });
    const nested = { any: [{ not: { titleIncludes: 'Error' } }, { any: [{ focused: { role: 'dialog' } }, { urlIncludes: '/done' }] }] };
    expect(accepted(nested)).toEqual(nested);
    expect(accepted({ any: Array.from({ length: 20 }, () => ({ titleIncludes: 'x' })) })).toMatchObject({ any: expect.any(Array) });
  });
  it('allows four levels of nesting and rejects a fifth', () => {
    expect(accepted(nest(4, { titleIncludes: 'x' }))).toEqual(nest(4, { titleIncludes: 'x' }));
    rejected(nest(5, { titleIncludes: 'x' }), /nest at most four/);
    rejected({ any: [{ any: [{ any: [{ any: [{ any: [{ titleIncludes: 'x' }] }] }] }] }] }, /nest at most four/);
  });
  it('rejects malformed event rules', () => {
    rejected({ event: { kind: 'click' } }, /event\.kind/);
    rejected({ event: {} }, /event\.kind/);
    rejected({ event: { kind: 'focus' }, after: 'end' }, /after/);
    rejected({ event: { kind: 'focus' }, after: 1 }, /after/);
    rejected({ event: { kind: 'focus', selector: '#a' } }, /unsupported field selector/);
    rejected({ event: { kind: 'focus' }, extra: true }, /unsupported field extra/);
    rejected({ event: 'focus' }, /event object/);
    rejected({ event: { kind: 'focus', role: '' } }, /event\.role/);
    rejected({ event: { kind: 'state', attr: ' ' } }, /event\.attr/);
    rejected({ event: { kind: 'state', value: 5 } }, /event\.value/);
  });
  it('rejects malformed focused, not and any rules', () => {
    rejected({ focused: {} }, /role and\/or name/);
    rejected({ focused: 'button' }, /role and\/or name/);
    rejected({ focused: { role: 'button', tag: 'a' } }, /unsupported field tag/);
    rejected({ focused: { role: '' } }, /focused\.role/);
    rejected({ focused: { name: { includes: '' } } }, /focused\.name/);
    rejected({ focused: { role: 'button' }, not: { titleIncludes: 'x' } }, /one supported rule/);
    rejected({ not: { unknown: 1 } }, /Unsupported verification rule/);
    rejected({ not: [] }, /one supported rule/);
    rejected({ any: [] }, /1 to 20/);
    rejected({ any: Array.from({ length: 21 }, () => ({ titleIncludes: 'x' })) }, /1 to 20/);
    rejected({ any: 'x' }, /1 to 20/);
    rejected({ any: [{ titleIncludes: 'x' }, { focused: {} }] }, /role and\/or name/);
  });
  it('rejects malformed text matchers', () => {
    const name = (matcher: unknown) => ({ event: { kind: 'appeared', name: matcher } });
    rejected(name({ includes: 'a', equals: 'b' }), /exactly one/);
    rejected(name({ equals: 'a', regex: 'b' }), /unsupported field equals/);
    rejected(name({ regex: 'a', includes: 'b' }), /unsupported field includes/);
    rejected(name({}), /string or one of/);
    rejected(name({ other: 'a' }), /exactly one/);
    rejected(name(''), /event\.name/);
    rejected(name({ includes: '' }), /event\.name/);
    rejected(name({ equals: 5 }), /event\.name/);
    rejected(name(5), /string or one of/);
    rejected(name('x'.repeat(201)), /at most 200/);
    rejected(name({ includes: 'x'.repeat(201) }), /at most 200/);
    rejected(name({ regex: 'x'.repeat(201) }), /at most 200/);
    rejected(name({ regex: '(' }), /not a valid regular expression/);
    rejected(name({ regex: 'a', flags: 'g' }), /flags/);
    rejected(name({ regex: 'a', flags: 'y' }), /flags/);
    rejected(name({ regex: 'a', flags: 5 }), /flags/);
    rejected({ event: { kind: 'appeared', text: { regex: '[' } } }, /event\.text\.regex/);
    rejected({ event: { kind: 'navigation', url: { equals: '' } } }, /event\.url/);
    expect(() => resolveTask(raw(name('x'.repeat(200))))).not.toThrow();
    expect(accepted(name({ regex: 'a', flags: 'imsu' }))).toEqual(name({ regex: 'a', flags: 'imsu' }));
    expect(accepted(name({ regex: 'a' }))).toEqual(name({ regex: 'a' }));
  });
  it('still validates existing rules next to the new ones', () => {
    expect(resolveTask(raw({ titleIncludes: 'a' }, { event: { kind: 'focus' } })).verify.all).toHaveLength(2);
    rejected({ titleIncludes: 'a', event: { kind: 'focus' } }, /unsupported field titleIncludes/);
  });
});

describe('matchesText', () => {
  it('treats a plain string and includes as case-sensitive substring tests', () => {
    expect(matchesText('cart', 'Added to cart')).toBe(true);
    expect(matchesText('Cart', 'Added to cart')).toBe(false);
    expect(matchesText({ includes: 'to car' }, 'Added to cart')).toBe(true);
    expect(matchesText({ includes: 'x' }, 'Added to cart')).toBe(false);
  });
  it('equals needs the whole string', () => {
    expect(matchesText({ equals: 'Added to cart' }, 'Added to cart')).toBe(true);
    expect(matchesText({ equals: 'Added' }, 'Added to cart')).toBe(false);
    expect(matchesText({ equals: 'added to cart' }, 'Added to cart')).toBe(false);
    expect(matchesText({ equals: ' Added to cart' }, 'Added to cart')).toBe(false);
  });
  it('regex searches anywhere and honours flags', () => {
    expect(matchesText({ regex: 'to\\s+cart' }, 'Added to  cart')).toBe(true);
    expect(matchesText({ regex: 'CART' }, 'Added to cart')).toBe(false);
    expect(matchesText({ regex: 'CART', flags: 'i' }, 'Added to cart')).toBe(true);
    expect(matchesText({ regex: '^Added$' }, 'Added to cart')).toBe(false);
    expect(matchesText({ regex: '^cart$', flags: 'm' }, 'Added to\ncart')).toBe(true);
    expect(matchesText({ regex: 'a.b', flags: 's' }, 'a\nb')).toBe(true);
    expect(matchesText({ regex: 'a.b' }, 'a\nb')).toBe(false);
  });
  it('never matches a missing value', () => {
    for (const matcher of ['x', { includes: 'x' }, { equals: 'x' }, { regex: '.*' }] as TextMatcher[]) {
      expect(matchesText(matcher, undefined)).toBe(false);
      expect(matchesText(matcher, null)).toBe(false);
    }
    expect(matchesText({ equals: '' }, '')).toBe(true);
  });
  it('is stateless across repeated calls', () => {
    const matcher = { regex: 'a' } as const;
    expect([matchesText(matcher, 'a'), matchesText(matcher, 'a'), matchesText(matcher, 'a')]).toEqual([true, true, true]);
  });
});

const at = '2026-01-01T00:00:00.000Z';
const ev = (kind: ObserverEvent['kind'], step: number, extra: Partial<ObserverEvent> = {}): ObserverEvent => ({ kind, step, at, frame: 'main', ...extra });
const task = (...all: VerifyRule[]): Task => ({ url: 'https://example.test', goal: 'Verify timeline rules', verify: { all } });
const noBrowser = {} as BrowserSession;
const withTitle = (title: string) => ({ page: { title: async () => title } }) as unknown as BrowserSession;
const activation = (step: number): NonNullable<VerificationContext['latestActivation']> => ({ step, action: { kind: 'intent', intent: 'activate' },
  observation: { kind: 'screenreader', speech: [], outputEventIds: [], window: { id: 'w', startedAt: at, endedAt: at, reason: 'quiet' } } });
const run = (rule: VerifyRule, timeline?: readonly ObserverEvent[], context: VerificationContext = {}, browser: BrowserSession = noBrowser) =>
  verifyTask(task(rule), browser, { ...context, ...(timeline ? { timeline } : {}) }).then(result => result.rules![0]!);

describe('event rules against a timeline', () => {
  const timeline = [
    ev('focus', 1, { role: 'button', name: 'Add to cart' }),
    ev('appeared', 2, { role: 'alert', name: 'Cart updated', text: 'Item added' }),
    ev('live-region', 2, { role: 'status', text: 'Added to cart', politeness: 'polite' }),
    ev('state', 3, { role: 'checkbox', name: 'Gift wrap', attr: 'checked', value: 'true' }),
    ev('navigation', 4, { url: 'https://example.test/checkout', sameDocument: true }),
  ];
  it.each<[string, VerifyRule, boolean]>([
    ['kind', { event: { kind: 'live-region' } }, true],
    ['an absent kind', { event: { kind: 'submit' } }, false],
    ['role', { event: { kind: 'appeared', role: 'alert' } }, true],
    ['a different role', { event: { kind: 'appeared', role: 'dialog' } }, false],
    ['name as a plain string', { event: { kind: 'focus', name: 'cart' } }, true],
    ['name is case sensitive', { event: { kind: 'focus', name: 'Cart' } }, false],
    ['name regex with flags', { event: { kind: 'appeared', name: { regex: 'CART', flags: 'i' } } }, true],
    ['name equals', { event: { kind: 'appeared', name: { equals: 'Cart updated' } } }, true],
    ['name equals mismatch', { event: { kind: 'appeared', name: { equals: 'Cart' } } }, false],
    ['text includes', { event: { kind: 'live-region', text: { includes: 'Added' } } }, true],
    ['text on an event without text', { event: { kind: 'focus', text: 'x' } }, false],
    ['attr', { event: { kind: 'state', attr: 'checked' } }, true],
    ['attr and exact value', { event: { kind: 'state', attr: 'checked', value: 'true' } }, true],
    ['a different value', { event: { kind: 'state', attr: 'checked', value: 'false' } }, false],
    ['value is not a substring match', { event: { kind: 'state', value: 'tru' } }, false],
    ['url', { event: { kind: 'navigation', url: { includes: '/checkout' } } }, true],
    ['url regex', { event: { kind: 'navigation', url: { regex: '^https://example\\.test/\\w+$' } } }, true],
    ['url on an event without url', { event: { kind: 'state', url: '/checkout' } }, false],
    ['every field together', { event: { kind: 'appeared', role: 'alert', name: 'Cart', text: { equals: 'Item added' } } }, true],
    ['one field mismatching among several', { event: { kind: 'appeared', role: 'alert', name: 'Cart', text: 'nope' } }, false],
  ])('matches by %s', async (_label, rule, expected) => {
    const result = await run(rule, timeline);
    expect(result.passed).toBe(expected);
    expect(result.ruleType).toBe('event');
    if (expected) { expect(result.failure).toBeUndefined(); expect(result.witnesses.length).toBeGreaterThan(0); }
    else { expect(result.failure).toMatch(/no \w[\w-]* change matching the rule/); expect(result.witnesses).toEqual([]); }
  });
  it('requires all fields on the same event rather than across events', async () => {
    expect((await run({ event: { kind: 'appeared', role: 'status' } }, timeline)).passed).toBe(false);
    expect((await run({ event: { kind: 'live-region', role: 'alert' } }, timeline)).passed).toBe(false);
  });
  it('witnesses only the observer fields that identify the change', async () => {
    const result = await run({ event: { kind: 'state', attr: 'checked' } }, [ev('state', 3, { role: 'checkbox', name: 'Gift wrap', attr: 'checked', value: 'true', tag: 'input', visible: true, inViewport: true, frame: 'child' })]);
    expect(result.witnesses).toEqual([{ kind: 'observer-event', event: { kind: 'state', step: 3, role: 'checkbox', name: 'Gift wrap', attr: 'checked', value: 'true' } }]);
    const nav = await run({ event: { kind: 'navigation' } }, [ev('navigation', 1, { url: 'https://example.test/a', sameDocument: false })]);
    expect(nav.witnesses).toEqual([{ kind: 'observer-event', event: { kind: 'navigation', step: 1, url: 'https://example.test/a', sameDocument: false } }]);
  });
  it('lists at most five matching events as witnesses, in timeline order', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ev('appeared', i + 1, { role: 'alert' }));
    const result = await run({ event: { kind: 'appeared' } }, many);
    expect(result.witnesses.map(w => w.kind === 'observer-event' && w.event.step)).toEqual([1, 2, 3, 4, 5]);
  });
  it('ignores the initial load (step 0) by default and with after: start', async () => {
    const initial = [ev('live-region', 0, { text: 'Added to cart' }), ev('appeared', 0, { role: 'alert' })];
    expect((await run({ event: { kind: 'live-region' } }, initial)).passed).toBe(false);
    expect((await run({ event: { kind: 'appeared' }, after: 'start' }, initial)).passed).toBe(false);
    expect((await run({ event: { kind: 'live-region' } }, [...initial, ev('live-region', 1, { text: 'Added to cart' })])).passed).toBe(true);
    expect((await run({ event: { kind: 'live-region' } }, [ev('live-region', 1)])).passed).toBe(true);
  });
  it('after: lastActivation counts events from the latest activation step onward', async () => {
    const events = [ev('appeared', 1, { role: 'alert' }), ev('live-region', 3, { text: 'Added' }), ev('state', 4, { attr: 'checked' })];
    const rule = (kind: ObserverEvent['kind']): VerifyRule => ({ event: { kind }, after: 'lastActivation' });
    const context = { latestActivation: activation(3) };
    expect((await run(rule('appeared'), events, context)).passed).toBe(false);
    expect((await run(rule('live-region'), events, context)).passed).toBe(true);
    expect((await run(rule('state'), events, context)).passed).toBe(true);
    expect((await run(rule('appeared'), events, { latestActivation: activation(1) })).passed).toBe(true);
    expect((await run(rule('appeared'), events, { latestActivation: activation(2) })).passed).toBe(false);
    const missed = await run(rule('appeared'), events, context);
    expect(missed.failure).toMatch(/since the last activation/);
  });
  it('after: lastActivation can match step 0 events when the latest activation step is 0', async () => {
    // Real activations are always step >= 1; this documents that the lower bound is the activation step itself.
    expect((await run({ event: { kind: 'focus' }, after: 'lastActivation' }, [ev('focus', 0)], { latestActivation: activation(0) })).passed).toBe(true);
  });
  it('after: lastActivation fails without an activation even when matching events exist', async () => {
    const result = await run({ event: { kind: 'appeared' }, after: 'lastActivation' }, [ev('appeared', 1)]);
    expect(result).toMatchObject({ ruleType: 'event', passed: false, witnesses: [] });
    expect(result.failure).toMatch(/no activation has happened yet/);
    // The same rule without the qualifier still passes, so the failure comes from the missing activation.
    expect((await run({ event: { kind: 'appeared' } }, [ev('appeared', 1)])).passed).toBe(true);
  });
  it('reports a clear failure and no witnesses when the timeline is unavailable', async () => {
    for (const rule of [{ event: { kind: 'focus' } }, { event: { kind: 'focus' }, after: 'lastActivation' }] as VerifyRule[]) {
      const result = await run(rule, undefined, { latestActivation: activation(1) });
      expect(result).toMatchObject({ ruleType: 'event', passed: false, witnesses: [] });
      expect(result.failure).toMatch(/observer events are unavailable/);
    }
    expect(await evaluateVerifyRule({ event: { kind: 'focus' } }, noBrowser)).toMatch(/unavailable/);
  });
  it('an empty timeline fails an event rule with the ordinary not-observed message', async () => {
    const result = await run({ event: { kind: 'focus' } }, []);
    expect(result.passed).toBe(false);
    expect(result.failure).toMatch(/after the initial load/);
  });
  it('does not mutate the supplied timeline', async () => {
    const frozen = Object.freeze([Object.freeze(ev('focus', 1, { role: 'button' }))]);
    expect((await run({ event: { kind: 'focus' } }, frozen)).passed).toBe(true);
    expect(frozen).toHaveLength(1);
  });
});

describe('focused rules', () => {
  it('follows the latest focus or focus-lost event', async () => {
    const focus = ev('focus', 1, { role: 'button', name: 'Save' });
    expect((await run({ focused: { role: 'button' } }, [focus])).passed).toBe(true);
    expect((await run({ focused: { role: 'button', name: 'Save' } }, [focus])).passed).toBe(true);
    expect((await run({ focused: { role: 'link' } }, [focus])).passed).toBe(false);
    expect((await run({ focused: { name: { equals: 'Sav' } } }, [focus])).passed).toBe(false);
    expect((await run({ focused: { name: { regex: '^sa', flags: 'i' } } }, [focus])).passed).toBe(true);
    const moved = [focus, ev('focus', 2, { role: 'link', name: 'Home' })];
    expect((await run({ focused: { role: 'button' } }, moved)).passed).toBe(false);
    expect((await run({ focused: { role: 'link', name: 'Home' } }, moved)).passed).toBe(true);
    expect((await run({ focused: { role: 'button' } }, [...moved, ev('focus', 3, { role: 'button', name: 'Save' })])).passed).toBe(true);
  });
  it('is false when focus was lost most recently, and true again when it returns', async () => {
    const focus = ev('focus', 1, { role: 'button', name: 'Save' });
    const lost = ev('focus-lost', 2, { reason: 'removed', name: 'Save' });
    const result = await run({ focused: { role: 'button' } }, [focus, lost]);
    expect(result).toMatchObject({ ruleType: 'focused', passed: false });
    expect(result.failure).toMatch(/not on any recorded element/);
    expect(result.witnesses).toEqual([{ kind: 'observer-event', event: { kind: 'focus-lost', step: 2, name: 'Save' } }]);
    expect((await run({ focused: { role: 'button' } }, [focus, lost, ev('focus', 3, { role: 'button' })])).passed).toBe(true);
  });
  it('ignores other event kinds when finding the latest focus record and witnesses the matched focus', async () => {
    const result = await run({ focused: { role: 'button' } }, [ev('focus', 1, { role: 'button', name: 'Save' }), ev('appeared', 2, { role: 'dialog' }), ev('live-region', 3, { text: 'Hi' })]);
    expect(result.passed).toBe(true);
    expect(result.witnesses).toEqual([{ kind: 'observer-event', event: { kind: 'focus', step: 1, role: 'button', name: 'Save' } }]);
  });
  it('describes a mismatch as focus being on a different element', async () => {
    const result = await run({ focused: { role: 'link' } }, [ev('focus', 1, { role: 'button' })]);
    expect(result.failure).toMatch(/different element/);
    expect(result.witnesses).toHaveLength(1);
  });
  it('fails on an empty timeline and reports unavailability when there is none', async () => {
    const empty = await run({ focused: { role: 'button' } }, []);
    expect(empty).toMatchObject({ passed: false, witnesses: [] });
    expect(empty.failure).toMatch(/not on any recorded element/);
    const none = await run({ focused: { role: 'button' } }, undefined);
    expect(none).toMatchObject({ passed: false, witnesses: [] });
    expect(none.failure).toMatch(/unavailable/);
  });
  it('counts a focus recorded at the initial load, because it describes where focus is now', async () => {
    expect((await run({ focused: { role: 'button' } }, [ev('focus', 0, { role: 'button' })])).passed).toBe(true);
  });
  it('treats a role-less focus record as not matching a role', async () => {
    expect((await run({ focused: { role: 'button' } }, [ev('focus', 1, { role: null })])).passed).toBe(false);
    expect((await run({ focused: { name: 'x' } }, [ev('focus', 1, { role: 'button' })])).passed).toBe(false);
  });
});

describe('not rules', () => {
  const rule: VerifyRule = { not: { event: { kind: 'focus-lost' } } };
  it('passes without witnesses when the inner rule does not hold', async () => {
    expect(await run(rule, [ev('focus', 1)])).toEqual({ ruleIndex: 0, ruleType: 'not', passed: true, witnesses: [] });
    expect((await run(rule, [])).passed).toBe(true);
    expect((await run(rule, [ev('focus-lost', 0)])).passed).toBe(true); // initial load never counts
  });
  it('fails with the inner witnesses when the inner rule holds', async () => {
    const result = await run(rule, [ev('focus', 1), ev('focus-lost', 2, { reason: 'removed', name: 'Dismiss banner' })]);
    expect(result.passed).toBe(false);
    expect(result.ruleType).toBe('not');
    expect(result.failure).toMatch(/event rule that must not hold was observed/);
    expect(result.witnesses).toEqual([{ kind: 'observer-event', event: { kind: 'focus-lost', step: 2, name: 'Dismiss banner' } }]);
  });
  it('wraps other rule types and double negation', async () => {
    const browser = withTitle('Checkout');
    expect((await run({ not: { titleIncludes: 'Error' } }, [], {}, browser))).toMatchObject({ passed: true, witnesses: [] });
    const failed = await run({ not: { titleIncludes: 'Check' } }, [], {}, browser);
    expect(failed).toMatchObject({ passed: false, witnesses: [{ kind: 'title', title: 'Checkout' }] });
    expect(failed.failure).toMatch(/titleIncludes rule/);
    expect((await run({ not: { not: { event: { kind: 'focus' } } } }, [ev('focus', 1)])).passed).toBe(true);
    expect((await run({ not: { not: { event: { kind: 'focus' } } } }, [])).passed).toBe(false);
  });
  it('evaluates after: lastActivation inside not', async () => {
    const negated: VerifyRule = { not: { event: { kind: 'appeared' }, after: 'lastActivation' } };
    expect((await run(negated, [ev('appeared', 1)], { latestActivation: activation(2) })).passed).toBe(true);
    expect((await run(negated, [ev('appeared', 2)], { latestActivation: activation(2) })).passed).toBe(false);
  });
});

describe('any rules', () => {
  it('passes when any alternative holds and witnesses only the passing alternatives', async () => {
    const timeline = [ev('appeared', 1, { role: 'alert', name: 'Cart updated' })];
    const result = await run({ any: [{ event: { kind: 'appeared', role: 'dialog' } }, { event: { kind: 'appeared', role: 'alert' } }, { titleIncludes: 'Nope' }] }, timeline, {}, withTitle('Nope'));
    expect(result.passed).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(result.witnesses).toEqual([
      { kind: 'observer-event', event: { kind: 'appeared', step: 1, role: 'alert', name: 'Cart updated' } },
      { kind: 'title', title: 'Nope' },
    ]);
  });
  it('fails when no alternative holds', async () => {
    const result = await run({ any: [{ event: { kind: 'appeared' } }, { event: { kind: 'submit' } }, { titleIncludes: 'Nope' }] }, [], {}, withTitle('Home'));
    expect(result).toMatchObject({ ruleType: 'any', passed: false, witnesses: [] });
    expect(result.failure).toMatch(/none of 3 alternative rules held/);
  });
  it('fails closed: not cannot establish absence without the observer timeline', async () => {
    const result = await run({ not: { event: { kind: 'focus-lost' } } }, undefined);
    expect(result).toMatchObject({ ruleType: 'not', passed: false, witnesses: [] });
    expect(result.failure).toMatch(/cannot be established/);
    expect(result).not.toHaveProperty('unavailable');
    // With an observed (even empty) timeline the absence holds.
    expect((await run({ not: { event: { kind: 'focus-lost' } } }, [])).passed).toBe(true);
  });
  it('lets a failing alternative be skipped when the timeline is unavailable', async () => {
    expect((await run({ any: [{ event: { kind: 'focus' } }, { titleIncludes: 'Home' }] }, undefined, {}, withTitle('Home'))).passed).toBe(true);
    expect((await run({ any: [{ event: { kind: 'focus' } }, { focused: { role: 'x' } }] }, undefined)).passed).toBe(false);
  });
  it('nests with not, focused and event rules', async () => {
    const rule: VerifyRule = { any: [{ not: { event: { kind: 'focus-lost' } } }, { focused: { role: 'dialog' } }] };
    expect((await run(rule, [ev('focus', 1, { role: 'button' })])).passed).toBe(true);
    expect((await run(rule, [ev('focus', 1, { role: 'button' }), ev('focus-lost', 2)])).passed).toBe(false);
    expect((await run(rule, [ev('focus-lost', 1), ev('focus', 2, { role: 'dialog' })])).passed).toBe(true);
  });
  it('is evaluated alongside ordinary rules and reports per-rule outcomes by index', async () => {
    const timeline = [ev('live-region', 1, { role: 'status', text: 'Added to cart' }), ev('focus', 1, { role: 'button', name: 'Cart' })];
    const result = await verifyTask(task(
      { event: { kind: 'live-region', role: 'status', text: 'Added to cart' } },
      { any: [{ event: { kind: 'appeared', role: 'alert' } }, { titleIncludes: 'Shop' }] },
      { not: { event: { kind: 'focus-lost' } } },
      { focused: { role: 'link' } },
    ), withTitle('Shop'), { timeline });
    expect(result.passed).toBe(false);
    expect(result.rules!.map(r => [r.ruleIndex, r.ruleType, r.passed])).toEqual([[0, 'event', true], [1, 'any', true], [2, 'not', true], [3, 'focused', false]]);
    expect(result.failures).toEqual([result.rules![3]!.failure]);
  });
});
