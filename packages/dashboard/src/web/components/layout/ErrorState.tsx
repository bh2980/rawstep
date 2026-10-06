import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { RouteChange } from '../../hooks/useRoute';
import type { ErrorKind, ErrorView } from '../../lib/errors';
import { cn } from '../../lib/utils';
import { Link } from '../Link';
import { Collapsible, CollapsibleContent } from '../ui/collapsible';
import { Disclosure } from './Disclosure';

/** Setup and connection are amber (something to change, not a failure of the product); a start or a stop is rust; a data problem is neutral ink. The kind is always written out. */
const tone: Record<ErrorKind, { rule: string; label: string }> = {
  setup: { rule: 'border-l-inspect', label: 'text-inspect' },
  start: { rule: 'border-l-missed', label: 'text-missed' },
  runtime: { rule: 'border-l-missed', label: 'text-missed' },
  data: { rule: 'border-l-foreground', label: 'text-foreground' },
  connection: { rule: 'border-l-inspect', label: 'text-inspect' },
};

type Props = {
  view: ErrorView;
  navigate?: ((change: RouteChange) => void) | undefined;
  /** Buttons that belong to this error, for example reloading. */
  actions?: ReactNode;
  /** Announces itself at once: for an error that just happened, not for one that is part of a finished record. */
  alert?: boolean;
  className?: string;
};

/**
 * Spec §37: not one red alert for everything. Each error says what happened, how far it got and what to do next, and keeps the
 * original record behind a disclosure. The record holds codes and the server's own fixed messages; provider text is never in it.
 */
export function ErrorState({ view, navigate, actions, alert, className }: Props) {
  const { t } = useTranslation();
  const id = useId(), [open, setOpen] = useState(false);
  return <section {...(alert ? { role: 'alert' } : { 'aria-labelledby': id })} className={cn('grid gap-2 border-l-4 bg-surface py-3 pr-4 pl-4', tone[view.kind].rule, className)}>
    <p id={id} className={cn('text-xs font-semibold tracking-wide', tone[view.kind].label)}>{t(`errors.kinds.${view.kind}`)}</p>
    <p className="text-[15px] leading-6 font-semibold">{view.what}</p>
    <dl className="grid gap-x-4 gap-y-1 text-sm leading-6 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
      {view.progress && <><dt className="text-muted-foreground">{t('errors.progress')}</dt><dd>{view.progress}</dd></>}
      <dt className="text-muted-foreground">{t('errors.next')}</dt>
      <dd>{view.next}{view.link && navigate && <> <Link to={view.link.to} navigate={navigate} className="whitespace-nowrap text-trace underline underline-offset-2">{view.link.label}</Link></>}</dd>
    </dl>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    {view.raw && <Collapsible open={open} onOpenChange={setOpen} className="grid">
      <Disclosure label={t('errors.raw')} />
      <CollapsibleContent className="grid gap-1.5">
        <p className="text-xs leading-5 text-muted-foreground">{t('errors.rawNote')}</p>
        <pre tabIndex={0} aria-label={t('errors.raw')} className="max-h-48 overflow-auto rounded-md border bg-raised p-2.5 font-mono text-xs leading-5 whitespace-pre-wrap break-words">{view.raw}</pre>
      </CollapsibleContent>
    </Collapsible>}
  </section>;
}
