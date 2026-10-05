import { useTranslation } from 'react-i18next';
import type { Policy } from '@rawstep/project/config';
import { Advanced, Choice, Field, Toggle } from './forms';

/** Stuck-detection settings: the two everyone understands up front, the numeric limits under "advanced". */
export function PolicyFields({ value, onChange }: { value: Policy; onChange: (policy: Policy) => void }) {
  const { t } = useTranslation();
  const set = (part: Partial<Policy>) => onChange({ ...value, ...part });
  return <div className="grid gap-5">
    <div className="grid gap-2">
      <Choice label={t('policyFields.repetitionGuard')} value={value.repetitionGuard} onChange={repetitionGuard => set({ repetitionGuard: repetitionGuard as Policy['repetitionGuard'] })}
        options={[{ id: 'auto', name: t('policyFields.repetitionAuto') }, { id: 'on', name: t('policyFields.repetitionOn') }, { id: 'off', name: t('policyFields.repetitionOff') }]} />
      <p className="text-xs leading-5 text-muted-foreground">{t('policyFields.repetitionHint')}</p>
    </div>
    <Toggle label={t('policyFields.modelGiveUp')} hint={t('policyFields.modelGiveUpHint')} checked={value.modelGiveUp} onChange={modelGiveUp => set({ modelGiveUp })} />
    <Advanced description={t('policyFields.advancedDescription')}>
      <Field label={t('policyFields.historyLimit')} type="number" value={String(value.historyLimit)} onChange={s => set({ historyLimit: Number(s) })} hint={t('policyFields.historyLimitHint')} />
      <Field label={t('policyFields.maxStateVisits')} type="number" value={String(value.maxStateVisits)} onChange={s => set({ maxStateVisits: Number(s) })} hint={t('policyFields.maxStateVisitsHint')} />
      <Field label={t('policyFields.maxUnchangedTransitions')} type="number" value={String(value.maxUnchangedTransitions)} onChange={s => set({ maxUnchangedTransitions: Number(s) })} hint={t('policyFields.maxUnchangedTransitionsHint')} />
      <Toggle label={t('policyFields.focusGate')} hint={t('policyFields.focusGateHint')} checked={value.focusGate} onChange={focusGate => set({ focusGate })} />
    </Advanced>
  </div>;
}
