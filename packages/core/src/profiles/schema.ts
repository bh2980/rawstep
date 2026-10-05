import type { EnvironmentProfile } from './types.js';
export const DEFAULT_PROFILE: EnvironmentProfile = Object.freeze({ id: 'default', viewport: { width: 1280, height: 800 }, browserZoom: 1, textScale: 1, colorScheme: 'light', forcedColors: 'none', contrast: 'no-preference', reducedMotion: 'no-preference', nativeMagnifier: 'not-requested', nativeHighContrast: 'not-requested', diagnostics: true, requireApplied: true });
export const BUILTIN_PROFILES: Readonly<Record<string, Partial<EnvironmentProfile>>> = Object.freeze({
  default: {}, narrow: { viewport: { width: 320, height: 800 } }, 'zoom-200': { browserZoom: 2 }, 'zoom-400': { browserZoom: 4 },
  'text-200': { textScale: 2 }, spacing: { textSpacing: { lineHeight: 1.5, letterSpacingEm: .12, wordSpacingEm: .16, paragraphSpacingEm: 2 } },
  'reflow-text': { viewport: { width: 320, height: 800 }, textScale: 2 }, 'forced-colors': { forcedColors: 'active' }, contrast: { contrast: 'more' }, dark: { colorScheme: 'dark' }, 'reduced-motion': { reducedMotion: 'reduce' },
});
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function resolveEnvironmentProfile(value: unknown = {}): EnvironmentProfile {
  if (typeof value === 'string') { if (!Object.hasOwn(BUILTIN_PROFILES, value)) throw new Error(`Unknown profile ${value}.`); value = { ...BUILTIN_PROFILES[value], id: value }; }
  if (!object(value)) throw new Error('Environment profile must be an object or built-in name.');
  const allowed = Object.keys(DEFAULT_PROFILE).concat('textSpacing', 'at');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown environment profile field ${key}.`);
  const p = { ...structuredClone(DEFAULT_PROFILE), ...structuredClone(value) } as EnvironmentProfile;
  if (typeof p.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(p.id)) throw new Error('Profile id must be a safe unique identifier.');
  if (!object(p.viewport) || Object.keys(p.viewport).some(k => !['width','height'].includes(k)) || !Number.isInteger(p.viewport.width) || !Number.isInteger(p.viewport.height) || !number(p.viewport.width, 240, 7680) || !number(p.viewport.height, 200, 4320)) throw new Error('Profile viewport must be 240–7680 by 200–4320 pixels.');
  if (!number(p.browserZoom, .5, 5) || !number(p.textScale, 1, 4)) throw new Error('browserZoom must be .5–5 and textScale 1–4.');
  for (const [key, values] of Object.entries({ colorScheme: ['light','dark','no-preference'], forcedColors: ['none','active'], contrast: ['no-preference','more'], reducedMotion: ['no-preference','reduce'], nativeMagnifier: ['not-requested','required'], nativeHighContrast: ['not-requested','required'] })) if (!values.includes(String(p[key as keyof EnvironmentProfile]))) throw new Error(`Invalid profile ${key}.`);
  if (typeof p.diagnostics !== 'boolean' || typeof p.requireApplied !== 'boolean') throw new Error('Profile diagnostics and requireApplied must be booleans.');
  if (p.textSpacing) {
    if (!object(p.textSpacing) || Object.keys(p.textSpacing).sort().join(',') !== 'letterSpacingEm,lineHeight,paragraphSpacingEm,wordSpacingEm' || !number(p.textSpacing.lineHeight, 1, 4) || !number(p.textSpacing.letterSpacingEm, 0, 1) || !number(p.textSpacing.wordSpacingEm, 0, 2) || !number(p.textSpacing.paragraphSpacingEm, 0, 5)) throw new Error('Invalid text spacing profile.');
  }
  if (p.at && (!object(p.at) || Object.keys(p.at).some(k => !['name','version','configuration'].includes(k)) || typeof p.at.name !== 'string' || !p.at.name.trim() || Object.values(p.at).some(v => typeof v !== 'string' || v.length > 500))) throw new Error('Invalid AT profile metadata.');
  return p;
}
