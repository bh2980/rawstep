import { RawstepError } from '@rawstep/core/errors';
import { installProfileScript } from './page-script.js';
import { isVerifiedZoomController } from './native-zoom.js';
import type { Page } from 'playwright';
import type { AppliedProfile, EnvironmentProfile, ProfileSetting } from '@rawstep/core/profiles/types';
export * from '@rawstep/core/profiles/types';
export * from '@rawstep/core/profiles/schema';
export * from './diagnostics.js';
export { createChromiumTabZoomController } from './native-zoom.js';

export class ProfileApplicationError extends RawstepError {
  constructor(readonly appliedProfile: AppliedProfile) { super('unsupported-profile', 'One or more requested environment settings are unsupported or did not apply.', { outcome: { status: 'inconclusive', reason: 'unsupported-profile' } }); this.name = 'ProfileApplicationError'; }
}
import type { NativeZoomController } from './ports.js';
export type { NativeZoomController } from './ports.js';
/** Optional native browser-UI integration. CSS zoom, deviceScaleFactor and CDP pinch are not accepted substitutes. */
export async function applyProfile(page: Page, profile: EnvironmentProfile, options: { nativeZoom?: NativeZoomController } = {}): Promise<AppliedProfile> {
  const settings: ProfileSetting[] = [];
  const before = await page.evaluate(() => ({ dpr: devicePixelRatio, width: innerWidth, scale: visualViewport?.scale ?? 1 }));
  if (profile.browserZoom !== 1) {
    if (!options.nativeZoom || !isVerifiedZoomController(options.nativeZoom)) settings.push({ name: 'browserZoom', requested: profile.browserZoom, observed: 1, status: 'unsupported', mechanism: 'browser-native', detail: 'No independently paired Chromium tabs-zoom controller is available. Caller-returned factors and DPR changes alone are not native zoom proof. Viewport/CSS/CDP pinch are not browser zoom.' });
    else {
      const result = await options.nativeZoom(page, profile.browserZoom);
      const after = await page.evaluate(() => ({ dpr: devicePixelRatio, width: innerWidth, scale: visualViewport?.scale ?? 1 }));
      const actual = after.dpr / before.dpr;
      const matches = Math.abs(actual - profile.browserZoom) < .06 && Math.abs(result.observedFactor - profile.browserZoom) < .06 && Math.abs(after.scale - 1) < .01 && Math.abs(after.width * actual - before.width) < 5;
      settings.push({ name: 'browserZoom', requested: profile.browserZoom, observed: { ...after, factor: actual, controller: result.observedFactor }, status: matches ? 'applied' : 'mismatch', mechanism: 'browser-native', detail: result.method });
    }
  } else settings.push({ name: 'browserZoom', requested: 1, observed: 1, status: 'applied', mechanism: 'browser-native', detail: 'Fresh browser context default; no page-scale override requested.' });
  const viewport = page.viewportSize();
  settings.push({ name: 'viewport', requested: profile.viewport, observed: viewport, status: viewport?.width === profile.viewport.width && viewport.height === profile.viewport.height ? 'applied' : 'mismatch', mechanism: 'viewport' });
  const media = await page.evaluate(() => ({ forcedColors: matchMedia('(forced-colors: active)').matches ? 'active' : 'none', contrast: matchMedia('(prefers-contrast: more)').matches ? 'more' : 'no-preference', reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference', colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' }));
  for (const name of ['forcedColors','contrast','reducedMotion','colorScheme'] as const) settings.push({ name, requested: profile[name], observed: media[name], status: profile[name] === media[name] || (name === 'colorScheme' && profile[name] === 'no-preference') ? 'applied' : 'mismatch', mechanism: 'browser-media-emulation', detail: 'matchMedia verified browser media behavior; native OS settings were not changed.' });
  settings.push(...await verifyProfileStyles(page, profile));
  for (const name of ['nativeMagnifier','nativeHighContrast'] as const) settings.push({ name, requested: profile[name], status: profile[name] === 'required' ? 'unsupported' : 'not-requested', mechanism: 'native-os', detail: 'This adapter does not control or emulate native OS accessibility settings.' });
  const result: AppliedProfile = { profile, settings, supported: settings.every(s => s.status !== 'unsupported' && s.status !== 'mismatch'), verifiedAt: new Date().toISOString(), browser: 'chromium', browserVersion: page.context().browser()?.version() ?? 'unknown', platform: process.platform,
    limitations: ['Browser media emulation and page user styles are not native OS modes.', 'CSS overflow, overlap and focus checks are independent heuristics, never model observations.', 'AT name/version expectations are checked independently by the runner.'] };
  if (profile.requireApplied && !result.supported) throw new ProfileApplicationError(result);
  return result;
}

