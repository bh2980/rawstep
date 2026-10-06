import { describe, expect, it } from 'vitest';
import { boxPercent, focusRectOf, scaleFocusRect } from '../packages/dashboard/src/web/lib/focusRect.js';

const viewport = { width: 1280, height: 800 };

describe('focus outline scaling', () => {
  it('keeps the box as it is when the picture is the viewport size', () => {
    expect(scaleFocusRect({ x: 100, y: 50, width: 200, height: 40 }, viewport, viewport)).toEqual({ x: 100, y: 50, width: 200, height: 40 });
  });

  it('multiplies every number by image over viewport, per axis', () => {
    // A 2x capture, and a picture scaled down to a quarter of the width with the same aspect.
    expect(scaleFocusRect({ x: 100, y: 50, width: 200, height: 40 }, viewport, { width: 2560, height: 1600 })).toEqual({ x: 200, y: 100, width: 400, height: 80 });
    expect(scaleFocusRect({ x: 100, y: 50, width: 200, height: 40 }, viewport, { width: 320, height: 200 })).toEqual({ x: 25, y: 13, width: 50, height: 10 });
    expect(scaleFocusRect({ x: 10, y: 10, width: 10, height: 10 }, { width: 100, height: 200 }, { width: 400, height: 200 })).toEqual({ x: 40, y: 10, width: 40, height: 10 });
  });

  it('clips a box that reaches past the viewport to the picture', () => {
    expect(scaleFocusRect({ x: 1200, y: 760, width: 200, height: 100 }, viewport, viewport)).toEqual({ x: 1200, y: 760, width: 80, height: 40 });
    expect(scaleFocusRect({ x: -30, y: -10, width: 100, height: 50 }, viewport, viewport)).toEqual({ x: 0, y: 0, width: 70, height: 40 });
  });

  it('draws nothing for a box outside the picture, an empty box or a picture without a size', () => {
    expect(scaleFocusRect({ x: 1300, y: 10, width: 50, height: 50 }, viewport, viewport)).toBeUndefined();
    expect(scaleFocusRect({ x: 10, y: 900, width: 50, height: 50 }, viewport, viewport)).toBeUndefined();
    expect(scaleFocusRect({ x: 10, y: 10, width: 0, height: 50 }, viewport, viewport)).toBeUndefined();
    expect(scaleFocusRect({ x: Number.NaN, y: 10, width: 5, height: 5 }, viewport, viewport)).toBeUndefined();
    expect(scaleFocusRect({ x: 10, y: 10, width: 5, height: 5 }, { width: 0, height: 800 }, viewport)).toBeUndefined();
    expect(scaleFocusRect({ x: 10, y: 10, width: 5, height: 5 }, viewport, { width: 100, height: 0 })).toBeUndefined();
  });

  it('never rounds a visible box down to nothing', () => {
    expect(scaleFocusRect({ x: 640, y: 400, width: 1, height: 1 }, viewport, { width: 64, height: 40 })).toEqual({ x: 32, y: 20, width: 1, height: 1 });
  });

  it('expresses the scaled box as percentages of the picture so it follows the picture when it is drawn at any size', () => {
    expect(boxPercent({ x: 320, y: 100, width: 640, height: 200 }, viewport)).toEqual({ left: '25%', top: '12.5%', width: '50%', height: '25%' });
  });
});

describe('focus box of a step', () => {
  const box = { x: 1, y: 2, width: 3, height: 4 };

  it('takes the last focus recorded in the step', () => {
    expect(focusRectOf([{ kind: 'focus', rect: { x: 9, y: 9, width: 9, height: 9 } }, { kind: 'state' }, { kind: 'focus', rect: box }])).toEqual(box);
  });

  it('has no box once focus was lost or left the page, or when the focus carried none', () => {
    expect(focusRectOf([{ kind: 'focus', rect: box }, { kind: 'focus-lost' }])).toBeUndefined();
    expect(focusRectOf([{ kind: 'focus', rect: box }, { kind: 'page-blur' }])).toBeUndefined();
    expect(focusRectOf([{ kind: 'focus' }])).toBeUndefined();
    expect(focusRectOf([])).toBeUndefined();
  });
});
