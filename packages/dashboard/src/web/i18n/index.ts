import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { core } from './locales/ko/core.js';
import { editor } from './locales/ko/editor.js';

/** One namespace; top-level keys of the locale files must not collide. */
export const resources = { ko: { translation: { ...core, ...editor } } } as const;

// Synchronous init with bundled resources: the first render already has every string.
void i18n.use(initReactI18next).init({
  resources,
  lng: 'ko',
  fallbackLng: 'ko',
  interpolation: { escapeValue: false },
  initAsync: false,
});

export { i18n };
export const t = i18n.t.bind(i18n);
