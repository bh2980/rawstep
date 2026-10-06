import type { ComponentProps, MouseEvent } from 'react';
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
