import { useEffect, useState } from 'react';
import { RAWSTEP_DEFAULTS } from '@rawstep/core/defaults';
import { useTranslation } from 'react-i18next';
import { Advanced, Choice, Field } from './forms';

type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {};
const format = (value: unknown) => JSON.stringify(value, null, 2);

type Props = {
  /** An environment preset name ('default', 'narrow', …) or a custom environment object. */
  value: unknown;
  onChange: (value: unknown) => void;
  /** Built-in presets from the server; editing a field turns a preset into a custom object based on it. */
  presets: Record<string, unknown>;
  /** Id written into a custom environment object. */
  id: string;
};

/** Edits the one page environment of a run profile: a preset, screen size, text scale and color settings, plus raw JSON. */
export function EnvironmentFields({ value, onChange, presets, id }: Props) {
  const { t } = useTranslation();
  const preset = typeof value === 'string' ? value : 'custom';
  const resolved = typeof value === 'string' ? { ...object(presets[value]), id: value } : object(value);
  const custom = (part: Json) => onChange({ ...resolved, id, ...part });
  const viewport = { ...RAWSTEP_DEFAULTS.viewport, ...object(resolved.viewport) };
  const zoom = typeof resolved.browserZoom === 'number' ? resolved.browserZoom : 1;
  const [text, setText] = useState(() => format(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    let same = false;
    try { same = JSON.stringify(JSON.parse(text)) === JSON.stringify(value); } catch { /* keep the draft the user is typing */ }
    if (!same && !invalid) setText(format(value));
  }, [value]);
  const editJson = (next: string) => {
    setText(next);
    try { const parsed: unknown = JSON.parse(next); setInvalid(false); onChange(parsed); } catch { setInvalid(true); }
  };
  return <div className="grid gap-5">
    <div className="grid gap-1.5">
      <Choice label={t('environmentFields.preset')} value={preset} options={[...Object.keys(presets).map(name => ({ id: name, name: t(`environmentFields.presets.${name}.name`, { defaultValue: name }) })), { id: 'custom', name: t('environmentFields.custom') }]}
        onChange={next => onChange(next === 'custom' ? { ...resolved, id } : next)} />
      <p className="text-[13px] leading-5">{preset === 'custom' ? t('environmentFields.customHint') : t(`environmentFields.presets.${preset}.hint`, { defaultValue: '' })}</p>
      {preset !== 'custom' && <p className="text-xs leading-5 text-muted-foreground">{t('environmentFields.editNote')}</p>}
    </div>
    <div className="grid items-end gap-4 sm:grid-cols-3">
      <Field label={t('environmentFields.viewportWidth')} type="number" value={String(viewport.width)} onChange={width => custom({ viewport: { ...viewport, width: Number(width) } })} />
      <Field label={t('environmentFields.viewportHeight')} type="number" value={String(viewport.height)} onChange={height => custom({ viewport: { ...viewport, height: Number(height) } })} />
      <Field label={t('environmentFields.textScale')} type="number" value={String(resolved.textScale ?? 1)} onChange={textScale => custom({ textScale: Number(textScale) })} />
    </div>
    <div className="grid items-end gap-4 sm:grid-cols-3">
      <Choice label={t('environmentFields.colorScheme')} value={String(resolved.colorScheme ?? 'light')} onChange={colorScheme => custom({ colorScheme })}
        options={[{ id: 'light', name: t('environmentFields.schemeLight') }, { id: 'dark', name: t('environmentFields.schemeDark') }, { id: 'no-preference', name: t('environmentFields.noPreference') }]} />
      <Choice label={t('environmentFields.reducedMotion')} value={String(resolved.reducedMotion ?? 'no-preference')} onChange={reducedMotion => custom({ reducedMotion })}
        options={[{ id: 'no-preference', name: t('environmentFields.noPreference') }, { id: 'reduce', name: t('environmentFields.motionReduce') }]} />
      <Choice label={t('environmentFields.browserZoom')} value={String(zoom)} onChange={browserZoom => custom({ browserZoom: Number(browserZoom) })}
        options={[...new Set([1, 2, 4, zoom])].sort((a, b) => a - b).map(factor => ({ id: String(factor), name: `${Math.round(factor * 100)}%` }))} />
    </div>
    <Advanced description={t('environmentFields.note')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Choice label={t('environmentFields.forcedColors')} value={String(resolved.forcedColors ?? 'none')} onChange={forcedColors => custom({ forcedColors })}
          options={[{ id: 'none', name: t('environmentFields.forcedNone') }, { id: 'active', name: t('environmentFields.forcedActive') }]} />
        <Choice label={t('environmentFields.contrast')} value={String(resolved.contrast ?? 'no-preference')} onChange={contrast => custom({ contrast })}
          options={[{ id: 'no-preference', name: t('environmentFields.noPreference') }, { id: 'more', name: t('environmentFields.contrastMore') }]} />
      </div>
      <Field label={t('environmentFields.json')} multiline value={text} onChange={editJson} hint={invalid ? t('environmentFields.invalidJson') : t('environmentFields.jsonHint')} />
    </Advanced>
  </div>;
}
