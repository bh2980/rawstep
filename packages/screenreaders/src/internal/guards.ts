/** Package-internal helpers; deliberately absent from the exports map. */
export function positiveMilliseconds(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647) throw new Error(`${name} must be a positive finite timer interval`);
  return value;
}
