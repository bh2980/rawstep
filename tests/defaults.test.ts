import { describe, expect, it } from 'vitest';
import { RAWSTEP_DEFAULTS, isLoopbackHostname, isLoopbackUrl } from '@rawstep/core/defaults';
import { resolveTask } from '@rawstep/core/contracts';
import { defaultConfig } from '../packages/dashboard/src/shared/config.js';

describe('shared runtime defaults', () => {
  it.each(['http://localhost:1/', 'http://127.0.0.1/', 'http://[::1]:8/'])('treats %s as loopback', url => expect(isLoopbackUrl(url)).toBe(true));
  it.each(['https://example.com/', 'http://127.0.0.2/', 'not a url'])('rejects %s as non-loopback', url => expect(isLoopbackUrl(url)).toBe(false));
  it('accepts a bare ::1 hostname', () => expect(isLoopbackHostname('::1')).toBe(true));
  it('keeps the dashboard policy defaults in sync', () => {
    const { focusGate, ...policy } = defaultConfig().globals.policy;
    expect(focusGate).toBe(false);
    expect(policy).toEqual(RAWSTEP_DEFAULTS.policy);
  });
  it('resolves task limits from the shared defaults', () => {
    const task = resolveTask({ url: 'https://example.com', goal: 'g', verify: { all: [{ titleIncludes: 'x' }] } });
    expect(task.maxSteps).toBe(RAWSTEP_DEFAULTS.task.maxSteps);
    expect(task.timeoutMs).toBe(RAWSTEP_DEFAULTS.task.timeoutMs);
  });
});
