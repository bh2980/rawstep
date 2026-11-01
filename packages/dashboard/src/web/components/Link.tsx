import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { routeSearch, type RouteChange } from '../hooks/useRoute';

type Props = Omit<ComponentProps<'a'>, 'href'> & { to: RouteChange; navigate: (change: RouteChange) => void };

/** A real link to a dashboard page: it opens in a new tab as usual and navigates in place on a plain click. */
export function Link({ to, navigate, onClick, ...props }: Props) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(to);
  };
  return <a {...props} href={routeSearch(to)} onClick={click} />;
}

/**
 * A link to a dashboard page that always opens in a new tab, for forms with edits that a plain click would drop. It says so in words
 * for a screen reader, not only by behaviour.
 */
export function NewTabLink({ to, className, children }: { to: RouteChange; className?: string | undefined; children: ReactNode }) {
  const { t } = useTranslation();
  return <a href={routeSearch(to)} target="_blank" rel="noreferrer" className={className}>{children}<span className="sr-only"> ({t('forms.newTab')})</span></a>;
}
