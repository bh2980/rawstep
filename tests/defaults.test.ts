import { describe, expect, it } from 'vitest';
import { RAWSTEP_DEFAULTS, isLoopbackHostname, isLoopbackUrl } from '@rawstep/core/defaults';
import { resolveTask } from '@rawstep/core/contracts';
import { defaultConfig, executorSchema, runRulesSchema } from '@rawstep/project/config';

describe('shared runtime defaults', () => {
  it.each(['http://localhost:1/', 'http://127.0.0.1/', 'http://[::1]:8/'])('treats %s as loopback', url => expect(isLoopbackUrl(url)).toBe(true));
  it.each(['https://example.com/', 'http://127.0.0.2/', 'not a url'])('rejects %s as non-loopback', url => expect(isLoopbackUrl(url)).toBe(false));
  it('accepts a bare ::1 hostname', () => expect(isLoopbackHostname('::1')).toBe(true));
  it('keeps the project run rules in sync with the shared policy and orchestration defaults', () => {
    const { repetitionGuard, maxUnchangedTransitions, maxPlannerCalls, stepActionLimit, failureLimit, noChangeLimit } = defaultConfig().profiles[0]!.runRules;
    expect(repetitionGuard).toBe(true);
    expect(maxUnchangedTransitions).toBe(RAWSTEP_DEFAULTS.policy.maxUnchangedTransitions);
    expect({ maxPlannerCalls, stepActionLimit }).toEqual({ maxPlannerCalls: RAWSTEP_DEFAULTS.orchestration.maxPlannerCalls, stepActionLimit: RAWSTEP_DEFAULTS.orchestration.stepActionLimit });
    expect([failureLimit, noChangeLimit]).toEqual([2, 3]);
    expect(runRulesSchema.parse({})).toEqual(defaultConfig().profiles[0]!.runRules);
  });
  it('defaults the executor history to the shared policy default', () => {
    const executor = executorSchema.parse({ connectionId: 'm', modelId: 'x', instructions: 'Choose.' });
    expect(executor.historyLimit).toBe(RAWSTEP_DEFAULTS.policy.historyLimit);
    expect(executor).toMatchObject({ maxChoices: 255 });
  });
  it('resolves task limits from the shared defaults', () => {
    const task = resolveTask({ url: 'https://example.com', goal: 'g', verify: { all: [{ titleIncludes: 'x' }] } });
    expect(task.maxSteps).toBe(RAWSTEP_DEFAULTS.task.maxSteps);
    expect(task.timeoutMs).toBe(RAWSTEP_DEFAULTS.task.timeoutMs);
  });
});
