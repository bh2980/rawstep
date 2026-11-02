import { currentLanguage } from '../i18n/index.js';

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(kind: 'day' | 'year' | 'time' | 'full'): Intl.DateTimeFormat {
  const language = currentLanguage(), key = language + kind;
  let format = dateFormats.get(key);
  if (!format) {
    const time = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
    format = new Intl.DateTimeFormat(language, kind === 'time' ? time
      : kind === 'full' ? { year: 'numeric', month: 'long', day: 'numeric', ...time, second: '2-digit', timeZoneName: 'short' }
      : { ...(kind === 'year' ? { year: 'numeric' } : {}), month: language === 'ko' ? 'long' : 'short', day: 'numeric', ...time });
    dateFormats.set(key, format);
  }
  return format;
}
const toTime = (value: number | string | null | undefined): number => typeof value === 'string' ? Date.parse(value) : value ?? NaN;

/** The one date format: `11월 1일 08:21` (`Nov 1, 08:21`), with the year only when it is not this year; a dash when there is no time. */
export function formatDate(value: number | string | null | undefined, now = Date.now()): string {
  const time = toTime(value);
  if (!Number.isFinite(time) || !time) return '—';
  return dateFormat(new Date(time).getFullYear() === new Date(now).getFullYear() ? 'day' : 'year').format(time);
}
/** Only the time, `08:21`, for a column whose rows share a day. */
export function formatClockTime(value: number | string | null | undefined): string {
  const time = toTime(value);
  return Number.isFinite(time) && time ? dateFormat('time').format(time) : '—';
}
/** Everything, with seconds and the time zone, for a tooltip under a short date. */
export function formatFullDate(value: number | string | null | undefined): string {
  const time = toTime(value);
  return Number.isFinite(time) && time ? dateFormat('full').format(time) : '';
}
/** A duration in seconds with one decimal (`454.8`), also past a minute, so a column compares at a glance. */
export const formatSeconds = (ms: number | null | undefined): string => ms === null || ms === undefined || !Number.isFinite(ms) ? '—' : (ms / 1000).toFixed(1);


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
  return formatDate(time, now);
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
