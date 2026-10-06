import { describe, expect, it } from 'vitest';
import { sanitize, sanitizeRect } from '../packages/browser/src/observer/index.js';

describe('observer focus box', () => {
  it('keeps a finite box with a size, rounded to whole CSS pixels', () => {
    expect(sanitizeRect({ x: 10.4, y: 20.6, width: 99.5, height: 31.2 })).toEqual({ x: 10, y: 21, width: 100, height: 31 });
    expect(sanitizeRect({ x: -12, y: 4, width: 50, height: 20 })).toEqual({ x: -12, y: 4, width: 50, height: 20 });
  });

  it('drops anything that is not a box a person could see', () => {
    for (const value of [undefined, null, 'box', [], {}, { x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 0, width: 10, height: 0 }, { x: '1', y: 0, width: 10, height: 10 },
      { x: Number.NaN, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: Infinity, height: 10 }, { x: 5_000_000, y: 0, width: 10, height: 10 }]) expect(sanitizeRect(value)).toBeUndefined();
  });

  it('attaches the box to a main-frame focus only, and adds no other geometry', () => {
    const rect = { x: 1, y: 2, width: 30, height: 40 };
    expect(sanitize({ kind: 'focus', frame: 'main', role: 'button', name: 'Pay', rect })).toMatchObject({ kind: 'focus', role: 'button', name: 'Pay', rect });
    // Inside a child frame the numbers are relative to that frame, so they are not stored.
    expect(sanitize({ kind: 'focus', frame: 'child', role: 'button', rect })).not.toHaveProperty('rect');
    // Only a focus event has a box.
    expect(sanitize({ kind: 'appeared', frame: 'main', role: 'dialog', rect })).not.toHaveProperty('rect');
    expect(sanitize({ kind: 'focus', frame: 'main', rect: { x: 1, y: 1, width: 0, height: 5 } })).not.toHaveProperty('rect');
    expect(sanitize({ kind: 'focus', frame: 'main', rect: { ...rect, extra: 'x' } })?.rect).toEqual(rect);
  });
});
