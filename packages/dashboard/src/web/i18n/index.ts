import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { isServerMessageCode, type ServerMessage } from '../../shared/messages.js';
import { batchUi as koBatch } from './locales/ko/batch.js';
import { compareUi as koCompare } from './locales/ko/compare.js';
import { core as koCore } from './locales/ko/core.js';
import { editor as koEditor } from './locales/ko/editor.js';
import { server as koServer } from './locales/ko/server.js';
import { settings as koSettings } from './locales/ko/settings.js';
import { shell as koShell } from './locales/ko/shell.js';
import { states as koStates } from './locales/ko/states.js';
import { suggest as koSuggest } from './locales/ko/suggest.js';
import { taskUi as koTask } from './locales/ko/task.js';
import { traceUi as koTrace } from './locales/ko/trace.js';
import { batchUi as enBatch } from './locales/en/batch.js';
import { compareUi as enCompare } from './locales/en/compare.js';
import { core as enCore } from './locales/en/core.js';
import { editor as enEditor } from './locales/en/editor.js';
import { server as enServer } from './locales/en/server.js';
import { settings as enSettings } from './locales/en/settings.js';
import { shell as enShell } from './locales/en/shell.js';
import { states as enStates } from './locales/en/states.js';
import { suggest as enSuggest } from './locales/en/suggest.js';
import { taskUi as enTask } from './locales/en/task.js';
import { traceUi as enTrace } from './locales/en/trace.js';

/**
 * One namespace per language; top-level keys of the locale files must not collide. Korean is the source shape: every English file is
 * typed as its Korean file (`LocaleShape`), so a key missing in either fails typecheck.
 */
export const resources = {
  ko: { translation: { ...koBatch, ...koCompare, ...koCore, ...koEditor, ...koServer, ...koSettings, ...koShell, ...koStates, ...koSuggest, ...koTask, ...koTrace } },
  en: { translation: { ...enBatch, ...enCompare, ...enCore, ...enEditor, ...enServer, ...enSettings, ...enShell, ...enStates, ...enSuggest, ...enTask, ...enTrace } },
} as const;

export const LANGUAGES = ['ko', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_KEY = 'rawstep.language';
/** Each language by its own name, so a reader finds theirs whatever is shown now (not translated on purpose). */
export const LANGUAGE_NAMES: Record<Language, string> = { ko: '한국어', en: 'English' };
const isLanguage = (value: unknown): value is Language => (LANGUAGES as readonly unknown[]).includes(value);

/** The browser's preference: Korean when any preferred language is Korean (`ko`, `ko-KR`, …), English otherwise. */
export function browserLanguage(languages: readonly string[] | undefined): Language {
  return (languages ?? []).some(language => language.toLowerCase().startsWith('ko')) ? 'ko' : 'en';
}

/** A language the person picked with the switch; storage can be blocked or missing, so this never throws. */
export function storedLanguage(): Language | undefined {
  try { const value = localStorage.getItem(LANGUAGE_KEY); return isLanguage(value) ? value : undefined; } catch { return undefined; }
}

function navigatorLanguages(): readonly string[] {
  try { return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : []; } catch { return []; }
}

/** The language a page opens in: the person's choice, otherwise the browser's. */
export const initialLanguage = (): Language => storedLanguage() ?? browserLanguage(navigatorLanguages());

/** Switches the language and remembers the choice (for this browser only; if storage is blocked it lasts until the page closes). */
export function setLanguage(language: Language): void {
  try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* the choice then only lasts for this page */ }
  void i18n.changeLanguage(language);
}

/** The language being shown, as one of the dashboard's languages. */
export const currentLanguage = (): Language => isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';

/** Keeps `<html lang>` on the language being shown, so screen readers pronounce the page in it. */
const syncDocumentLanguage = (language: string) => { try { document.documentElement.lang = language; } catch { /* no document outside a browser */ } };
i18n.on('languageChanged', syncDocumentLanguage);

// Synchronous init with bundled resources: the first render already has every string.
void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: 'en',
  supportedLngs: LANGUAGES,
  interpolation: { escapeValue: false },
  initAsync: false,
});

export { i18n };
export const t = i18n.t.bind(i18n);

/** A message the server sent as a code, in the language being shown; an unknown code is the generic failure. */
export function serverText(message: ServerMessage | undefined): string {
  if (!message || !isServerMessageCode(message.code)) return t('serverMessages.request-failed');
  return t(`serverMessages.${message.code}`, message.params ?? {});
}
