import { Ban, CircleDashed, CircleHelp, Clock, LoaderCircle, Target, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { RunState } from '../../shared/config';
import { runStateLabel } from '../i18n/labels';
import { cn } from '../lib/utils';

const icons: Record<RunState, LucideIcon> = {
  queued: Clock, running: LoaderCircle, success: Target, failure: CircleDashed,
  inconclusive: CircleHelp, cancelled: Ban, interrupted: TriangleAlert,
};

/** State as icon plus text, so it never relies on color. Reaching the goal is one signal, not a verdict. */
/** Goal reached is green and goal not reached is a muted orange-brown; every state also has its own icon and words. The running icon does not spin. */
const colors: Partial<Record<RunState, string>> = { success: 'text-reach', failure: 'text-missed', running: 'text-trace' };

export function RunStateLabel({ state, className, hideText }: { state: RunState; className?: string; hideText?: boolean }) {
  const Icon = icons[state];
  return <span className={cn('inline-flex items-center gap-1.5', colors[state], className)}>
    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
    <span className={hideText ? 'sr-only' : undefined}>{runStateLabel(state)}</span>
  </span>;
}
