import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const CUSTOM = '__custom__';

/**
 * The page a profile's runs get, as one select: a built-in environment by name, or 사용자 지정 once its values were changed.
 * `· 바꿈` follows anything but the default. The values themselves are edited with `EnvironmentFields`.
 */
export function PageEnvironmentSelect({ value, onChange, presets, id }: { value: unknown; onChange: (value: unknown) => void; presets: Record<string, unknown>; /** Written into a custom environment. */ id: string }) {
  const { t } = useTranslation();
  const current = typeof value === 'string' ? value : CUSTOM;
  const name = (preset: string) => preset === CUSTOM ? t('environmentFields.custom') : t(`environmentFields.presets.${preset}.name`, { defaultValue: preset });
  return <Select value={current} onValueChange={next => onChange(next === CUSTOM ? { ...(typeof value === 'object' && value ? value : presets[current] as object), id } : next)}>
    <SelectTrigger aria-label={t('environmentFields.preset')} className="w-52 max-w-full">
      <SelectValue>{name(current)}{current !== 'default' && <span className="ml-1 font-medium text-foreground">· {t('profile.changedMark')}</span>}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      {Object.keys(presets).map(preset => <SelectItem key={preset} value={preset}>{name(preset)}</SelectItem>)}
      <SelectItem value={CUSTOM}>{name(CUSTOM)}</SelectItem>
    </SelectContent>
  </Select>;
}
