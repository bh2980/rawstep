import { useCallback, useSyncExternalStore } from 'react';

export const views = ['home', 'tasks', 'runs', 'settings'] as const;
export type View = (typeof views)[number];
export const sections = ['models', 'profiles', 'machine'] as const;
export type Section = (typeof sections)[number];
export const runTabs = ['hints', 'steps', 'compare', 'events'] as const;
export type RunTab = (typeof runTabs)[number];

/**
 * `view` is the left-navigation entry the page belongs to: a task, a new task or a run is always under 작업.
 * `section` is the settings page section; `tab` and `step` belong to an open run.
 */
export type Route = { view: View; section: Section; task?: string; run?: string; tab: RunTab; step?: number };
export type RouteChange = { view?: View | undefined; section?: Section | undefined; task?: string | undefined; run?: string | undefined; tab?: RunTab | undefined; step?: number | undefined };

/** `?task=new` shows the new-task page instead of an existing task. */
export const NEW_TASK = 'new';

const EVENT = 'rawstep:navigate';
let cachedSearch: string | undefined;
let cachedRoute: Route = { view: 'home', section: 'models', tab: 'hints' };

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search);
  const view = views.find(v => v === params.get('view')) ?? 'home', task = params.get('task'), step = Number(params.get('step'));
  return {
    view: task ? 'tasks' : view,
    section: sections.find(s => s === params.get('section')) ?? 'models',
    ...(task ? { task } : {}),
    ...(task && params.get('run') ? { run: params.get('run')! } : {}),
    tab: runTabs.find(t => t === params.get('tab')) ?? 'hints',
    ...(params.has('step') && Number.isInteger(step) && step >= 0 ? { step } : {}),
  };
}

/** The URL query for a route: `?task=&run=` for a task page, `?view=` for a list or settings, nothing for home. */
export function routeSearch(route: RouteChange): string {
  const params = new URLSearchParams();
  if (route.task) {
    params.set('task', route.task);
    if (route.run) {
      params.set('run', route.run);
      if (route.tab && route.tab !== 'hints') params.set('tab', route.tab);
      if (route.step !== undefined) params.set('step', String(route.step));
    }
  } else if (route.view && route.view !== 'home') {
    params.set('view', route.view);
    if (route.view === 'settings') params.set('section', route.section ?? 'models');
  }
  const text = params.toString();
  return text ? '?' + text : '/';
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

function go(change: RouteChange, replace: boolean) {
  const url = routeSearch(change);
  if (url === (location.search || '/')) return;
  if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  window.dispatchEvent(new Event(EVENT));
}

/** Selection lives in the URL (?view=&section=&task=&run=&tab=&step=) so reload and the back button restore the page. */
export function useRoute() {
  const route = useSyncExternalStore(subscribe, snapshot, snapshot);
  const navigate = useCallback((change: RouteChange, options: { replace?: boolean } = {}) => go(change, options.replace === true), []);
  return { route, navigate };
}
