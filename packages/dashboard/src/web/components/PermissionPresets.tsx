import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Permissions, RunProfile } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { intentLabel } from '../i18n/labels';
import { applyKeyboardPreset, applyScreenreaderPreset, keyboardPreset, KEYBOARD_BASIC, KEYBOARD_WIDGETS, quickAvailable, quickIntents, SCREENREADER_BASIC, screenreaderPreset, type KeyboardPreset, type ScreenreaderPreset } from '../lib/presets';
import { Advanced, Toggle } from './forms';
import { RadioRows } from './layout/RadioRows';
import { Button } from './ui/button';

type Capabilities = ConfigView['capabilities'];
type Props = { value: RunProfile['permissions']; onChange: (permissions: RunProfile['permissions']) => void; capabilities: Capabilities };

/** The chips of a hand-picked set of actions; an action the backend lacks stays visible so it can be removed. */
function Chips({ label, available, selected, display, onToggle, unsupported }: { label: string; available: readonly string[]; selected: readonly string[]; display: (name: string) => string; onToggle: (name: string) => void; unsupported: string }) {
  return <div role="group" aria-label={label} className="flex flex-wrap gap-1.5 pt-1">
    {[...new Set([...available, ...selected])].map(name => {
      const on = selected.includes(name), missing = !available.includes(name);
      return <Button key={name} type="button" variant={on ? 'secondary' : 'outline'} size="sm" aria-pressed={on} className="h-8 font-mono text-xs" onClick={() => onToggle(name)}>{display(name)}{missing && <span className="font-sans text-warning">{unsupported}</span>}</Button>;
    })}
  </div>;
}

const toggle = (list: readonly string[], name: string) => list.includes(name) ? list.filter(item => item !== name) : [...list, name];

function Typing({ value, onChange }: { value: Permissions; onChange: (permissions: Permissions) => void }) {
  const { t } = useTranslation();
  return <Toggle label={t('presets.typing')} hint={t('presets.typingHint')} checked={value.typeText} onChange={typeText => onChange({ ...value, typeText })} />;
}

function KeyboardActions({ value, onChange, capabilities }: { value: Permissions; onChange: (permissions: Permissions) => void; capabilities: Capabilities['keyboard'] }) {
  const { t } = useTranslation();
  const detected = keyboardPreset(value);
  // Picking "직접 고르기" keeps the keys as they are, so the choice is remembered here until a preset is picked.
  const [custom, setCustom] = useState(detected === 'custom');
  const current: KeyboardPreset = custom ? 'custom' : detected;
  const pick = (preset: KeyboardPreset) => { setCustom(preset === 'custom'); if (preset !== 'custom') onChange(applyKeyboardPreset(value, preset)); };
  return <div className="grid gap-3">
    <RadioRows legend={t('presets.keyboard.title')} value={current} onChange={pick} rows={[
      { id: 'basic', label: t('presets.keyboard.basic.name'), hint: t('presets.keyboard.basic.when'), detail: KEYBOARD_BASIC.join(' · ') },
      { id: 'widgets', label: t('presets.keyboard.widgets.name'), hint: t('presets.keyboard.widgets.when'), detail: t('presets.keyboard.widgets.keys', { extra: KEYBOARD_WIDGETS.slice(KEYBOARD_BASIC.length).join(' · ') }) },
      { id: 'custom', label: t('presets.keyboard.custom.name'), hint: t('presets.keyboard.custom.when') },
    ]} expanded={id => id === 'custom' ? <Chips label={t('presets.keyboard.custom.name')} available={capabilities.keys} selected={value.keys} display={name => name} unsupported={t('presets.unsupportedMark')} onToggle={name => onChange({ ...value, keys: toggle(value.keys, name) })} /> : null} />
    <Typing value={value} onChange={onChange} />
  </div>;
}

function ScreenreaderActions({ value, onChange, capabilities }: { value: Permissions; onChange: (permissions: Permissions) => void; capabilities: Capabilities['screenreader'] }) {
  const { t } = useTranslation();
  const current: ScreenreaderPreset = screenreaderPreset(value, capabilities), quick = quickAvailable(capabilities);
  const pick = (preset: ScreenreaderPreset) => { if (preset !== 'custom') onChange(applyScreenreaderPreset(value, preset, capabilities)); };
  return <div className="grid gap-3">
    <RadioRows legend={t('presets.screenreader.title')} value={current} onChange={pick} rows={[
      { id: 'basic', label: t('presets.screenreader.basic.name'), hint: t('presets.screenreader.basic.when'), detail: SCREENREADER_BASIC.map(intentLabel).join(' · ') },
      { id: 'quick', label: t('presets.screenreader.quick.name'), hint: quick ? t('presets.screenreader.quick.when') : t('presets.screenreader.quick.unavailable'), disabled: !quick, ...(quick ? { detail: t('presets.screenreader.quick.extra', { extra: quickIntents(capabilities).map(intentLabel).join(' · ') }) } : {}) },
      ...(current === 'custom' ? [{ id: 'custom' as const, label: t('presets.screenreader.custom.name'), hint: t('presets.screenreader.custom.when') }] : []),
    ]} expanded={id => id === 'custom' ? <Chips label={t('presets.screenreader.custom.name')} available={capabilities.intents} selected={value.intents} display={intentLabel} unsupported={t('presets.unsupportedMark')} onToggle={name => onChange({ ...value, intents: toggle(value.intents, name) })} /> : null} />
    <Typing value={value} onChange={onChange} />
  </div>;
}

/** The "허용 행동" tab of a run profile: large radio rows that say when each choice fits, and the rarer settings under 고급. */
export function PermissionPresets({ value, onChange, capabilities }: Props) {
  const { t } = useTranslation();
  const set = (mode: 'keyboard' | 'screenreader') => (permissions: Permissions) => onChange({ ...value, [mode]: permissions });
  return <div className="grid gap-5">
    <p className="text-[13px] leading-5 text-muted-foreground">{t('presets.intro')}</p>
    <div className="grid items-start gap-8 xl:grid-cols-2">
      <KeyboardActions value={value.keyboard} onChange={set('keyboard')} capabilities={capabilities.keyboard} />
      <ScreenreaderActions value={value.screenreader} onChange={set('screenreader')} capabilities={capabilities.screenreader} />
    </div>
    <Advanced description={t('presets.advancedDescription')}>
      {(['keyboard', 'screenreader'] as const).map(mode => <Toggle key={mode} label={t(`presets.replaceText.${mode}`)} hint={t('presets.replaceTextHint')} checked={value[mode].replaceText} onChange={replaceText => set(mode)({ ...value[mode], replaceText })} />)}
    </Advanced>
  </div>;
}
