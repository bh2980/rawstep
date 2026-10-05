import { describe, expect, it } from 'vitest';
import { MAX_SCRIPT_SOURCE, resolveTask } from '@rawstep/core/contracts';

const base = { url: 'https://example.com', goal: 'Sign in', maxSteps: 5 };
const withRule = (rule: unknown, extra: Record<string, unknown> = {}) => resolveTask({ ...base, ...extra, verify: { all: [rule] } }, process.cwd());

describe('script verification rule contract', () => {
  it('accepts function expressions, also nested under not and any', () => {
    for (const source of ['() => true', 'async (context) => context.timeline.length > 0', 'function check() { return true; }', 'ctx => !!ctx'])
      expect(withRule({ script: { source, description: 'check' } }).verify.all[0]).toEqual({ script: { source, description: 'check' } });
    expect(() => withRule({ not: { any: [{ script: { source: '() => false', description: 'never' } }] } })).not.toThrow();
  });

  it('rejects anything that is not a described, bounded function expression', () => {
    expect(() => withRule({ script: '() => true' })).toThrow(/source, description/);
    expect(() => withRule({ script: { source: 'document.title', description: 'x' } })).toThrow(/function expression/);
    expect(() => withRule({ script: { source: '() => true' } })).toThrow(/script.description/);
    expect(() => withRule({ script: { source: '() => true', description: 'x', world: 'main' } })).toThrow();
    expect(() => withRule({ script: { source: '() => ' + 'x'.repeat(MAX_SCRIPT_SOURCE), description: 'x' } })).toThrow(/at most/);
  });

  it('refuses a script that carries a sensitive input value', () => {
    expect(() => withRule({ script: { source: "() => document.querySelector('#pw').value === 'hunter2!'", description: 'x' } }, { input: { password: 'hunter2!' } })).toThrow(/script rule contains the value of input password/);
    expect(() => withRule({ any: [{ script: { source: "() => location.href.includes('hunter2!')", description: 'x' } }] }, { input: { password: 'hunter2!' } })).toThrow(/password/);
    expect(() => withRule({ script: { source: "() => document.querySelector('#q').value === 'shoes'", description: 'x' } }, { input: { query: 'shoes' }, inputOptions: { query: { sensitive: false } } })).not.toThrow();
  });
});
