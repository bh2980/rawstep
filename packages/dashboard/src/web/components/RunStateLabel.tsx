import { Ban, CircleDashed, CircleHelp, Clock, LoaderCircle, Target, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { RunState } from '../../shared/config';
import { runStateLabel } from '../i18n/labels';
import { cn } from '../lib/utils';

const icons: Record<RunState, LucideIcon> = {
  queued: Clock, running: LoaderCircle, success: Target, failure: CircleDashed,
  inconclusive: CircleHelp, cancelled: Ban, interrupted: TriangleAlert,
};

/** State as icon plus text, so it never relies on color. Reaching the goal is one signal, not a verdict. */
export function RunStateLabel({ state, className, hideText }: { state: RunState; className?: string; hideText?: boolean }) {
  const Icon = icons[state];
  const spin = state === 'running' ? 'animate-spin motion-reduce:animate-none' : '';
  return <span className={cn('inline-flex items-center gap-1.5', className)}>
    <Icon className={cn('size-3.5 shrink-0', spin)} aria-hidden="true" />
    <span className={hideText ? 'sr-only' : undefined}>{runStateLabel(state)}</span>
  </span>;
}
