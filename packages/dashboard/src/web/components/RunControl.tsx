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
const label = 'text-[11px] leading-4 font-medium tracking-[0.08em] text-muted-foreground uppercase';

/**
 * Run control (spec §15): the model, the mode, how many times, and the run button. It sits inside the task header, set off by a rule,
 * not in a card of its own. The element has the id `task-run-control` so an empty state can send a person to it.
 */
export function RunControl({ view, busy, active, onRun, onCompare, navigate }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<Mode>('keyboard'), [modelId, setModelId] = useState(''), [repeats, setRepeats] = useState(String(QUICK_RUN_REPEATS));
  const models = usableModels(view.config, view.credentialStatus, mode);
  const model = models.find(item => item.id === modelId) ?? models[0];
  const count = Number(repeats), valid = Number.isInteger(count) && count >= 1 && count <= MAX_REPEATS;
  const newest = active[0];
  return <form id="task-run-control" aria-labelledby={id + '-title'} className="grid content-start gap-3"
    onSubmit={event => { event.preventDefault(); if (model && valid && !busy) onRun({ modelId: model.id, mode, repeats: count }); }}>
    <h2 id={id + '-title'} lang="en" className={label}>{t('labels.runControl')}</h2>
    <div className="grid gap-1">
      <Label htmlFor={id + '-model'} className={label}>{t('runBox.model')}</Label>
      <Select value={model?.id ?? ''} onValueChange={setModelId} disabled={models.length === 0}>
        <SelectTrigger id={id + '-model'} className="h-9 w-full"><SelectValue placeholder={t('runBox.noModelShort')} /></SelectTrigger>
        <SelectContent>{models.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-end gap-2">
      <div className="grid gap-1">
        <Label htmlFor={id + '-mode'} className={label}>{t('runBox.mode')}</Label>
        <Select value={mode} onValueChange={value => setMode(value as Mode)}>
          <SelectTrigger id={id + '-mode'} className="h-9 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="keyboard">{t('sidebar.modes.keyboard')}</SelectItem>
            <SelectItem value="screenreader">{t('sidebar.modes.screenreader')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={id + '-repeats'} className={label}>{t('runBox.repeats')}</Label>
        <Input id={id + '-repeats'} type="number" min={1} max={MAX_REPEATS} className="h-9" value={repeats} aria-describedby={id + '-repeats-hint'} aria-invalid={!valid} onChange={event => setRepeats(event.target.value)} />
      </div>
      <Button type="submit" className="h-9 px-4" disabled={busy || !model || !valid}><Play aria-hidden="true" />{t('runBox.run')}</Button>
    </div>
    <p id={id + '-repeats-hint'} className="text-xs leading-5 text-muted-foreground">{t('runBox.repeatsHint', { max: MAX_REPEATS })}</p>
    {models.length === 0 && <p role="status" className="text-xs leading-5 text-muted-foreground">
      {t(mode === 'keyboard' ? 'quickRun.noModel' : 'runBox.noTextModel')} <Link to={{ view: 'settings', section: 'models' }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.toModels')}</Link>
    </p>}
    {newest && <p role="status" className="text-xs leading-5 text-muted-foreground">
      {t('runBox.active', { count: active.length })} <Link to={{ task: newest.run.taskId, run: newest.run.id }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.openActive')}</Link>
    </p>}
    <Button type="button" variant="link" className="h-auto justify-self-start p-0 text-[13px]" onClick={onCompare}>{t('task.compare')}</Button>
  </form>;
}
