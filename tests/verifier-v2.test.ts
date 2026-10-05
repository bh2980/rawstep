import { describe, expect, it } from 'vitest';
import { evaluateVerifyRule, verifyTask, type VerificationContext } from '@rawstep/browser/verify';
import type { BrowserSession } from '@rawstep/browser/browser';
import type { Task, VerifyRule } from '@rawstep/core/contracts';

const task = (all: VerifyRule[]): Task => ({ url: 'https://example.test', goal: 'Verify recorded results', verify: { all } });
const timestamp = '2026-09-30T00:00:01Z';
describe('independent verifier',()=>{
  it.each(['textVisible','textVisibleExact'] as const)('finds visible matches after a hidden first match for %s',async(key)=>{
    const browser={page:{getByText:()=>({count:async()=>2,nth:(i:number)=>({isVisible:async()=>i===1})})}} as unknown as BrowserSession;
    expect(await evaluateVerifyRule({[key]:'Completed'} as any,browser)).toBeUndefined();
  });
  it('does not echo observed speech into verifier failures',async()=>{
    const error=await evaluateVerifyRule({activatedAnnouncementIncludes:'Done'},{} as BrowserSession,{latestActivation:{step:1,action:{kind:'intent',intent:'activate'},observation:{kind:'screenreader',speech:['a','z','9','1'],outputEventIds:['event-1'],window:{id:'w1',startedAt:'2026-09-30T00:00:00Z',endedAt:'2026-09-30T00:00:01Z',reason:'quiet'}}}});
    expect(error).not.toContain('a\nz\n9\n1');expect(error).toContain('no matching output');
  });

  it('returns each rule outcome with the actual title and URL, including failed expectations', async () => {
    const browser = { page: { title: async () => 'Checkout pending', url: () => 'https://example.test/cart' } } as unknown as BrowserSession;
    const result = await verifyTask(task([{ titleIncludes: 'Completed' }, { urlIncludes: '/cart' }]), browser);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.rules).toEqual([
      { ruleIndex: 0, ruleType: 'titleIncludes', passed: false, failure: result.failures[0], witnesses: [{ kind: 'title', title: 'Checkout pending' }] },
      { ruleIndex: 1, ruleType: 'urlIncludes', passed: true, witnesses: [{ kind: 'url', url: 'https://example.test/cart' }] }
    ]);
    expect(JSON.stringify(result.rules?.[0]?.witnesses)).not.toContain('Completed');
  });

  it.each(['textVisible', 'textVisibleExact'] as const)('records the actual visible match for %s instead of copying the task expectation', async (key) => {
    const browser = { page: { getByText: () => ({ count: async () => 2, nth: (index: number) => ({
      isVisible: async () => index === 1, evaluate: async () => ({ text: '  Completed order 482  ', textSource: 'text-content' })
    }) }) } } as unknown as BrowserSession;
    const result = await verifyTask(task([{ [key]: key === 'textVisibleExact' ? 'Completed order 482' : 'Completed' } as VerifyRule]), browser);
    expect(result.rules?.[0]).toMatchObject({ passed: true, witnesses: [{ kind: 'visible-text', text: '  Completed order 482  ', textSource: 'text-content', matchIndex: 1, visible: true }] });
  });

  it('records matched requests, responses and DOM events with their original observed details', async () => {
    const request = { url: 'https://example.test/api/order/482', method: 'post', timestamp };
    const response = { ...request, status: 201, ok: true };
    const event = { selector: '#save', event: 'click', url: 'https://example.test/cart', timestamp };
    const browser = { network: { requests: [request], responses: [response] }, domEvents: [event] } as unknown as BrowserSession;
    const result = await verifyTask(task([
      { requestSeen: { urlIncludes: '/api/order', method: 'POST' } },
      { responseSeen: { urlIncludes: '/api/order', method: 'POST', status: 201 } },
      { domEventSeen: { selector: '#save', event: 'click' } }
    ]), browser);
    expect(result.passed).toBe(true);
    expect(result.rules?.map((rule) => rule.witnesses)).toEqual([
      [{ kind: 'request', ...request }], [{ kind: 'response', ...response }], [{ kind: 'dom-event', ...event }]
    ]);
    request.url = 'https://changed.test';
    expect(result.rules?.[0]?.witnesses[0]).toMatchObject({ url: 'https://example.test/api/order/482' });
  });

  it('preserves observed request and response near misses without claiming they passed', async () => {
    const request = { url: 'https://example.test/api/order/482', method: 'GET', timestamp };
    const response = { ...request, method: 'POST', status: 403, ok: false };
    const browser = { network: { requests: [request], responses: [response] } } as unknown as BrowserSession;
    const result = await verifyTask(task([
      { requestSeen: { urlIncludes: '/api/order', method: 'POST' } },
      { responseSeen: { urlIncludes: '/api/order', method: 'POST', status: 201 } }
    ]), browser);
    expect(result.passed).toBe(false);
    expect(result.rules?.every((rule) => !rule.passed && rule.failure)).toBe(true);
    expect(result.rules?.map((rule) => rule.witnesses)).toEqual([[{ kind: 'request', ...request }], [{ kind: 'response', ...response }]]);
    expect(JSON.stringify(result.rules?.[1]?.witnesses)).not.toContain('201');
  });

  it('never fabricates witnesses when a rule has no relevant observations', async () => {
    const browser = { page: { getByText: () => ({ count: async () => 0 }) }, network: { requests: [], responses: [] }, domEvents: [] } as unknown as BrowserSession;
    const result = await verifyTask(task([
      { requestSeen: { urlIncludes: '/missing' } }, { responseSeen: { urlIncludes: '/missing' } },
      { domEventSeen: { selector: '#missing', event: 'click' } }, { textVisible: 'Missing text' },
      { activatedAnnouncementIncludes: 'Missing speech' }
    ]), browser);
    expect(result.failures).toHaveLength(5);
    expect(result.rules?.every((rule) => !rule.passed && rule.witnesses.length === 0)).toBe(true);
  });

  it('records activation-window speech and source IDs without asserting command causality', async () => {
    const context: VerificationContext = { latestActivation: { step: 2, action: { kind: 'intent', intent: 'activate' }, observation: {
      kind: 'screenreader', speech: ['Order received'], outputEventIds: ['actual-output-event'],
      window: { id: 'window-2', startedAt: timestamp, endedAt: timestamp, reason: 'quiet' }
    } } };
    const result = await verifyTask(task([{ activatedAnnouncementIncludes: 'Completed' }]), {} as BrowserSession, context);
    expect(result.rules?.[0]).toMatchObject({ passed: false, witnesses: [{
      kind: 'activation-speech', speech: ['Order received'], outputEventIds: ['actual-output-event'],
      activationStep: 2, association: 'temporal-only', window: { id: 'window-2' }
    }] });
    expect(result.failures[0]).not.toContain('Order received');
    context.latestActivation!.observation.window.id = 'changed';
    expect(result.rules?.[0]?.witnesses[0]).toMatchObject({ window: { id: 'window-2' } });
  });
});
