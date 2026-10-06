export type RawEventLike = { type: string; data: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Groups recorded trace events by the step they belong to. A decision names its step; events without a number
 * (observations, screenshots) belong to the latest decision before them, and events before the first one to step 0.
 */
export function eventsByStep<T extends RawEventLike>(events: readonly T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  let current = 0;
  for (const event of events) {
    const own = isRecord(event.data) && typeof event.data.step === 'number' ? event.data.step : undefined;
    if (event.type === 'policy.decision' && own !== undefined) current = own;
    const step = own ?? current;
    const list = groups.get(step);
    if (list) list.push(event); else groups.set(step, [event]);
  }
  return groups;
}
