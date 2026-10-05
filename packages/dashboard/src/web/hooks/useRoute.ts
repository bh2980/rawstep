import { useCallback, useSyncExternalStore } from 'react';

export const runTabs = ['hints', 'steps', 'compare', 'events'] as const;
export type RunTab = (typeof runTabs)[number];
export type Route = { task?: string; run?: string; tab: RunTab; step?: number };
export type RouteChange = { task?: string | undefined; run?: string | undefined; tab?: RunTab | undefined; step?: number | undefined };

/** `?task=new` shows the new-task page instead of an existing task. */
export const NEW_TASK = 'new';

const EVENT = 'rawstep:navigate';
let cachedSearch: string | undefined;
let cachedRoute: Route = { tab: 'hints' };

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search);
  const tab = params.get('tab'), step = Number(params.get('step'));
  return {
    ...(params.get('task') ? { task: params.get('task')! } : {}),
    ...(params.get('run') ? { run: params.get('run')! } : {}),
    tab: runTabs.find(t => t === tab) ?? 'hints',
    ...(params.has('step') && Number.isInteger(step) && step >= 0 ? { step } : {}),
  };
}

export function routeSearch(route: Partial<Route>): string {
  const params = new URLSearchParams();
  if (route.task) params.set('task', route.task);
  if (route.run) params.set('run', route.run);
  if (route.run && route.tab && route.tab !== 'hints') params.set('tab', route.tab);
  if (route.run && route.step !== undefined) params.set('step', String(route.step));
  const text = params.toString();
  return text ? '?' + text : location.pathname;
}

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(EVENT, listener);
  return () => { window.removeEventListener('popstate', listener); window.removeEventListener(EVENT, listener); };
}

function snapshot(): Route {
  if (location.search !== cachedSearch) { cachedSearch = location.search; cachedRoute = parseRoute(location.search); }
  return cachedRoute;
}

/** Selection lives in ?task=&run=&tab=&step= so reload and the back button restore the view. */
export function useRoute() {
  const route = useSyncExternalStore(subscribe, snapshot, snapshot);
  const navigate = useCallback((next: RouteChange, options: { replace?: boolean } = {}) => {
    const url = routeSearch({ ...next, tab: next.tab ?? 'hints' });
    if (url === (location.search || location.pathname)) return;
    if (options.replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { route, navigate };
}
