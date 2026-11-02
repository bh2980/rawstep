import { formatClockTime, formatDate, formatFullDate } from '../lib/format';

/** A time as `11월 1일 08:21` (or only `08:21`), with the year, seconds and time zone on hover. */
export function Time({ value, timeOnly, className }: { value: number | string | null | undefined; timeOnly?: boolean; className?: string }) {
  const full = formatFullDate(value);
  if (!full) return <span className="text-ink-3">—</span>;
  const iso = new Date(typeof value === 'string' ? Date.parse(value) : value!).toISOString();
  return <time dateTime={iso} title={full} className={className}>{timeOnly ? formatClockTime(value) : formatDate(value)}</time>;
}
