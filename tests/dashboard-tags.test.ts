import { describe, expect, it } from 'vitest';
import { tagSchema } from '@rawstep/project/config';
import { MAX_PARALLEL_RUNS, parseParallelRuns } from '../packages/dashboard/src/web/lib/machine.js';
import { activeTag, addTags, allTaggedSelected, hasTag, MAX_TAGS, projectTags, tagProblem, tasksWithTag, toggleTagged } from '../packages/dashboard/src/web/lib/tags.js';

describe('task tags in the dashboard', () => {
  it('refuses exactly the tags the project config refuses', () => {
    const samples = ['checkout', 'log-in', 'a_b', '결제', 'x'.repeat(30), 'x'.repeat(31), '', ' ', 'two words', '-lead', '_lead', 'a.b', 'a,b', 'tag!', '1', 'ü', '가'.repeat(30), '가'.repeat(31)];
    for (const sample of samples) {
      if (!sample) continue;
      expect(tagProblem(sample, []) === undefined, JSON.stringify(sample)).toBe(tagSchema.safeParse(sample).success);
    }
  });

  it('says why a tag is refused', () => {
    expect(tagProblem('two words', [])).toBe('characters');
    expect(tagProblem('-lead', [])).toBe('characters');
    expect(tagProblem('x'.repeat(31), [])).toBe('length');
    expect(tagProblem('login', ['login'])).toBe('duplicate');
    expect(tagProblem('late', Array.from({ length: MAX_TAGS }, (_, i) => 't' + i))).toBe('full');
    expect(tagProblem('', [])).toBeUndefined();
    expect(tagProblem('checkout', ['login'])).toBeUndefined();
  });

  it('adds typed tags separated by commas, and stops at the first it cannot take', () => {
    expect(addTags('checkout', [])).toEqual({ tags: ['checkout'], rest: '' });
    expect(addTags(' checkout , login,', ['cart'])).toEqual({ tags: ['cart', 'checkout', 'login'], rest: '' });
    expect(addTags('', ['cart'])).toEqual({ tags: ['cart'], rest: '' });
    expect(addTags('ok, two words, later', [])).toEqual({ tags: ['ok'], rest: 'two words, later', problem: { code: 'characters', tag: 'two words' } });
    expect(addTags('cart', ['cart'])).toEqual({ tags: ['cart'], rest: 'cart', problem: { code: 'duplicate', tag: 'cart' } });
    expect(addTags('same,same', [])).toEqual({ tags: ['same'], rest: 'same', problem: { code: 'duplicate', tag: 'same' } });
  });

  it('lists the project\'s tags once each, and filters tasks by one', () => {
    const tasks = [{ id: 'a', tags: ['login', 'checkout'] }, { id: 'b' }, { id: 'c', tags: ['checkout'] }];
    expect(projectTags(tasks)).toEqual(['checkout', 'login']);
    expect(projectTags([{}])).toEqual([]);
    expect(tasksWithTag(tasks, 'checkout').map(task => task.id)).toEqual(['a', 'c']);
    expect(tasksWithTag(tasks, 'nothing')).toEqual([]);
    expect(hasTag(tasks[1], 'checkout')).toBe(false);
    expect(hasTag(tasks[1], undefined)).toBe(true);
    expect(hasTag(undefined, 'checkout')).toBe(false);
  });

  it('ignores a chosen tag that no task has any more', () => {
    const tasks = [{ tags: ['login'] }, {}];
    expect(activeTag('login', '__all__', tasks)).toBe('login');
    expect(activeTag('__all__', '__all__', tasks)).toBeUndefined();
    expect(activeTag('gone', '__all__', tasks)).toBeUndefined();
  });

  it('picks the tasks of a tag in the run dialog and takes them out again', () => {
    const tasks = [{ id: 'a', tags: ['login'] }, { id: 'b', tags: ['login', 'cart'] }, { id: 'c', tags: ['cart'] }, { id: 'd' }];
    expect(allTaggedSelected(tasks, 'login', ['a'])).toBe(false);
    expect(allTaggedSelected(tasks, 'login', ['a', 'b'])).toBe(true);
    expect(allTaggedSelected(tasks, 'nothing', ['a'])).toBe(false);
    expect(toggleTagged(tasks, 'login', ['d'])).toEqual(['d', 'a', 'b']);
    expect(toggleTagged(tasks, 'login', ['b'])).toEqual(['b', 'a']);
    // All of them in already: they go out, other tasks stay.
    expect(toggleTagged(tasks, 'login', ['d', 'a', 'b', 'c'])).toEqual(['d', 'c']);
  });
});

describe('runs at once', () => {
  it('takes only whole numbers from 1 to 8', () => {
    expect(parseParallelRuns('1')).toBe(1);
    expect(parseParallelRuns(' 4 ')).toBe(4);
    expect(parseParallelRuns(String(MAX_PARALLEL_RUNS))).toBe(8);
    for (const bad of ['', '0', '9', '-1', '2.5', 'two', '1e1', '0008x']) expect(parseParallelRuns(bad), bad).toBeUndefined();
  });
});
