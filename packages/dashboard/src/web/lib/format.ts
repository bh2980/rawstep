export function formatDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms), pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

import { currentLanguage } from '../i18n/index.js';

const formats = new Map<string, Intl.RelativeTimeFormat>();
/** The relative-time format of the language shown now, made once per language. */
function relativeFormat(): Intl.RelativeTimeFormat {
  const language = currentLanguage();
  let format = formats.get(language);
  if (!format) { format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' }); formats.set(language, format); }
  return format;
}

/** "10 minutes ago", "yesterday", "3 days ago" (in the language shown); a date after a week; a dash when there is no time. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  const time = iso ? Date.parse(iso) : NaN, relative = relativeFormat();
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

/** The `count` for i18next's plural forms when a value is a number (or a numeric string such as a median shown as `2.5`); nothing for `—` or a missing value, which then read as the plural. */
export function countOf(value: number | string | null | undefined): { count?: number } {
  const n = typeof value === 'string' ? (value.trim() === '' ? Number.NaN : Number(value)) : value;
  return typeof n === 'number' && Number.isFinite(n) ? { count: n } : {};
}

/** A running time as `00:42`, or `1:02:03` from an hour on. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0)), pad = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}` : `${pad(minutes)}:${pad(seconds % 60)}`;
}
