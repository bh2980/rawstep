/** A box in CSS pixels, or in image pixels once scaled: x and y are the top-left corner. */
export type Box = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

/**
 * Where a recorded box (the screen reader cursor) sits on a screenshot. The box is in CSS pixels of the viewport; the
 * picture may be a different size (a device pixel ratio, a scaled copy), so every number is multiplied by image / viewport.
 * The box is clipped to the picture, because an element can reach past the viewport. A box that is wholly outside it, or a viewport
 * or image without a size, gives `undefined`: nothing is drawn rather than something wrong.
 */
export function scaleFocusRect(rect: Box, viewport: Size, image: Size): Box | undefined {
  if (![viewport.width, viewport.height, image.width, image.height].every(n => Number.isFinite(n) && n > 0)) return undefined;
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return undefined;
  const sx = image.width / viewport.width, sy = image.height / viewport.height;
  const left = Math.max(0, rect.x * sx), top = Math.max(0, rect.y * sy);
  const right = Math.min(image.width, (rect.x + rect.width) * sx), bottom = Math.min(image.height, (rect.y + rect.height) * sy);
  if (right <= left || bottom <= top) return undefined;
  return { x: Math.round(left), y: Math.round(top), width: Math.max(1, Math.round(right - left)), height: Math.max(1, Math.round(bottom - top)) };
}

/** The scaled box as percentages of the picture, so it stays on the element however large the picture is drawn. */
export function boxPercent(box: Box, image: Size): { left: string; top: string; width: string; height: string } {
  const pct = (value: number, of: number) => `${Math.round(value / of * 10000) / 100}%`;
  return { left: pct(box.x, image.width), top: pct(box.y, image.height), width: pct(box.width, image.width), height: pct(box.height, image.height) };
}
