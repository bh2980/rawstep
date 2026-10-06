import { useId, useState } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { profileModel, taskProfile, type Mode } from '@rawstep/project/config';
import type { ConfigView } from '../../shared/config';
import type { RouteChange } from '../hooks/useRoute';
import { QUICK_RUN_REPEATS, profileProblem, type RunOptions } from '../lib/quickRun';
import type { RunRef } from '../lib/runs';
import { Link } from './Link';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type Props = {
  view: ConfigView; busy: boolean;
  /** The task, for its own run profile (the default choice). */
  taskId: string;
  /** Runs of this task that are queued or running. */
  active: RunRef[];
  onRun: (options: RunOptions) => void; onCompare: () => void;
  navigate: (change: RouteChange) => void;
};

const MAX_REPEATS = 20;
const label = 'text-[11px] leading-4 font-medium tracking-[0.08em] text-muted-foreground uppercase';

/**
 * Run control (spec §15): the mode, the run profile (which brings the model), how many times, and the run button. It sits inside the
 * task header, set off by a rule, not in a card of its own. The element has the id `task-run-control` so an empty state can send a
 * person to it.
 */
export function RunControl({ view, busy, taskId, active, onRun, onCompare, navigate }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const { config } = view, own = taskProfile(config, config.tasks.find(task => task.id === taskId) ?? {});
  const [mode, setMode] = useState<Mode>('keyboard'), [profileId, setProfileId] = useState(own.id), [repeats, setRepeats] = useState(String(QUICK_RUN_REPEATS));
  const profile = config.profiles.find(p => p.id === profileId) ?? own;
  const model = profileModel(config, profile), problem = profileProblem(config, view.credentialStatus, profile, mode);
  const count = Number(repeats), valid = Number.isInteger(count) && count >= 1 && count <= MAX_REPEATS;
  const newest = active[0];
  return <form id="task-run-control" aria-labelledby={id + '-title'} className="grid content-start gap-3"
    onSubmit={event => { event.preventDefault(); if (!problem && valid && !busy) onRun({ mode, profileId: profile.id, repeats: count }); }}>
    <h2 id={id + '-title'} lang="en" className={label}>{t('labels.runControl')}</h2>
    <div className="grid grid-cols-2 gap-2">
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
        <Label htmlFor={id + '-profile'} className={label}>{t('runBox.profile')}</Label>
        <Select value={profile.id} onValueChange={setProfileId}>
          <SelectTrigger id={id + '-profile'} className="h-9 w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{config.profiles.map(item => <SelectItem key={item.id} value={item.id}>{item.id === own.id ? t('runBox.ownProfile', { name: item.name }) : item.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">{model ? t('runBox.modelLine', { model: model.name }) : t('runBox.noModelLine')}</p>
    <div className="grid grid-cols-[4.5rem_auto] items-end justify-start gap-2">
      <div className="grid gap-1">
        <Label htmlFor={id + '-repeats'} className={label}>{t('runBox.repeats')}</Label>
        <Input id={id + '-repeats'} type="number" min={1} max={MAX_REPEATS} className="h-9" value={repeats} aria-describedby={id + '-repeats-hint'} aria-invalid={!valid} onChange={event => setRepeats(event.target.value)} />
      </div>
      <Button type="submit" className="h-9 px-4" disabled={busy || !!problem || !valid}><Play aria-hidden="true" />{t('runBox.runMode', { mode: t(`sidebar.modes.${mode}`) })}</Button>
    </div>
    <p id={id + '-repeats-hint'} className="text-xs leading-5 text-muted-foreground">{t('runBox.repeatsHint', { max: MAX_REPEATS })}</p>
    {problem && <p role="status" className="text-xs leading-5 text-inspect">
      {problem} <Link to={{ view: 'profiles' }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.toProfiles')}</Link>
    </p>}
    {newest && <p role="status" className="text-xs leading-5 text-muted-foreground">
      {t('runBox.active', { count: active.length })} <Link to={{ task: newest.run.taskId, run: newest.run.id }} navigate={navigate} className="text-trace underline underline-offset-2">{t('runBox.openActive')}</Link>
    </p>}
    <Button type="button" variant="link" className="h-auto justify-self-start p-0 text-[13px]" onClick={onCompare}>{t('task.compare')}</Button>
  </form>;
}
