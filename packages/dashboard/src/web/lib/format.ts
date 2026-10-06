export function formatDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms), pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const relative = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });

/** "10분 전", "어제", "3일 전"; a date after a week; a dash when there is no time. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return '—';
  const seconds = Math.round((time - now) / 1000), abs = Math.abs(seconds);
  if (abs < 45) return relative.format(0, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day');
  return formatDate(time);
}

/** A whole number as is, a median of two as one decimal, nothing as a dash. */
export const formatSteps = (value: number | null | undefined): string => value === null || value === undefined ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(1);
