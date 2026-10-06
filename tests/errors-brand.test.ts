import { describe, expect, it } from 'vitest';
import { RawstepError, findRawstepError } from '@rawstep/core/errors';
import { BrowserAccessBlockedError, BrowserSetupError } from '@rawstep/browser/browser';

/** What an error thrown by another loaded copy of rawstep looks like: same brand and name, different prototype. */
function foreignCopy(name: string, code: string, outcome?: object): Error {
  const error = Object.assign(new Error('from another copy'), { name, code, ...(outcome ? { outcome } : {}) });
  Object.defineProperty(error, Symbol.for('rawstep.RawstepError'), { value: true });
  return error;
}

describe('RawstepError across copies', () => {
  it('recognizes errors from another copy by brand and name', () => {
    const blocked = foreignCopy('BrowserAccessBlockedError', 'access-blocked', { status: 'inconclusive', reason: 'access-blocked' });
    expect(blocked instanceof RawstepError).toBe(true);
    expect(blocked instanceof BrowserAccessBlockedError).toBe(true);
    expect(blocked instanceof BrowserSetupError).toBe(false);
    expect(findRawstepError(new Error('wrapper', { cause: blocked }), e => !!e.outcome)?.outcome).toEqual({ status: 'inconclusive', reason: 'access-blocked' });
  });

  it('keeps ordinary errors and own instances working', () => {
    expect(new Error('plain') instanceof RawstepError).toBe(false);
    expect(Object.assign(new Error('x'), { name: 'BrowserAccessBlockedError' }) instanceof BrowserAccessBlockedError).toBe(false);
    const own = new BrowserAccessBlockedError('https://example.com', 403, 'blocked');
    expect(own instanceof RawstepError && own instanceof BrowserAccessBlockedError).toBe(true);
    expect(own instanceof BrowserSetupError).toBe(false);
  });
});
