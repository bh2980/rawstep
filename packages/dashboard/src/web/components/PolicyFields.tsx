import { useTranslation } from 'react-i18next';
import type { Policy } from '@rawstep/project/config';
import { Advanced, Choice, Field, Toggle } from './forms';

/**
 * When a run stops before its limits, as two separate things: Rawstep stopping it when a screen repeats (the repetition guard and its
 * limits), and the model stopping itself by choosing "uncertain" or "stuck". Turning one off does not turn off the other.
 */
export function PolicyFields({ value, onChange }: { value: Policy; onChange: (policy: Policy) => void }) {
  const { t } = useTranslation();
  const set = (part: Partial<Policy>) => onChange({ ...value, ...part });
  return <div className="grid gap-6">
    <section aria-labelledby="policy-guard" className="grid gap-3">
      <div className="grid gap-0.5 border-b border-edge pb-1.5">
        <h4 id="policy-guard" className="text-sm font-semibold">{t('policyFields.guardTitle')}</h4>
        <p className="text-[13px] leading-5 text-muted-foreground">{t('policyFields.guardIntro')}</p>
      </div>
      <Choice label={t('policyFields.repetitionGuard')} value={value.repetitionGuard} onChange={repetitionGuard => set({ repetitionGuard: repetitionGuard as Policy['repetitionGuard'] })}
        options={[{ id: 'auto', name: t('policyFields.repetitionAuto') }, { id: 'on', name: t('policyFields.repetitionOn') }, { id: 'off', name: t('policyFields.repetitionOff') }]} />
      <p className="-mt-1 text-xs leading-5 text-muted-foreground">{t('policyFields.repetitionHint')}</p>
      <div className="grid items-end gap-4 sm:grid-cols-2">
        <Field label={t('policyFields.maxStateVisits')} type="number" value={String(value.maxStateVisits)} onChange={s => set({ maxStateVisits: Number(s) })} />
        <Field label={t('policyFields.maxUnchangedTransitions')} type="number" value={String(value.maxUnchangedTransitions)} onChange={s => set({ maxUnchangedTransitions: Number(s) })} />
      </div>
      <p className="-mt-1 text-xs leading-5 text-muted-foreground">{t('policyFields.limitsHint')}</p>
    </section>
    <section aria-labelledby="policy-model" className="grid gap-3">
      <div className="grid gap-0.5 border-b border-edge pb-1.5">
        <h4 id="policy-model" className="text-sm font-semibold">{t('policyFields.modelTitle')}</h4>
        <p className="text-[13px] leading-5 text-muted-foreground">{t('policyFields.modelIntro')}</p>
      </div>
      <Toggle label={t('policyFields.modelGiveUp')} hint={value.modelGiveUp ? t('policyFields.modelGiveUpOn') : t('policyFields.modelGiveUpOff')} checked={value.modelGiveUp} onChange={modelGiveUp => set({ modelGiveUp })} />
    </section>
    <Advanced description={t('policyFields.advancedDescription')}>
      <Field label={t('policyFields.historyLimit')} type="number" value={String(value.historyLimit)} onChange={s => set({ historyLimit: Number(s) })} hint={t('policyFields.historyLimitHint')} />
      <Toggle label={t('policyFields.focusGate')} hint={t('policyFields.focusGateHint')} checked={value.focusGate} onChange={focusGate => set({ focusGate })} />
    </Advanced>
  </div>;
}
