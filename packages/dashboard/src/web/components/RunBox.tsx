import { useId, useState } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Mode } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import type { RouteChange } from '../hooks/useRoute';
import { QUICK_RUN_REPEATS, usableModels, type RunOptions } from '../lib/quickRun';
import type { RunRef } from '../lib/runs';
import { Link } from './Link';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type Props = {
  view: ConfigView; busy: boolean;
  /** Runs of this task that are queued or running. */
  active: RunRef[];
  onRun: (options: RunOptions) => void; onCompare: () => void;
  navigate: (change: RouteChange) => void;
};

const MAX_REPEATS = 20;

/** Model, mode and repeat count for one more run of this task, with a link to the experiment builder for several conditions at once. */
export function RunBox({ view, busy, active, onRun, onCompare, navigate }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<Mode>('keyboard'), [modelId, setModelId] = useState(''), [repeats, setRepeats] = useState(String(QUICK_RUN_REPEATS));
  const models = usableModels(view.config, view.credentialStatus, mode);
  const model = models.find(item => item.id === modelId) ?? models[0];
  const count = Number(repeats), valid = Number.isInteger(count) && count >= 1 && count <= MAX_REPEATS;
  const newest = active[0];
  return <form aria-label={t('runBox.label')} className="grid w-full gap-3 rounded-xl border bg-card p-4 sm:w-[22rem]"
    onSubmit={event => { event.preventDefault(); if (model && valid && !busy) onRun({ modelId: model.id, mode, repeats: count }); }}>
    <div className="grid grid-cols-2 gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={id + '-model'} className="text-xs text-muted-foreground">{t('runBox.model')}</Label>
        <Select value={model?.id ?? ''} onValueChange={setModelId} disabled={models.length === 0}>
          <SelectTrigger id={id + '-model'} className="h-9 w-full"><SelectValue placeholder={t('runBox.noModelShort')} /></SelectTrigger>
          <SelectContent>{models.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id + '-mode'} className="text-xs text-muted-foreground">{t('runBox.mode')}</Label>
        <Select value={mode} onValueChange={value => setMode(value as Mode)}>
          <SelectTrigger id={id + '-mode'} className="h-9 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="keyboard">{t('sidebar.modes.keyboard')}</SelectItem>
            <SelectItem value="screenreader">{t('sidebar.modes.screenreader')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
    <div className="grid gap-1.5">
      <Label htmlFor={id + '-repeats'} className="text-xs text-muted-foreground">{t('runBox.repeats')}</Label>
      <Input id={id + '-repeats'} type="number" min={1} max={MAX_REPEATS} className="h-9" value={repeats} aria-describedby={id + '-repeats-hint'} aria-invalid={!valid} onChange={event => setRepeats(event.target.value)} />
      <p id={id + '-repeats-hint'} className="text-xs leading-5 text-muted-foreground">{t('runBox.repeatsHint', { max: MAX_REPEATS })}</p>
    </div>
    <Button type="submit" size="xl" disabled={busy || !model || !valid}><Play aria-hidden="true" />{t('runBox.run')}</Button>
    {models.length === 0 && <p role="status" className="text-xs leading-5 text-muted-foreground">
      {t(mode === 'keyboard' ? 'quickRun.noModel' : 'runBox.noTextModel')} <Link to={{ view: 'settings', section: 'models' }} navigate={navigate} className="text-primary underline underline-offset-2">{t('runBox.toModels')}</Link>
    </p>}
    {newest && <p role="status" className="text-xs leading-5 text-muted-foreground">
      {t('runBox.active', { count: active.length })} <Link to={{ task: newest.run.taskId, run: newest.run.id }} navigate={navigate} className="text-primary underline underline-offset-2">{t('runBox.openActive')}</Link>
    </p>}
    <Button type="button" variant="link" className="h-auto justify-self-start p-0 text-[13px]" onClick={onCompare}>{t('task.compare')}</Button>
  </form>;
}
