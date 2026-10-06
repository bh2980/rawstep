import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Permissions, RunProfile } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import { intentLabel } from '../i18n/labels';
import { applyKeyboardPreset, applyScreenreaderPreset, keyboardPreset, KEYBOARD_BASIC, KEYBOARD_WIDGETS, quickAvailable, quickIntents, SCREENREADER_BASIC, screenreaderPreset, type KeyboardPreset, type ScreenreaderPreset } from '../lib/presets';
import { cn } from '../lib/utils';
import { Advanced, Toggle } from './forms';
import { Button } from './ui/button';

type Capabilities = ConfigView['capabilities'];
type Props = { value: RunProfile['permissions']; onChange: (permissions: RunProfile['permissions']) => void; capabilities: Capabilities };

/** A radio option with a name, one line on when to use it and the actions it allows. */
function Option({ group, name, when, actions, checked, disabled, onSelect, children }: { group: string; name: string; when: string; actions?: string; checked: boolean; disabled?: boolean; onSelect: () => void; children?: ReactNode }) {
  return <label className={cn('flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-disabled:cursor-not-allowed has-disabled:opacity-60', checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/50')}>
    <input type="radio" name={group} checked={checked} disabled={disabled} onChange={onSelect} className="mt-1 size-4 shrink-0 accent-primary" />
    <span className="grid min-w-0 flex-1 gap-1">
      <span className="text-sm font-medium">{name}</span>
      <span className="text-[13px] leading-5 text-muted-foreground">{when}</span>
      {actions && <span className="font-mono text-xs text-muted-foreground">{actions}</span>}
      {children}
    </span>
  </label>;
}

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
  const group = useId();
  const detected = keyboardPreset(value);
  // Picking "직접 고르기" keeps the keys as they are, so the choice is remembered here until a preset is picked.
  const [custom, setCustom] = useState(detected === 'custom');
  const current: KeyboardPreset = custom ? 'custom' : detected;
  const pick = (preset: KeyboardPreset) => { setCustom(preset === 'custom'); if (preset !== 'custom') onChange(applyKeyboardPreset(value, preset)); };
  return <fieldset className="grid gap-2">
    <legend className="mb-1 text-sm font-semibold">{t('presets.keyboard.title')}</legend>
    <Option group={group} name={t('presets.keyboard.basic.name')} when={t('presets.keyboard.basic.when')} actions={KEYBOARD_BASIC.join(' · ')} checked={current === 'basic'} onSelect={() => pick('basic')} />
    <Option group={group} name={t('presets.keyboard.widgets.name')} when={t('presets.keyboard.widgets.when')} actions={t('presets.keyboard.widgets.keys', { extra: KEYBOARD_WIDGETS.slice(KEYBOARD_BASIC.length).join(' · ') })} checked={current === 'widgets'} onSelect={() => pick('widgets')} />
    <Option group={group} name={t('presets.keyboard.custom.name')} when={t('presets.keyboard.custom.when')} checked={current === 'custom'} onSelect={() => pick('custom')}>
      {current === 'custom' && <Chips label={t('presets.keyboard.custom.name')} available={capabilities.keys} selected={value.keys} display={name => name} unsupported={t('presets.unsupportedMark')} onToggle={name => onChange({ ...value, keys: toggle(value.keys, name) })} />}
    </Option>
    <div className="pt-2"><Typing value={value} onChange={onChange} /></div>
  </fieldset>;
}

function ScreenreaderActions({ value, onChange, capabilities }: { value: Permissions; onChange: (permissions: Permissions) => void; capabilities: Capabilities['screenreader'] }) {
  const { t } = useTranslation();
  const group = useId();
  const current: ScreenreaderPreset = screenreaderPreset(value, capabilities), quick = quickAvailable(capabilities);
  const pick = (preset: Exclude<ScreenreaderPreset, 'custom'>) => onChange(applyScreenreaderPreset(value, preset, capabilities));
  return <fieldset className="grid gap-2">
    <legend className="mb-1 text-sm font-semibold">{t('presets.screenreader.title')}</legend>
    <Option group={group} name={t('presets.screenreader.basic.name')} when={t('presets.screenreader.basic.when')} actions={SCREENREADER_BASIC.map(intentLabel).join(' · ')} checked={current === 'basic'} onSelect={() => pick('basic')} />
    <Option group={group} name={t('presets.screenreader.quick.name')} when={quick ? t('presets.screenreader.quick.when') : t('presets.screenreader.quick.unavailable')} actions={quick ? t('presets.screenreader.quick.extra', { extra: quickIntents(capabilities).map(intentLabel).join(' · ') }) : undefined} checked={current === 'quick'} disabled={!quick} onSelect={() => pick('quick')} />
    {current === 'custom' && <Option group={group} name={t('presets.screenreader.custom.name')} when={t('presets.screenreader.custom.when')} checked onSelect={() => undefined}>
      <Chips label={t('presets.screenreader.custom.name')} available={capabilities.intents} selected={value.intents} display={intentLabel} unsupported={t('presets.unsupportedMark')} onToggle={name => onChange({ ...value, intents: toggle(value.intents, name) })} />
    </Option>}
    <div className="pt-2"><Typing value={value} onChange={onChange} /></div>
  </fieldset>;
}

/** The "허용 행동" tab of a run profile: presets that say when each choice fits, and the rarer settings under 고급. */
export function PermissionPresets({ value, onChange, capabilities }: Props) {
  const { t } = useTranslation();
  const set = (mode: 'keyboard' | 'screenreader') => (permissions: Permissions) => onChange({ ...value, [mode]: permissions });
  return <div className="grid gap-5">
    <p className="text-[13px] leading-5 text-muted-foreground">{t('presets.intro')}</p>
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <KeyboardActions value={value.keyboard} onChange={set('keyboard')} capabilities={capabilities.keyboard} />
      <ScreenreaderActions value={value.screenreader} onChange={set('screenreader')} capabilities={capabilities.screenreader} />
    </div>
    <Advanced description={t('presets.advancedDescription')}>
      {(['keyboard', 'screenreader'] as const).map(mode => <Toggle key={mode} label={t(`presets.replaceText.${mode}`)} hint={t('presets.replaceTextHint')} checked={value[mode].replaceText} onChange={replaceText => set(mode)({ ...value[mode], replaceText })} />)}
    </Advanced>
  </div>;
}
