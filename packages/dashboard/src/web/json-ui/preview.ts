import { t } from '../i18n';
import { parseDashboardSpec } from '../../shared/ui-catalog';
import keyboard from '../specs/keyboard-permissions.json';
import screenreader from '../specs/screenreader-permissions.json';

const MARKER = '$t:';

/** Deep-walks a JSON UI spec and replaces "$t:<key>" marker strings with their translation. */
export function localizeSpec<T>(spec: T): T {
  const translate = t as (key: string) => string;
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return value.startsWith(MARKER) ? translate(value.slice(MARKER.length)) : value;
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    return value;
  };
  return walk(spec) as T;
}

/** Built lazily so every string is translated at call time. */
export const previewSpecs = () => ({
  keyboard: parseDashboardSpec(localizeSpec(keyboard)),
  screenreader: parseDashboardSpec(localizeSpec(screenreader)),
});

export type PreviewMode = 'keyboard' | 'screenreader';
export const previewDefaults = {
  keyboard: { forward: true, backward: true, extraNavigation: false, activate: true, textEntry: false, replaceText: false },
  screenreader: { forward: true, backward: true, extraNavigation: true, activate: true, textEntry: false, replaceText: false },
};

/** Resolved at call time so translations are always current. */
export const previewLabels = () => ({
  keyboard: { forward: 'Tab', backward: 'Shift+Tab', extraNavigation: t('preview.keyboard.extraNavigation'), activate: 'Enter · Space', textEntry: t('preview.keyboard.textEntry'), replaceText: t('preview.keyboard.replaceText') },
  screenreader: { forward: t('preview.screenreader.forward'), backward: t('preview.screenreader.backward'), extraNavigation: t('preview.screenreader.extraNavigation'), activate: t('preview.screenreader.activate'), textEntry: t('preview.screenreader.textEntry'), replaceText: t('preview.screenreader.replaceText') },
});