/** Install page-local user styles before navigation; compute all base sizes before applying overrides. */
export async function installProfileStyles(page: Page, profile: EnvironmentProfile): Promise<void> {
  if (profile.textScale === 1 && !profile.textSpacing) return;
  await installProfileScript(page, ({ textScale, spacing }: {textScale:number;spacing:EnvironmentProfile['textSpacing']}) => {
    const apply = () => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>('body,body *'));
      const original = elements.map(el => ({ el, font: parseFloat(getComputedStyle(el).fontSize) }));
      for (const { el, font } of original) {
        if (textScale !== 1 && Number.isFinite(font)) el.style.setProperty('font-size', `${font * textScale}px`, 'important');
        if (spacing) { el.style.setProperty('line-height', String(spacing.lineHeight), 'important'); el.style.setProperty('letter-spacing', `${spacing.letterSpacingEm}em`, 'important'); el.style.setProperty('word-spacing', `${spacing.wordSpacingEm}em`, 'important'); if (el.tagName === 'P') el.style.setProperty('margin-bottom', `${spacing.paragraphSpacingEm}em`, 'important'); }
      }
      const known = new WeakSet(original.map(x=>x.el));
      (window as unknown as { __rawstepMeasureProfile: () => unknown }).__rawstepMeasureProfile = () => {
        const body = document.body ? getComputedStyle(document.body) : null; const paragraph = document.querySelector('p');
        return { textScale, unprofiledNodes:Array.from(document.querySelectorAll('body,body *')).filter(el=>!known.has(el as HTMLElement)).length, samples: original.filter(x => x.font > 0 && x.el.isConnected).map(x => ({ baseline: x.font, actual: parseFloat(getComputedStyle(x.el).fontSize) })), spacing: spacing && body ? original.filter(x=>x.el.isConnected).map(({el})=>{const c=getComputedStyle(el);return {fontSize:parseFloat(c.fontSize),lineHeight:parseFloat(c.lineHeight),letterSpacing:parseFloat(c.letterSpacing),wordSpacing:parseFloat(c.wordSpacing),paragraph:el.tagName==='P'?{fontSize:parseFloat(c.fontSize),margin:parseFloat(c.marginBottom)}:null}}) : null };
      };
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true }); else apply();
  }, { textScale: profile.textScale, spacing: profile.textSpacing });
}

export async function verifyProfileStyles(page: Page, profile: EnvironmentProfile): Promise<ProfileSetting[]> {
  const styles = await page.evaluate(() => (window as unknown as { __rawstepMeasureProfile?: () => { unprofiledNodes:number;samples:{baseline:number;actual:number}[];spacing:null|{fontSize:number;lineHeight:number;letterSpacing:number;wordSpacing:number;paragraph:null|{fontSize:number;margin:number}}[] } }).__rawstepMeasureProfile?.() ?? null);
  const result: ProfileSetting[] = [{name:'textScale',requested:profile.textScale,observed:styles?.samples??null,status:profile.textScale===1 || (!!styles?.samples.length && styles.unprofiledNodes===0 && styles.samples.every(s=>Math.abs(s.actual/s.baseline-profile.textScale)<.03))?'applied':'mismatch',mechanism:'browser-content-user-style',detail:'Computed font-size multiplication, not native browser text-only zoom or OS magnification. All initially styled nodes are remeasured; newly inserted unprofiled nodes cause a mismatch rather than an applied claim.'}];
  if(profile.textSpacing){const a=styles?.spacing;const e=profile.textSpacing;const close=(x:number,y:number)=>Number.isFinite(x)&&Math.abs(x-y)<.6; const match=!!a?.length&&styles?.unprofiledNodes===0&&a.every(v=>close(v.lineHeight,v.fontSize*e.lineHeight)&&close(v.letterSpacing,v.fontSize*e.letterSpacingEm)&&close(v.wordSpacing,v.fontSize*e.wordSpacingEm)&&(!v.paragraph||close(v.paragraph.margin,v.paragraph.fontSize*e.paragraphSpacingEm)));result.push({name:'textSpacing',requested:e,observed:a,status:match?'applied':'mismatch',mechanism:'browser-content-user-style',detail:'Computed spacing is checked for every initially styled element/paragraph; dynamic unprofiled nodes cause a mismatch.'});}
  return result;
}
export async function verifyLiveProfile(page: Page, profile: EnvironmentProfile): Promise<ProfileSetting[]> {
  const values=await page.evaluate(()=>({forcedColors:matchMedia('(forced-colors: active)').matches?'active':'none',contrast:matchMedia('(prefers-contrast: more)').matches?'more':'no-preference',reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches?'reduce':'no-preference'}));
  return [...await verifyProfileStyles(page,profile),...(['forcedColors','contrast','reducedMotion'] as const).map(name=>({name,requested:profile[name],observed:values[name],status:profile[name]===values[name]?'applied' as const:'mismatch' as const,mechanism:'browser-media-emulation' as const}))];
}
