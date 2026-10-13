import { useCallback, useSyncExternalStore } from 'react';

export const views = ['tasks', 'runs', 'settings'] as const;
export type View = (typeof views)[number];
/** The parts of 설정, in the order of its side navigation, grouped: 실험 조건 · 모델 · 이 컴퓨터. */
export const settingsGroups = [
  { id: 'conditions', sections: ['presets', 'combos', 'actionSets', 'pageEnvironments', 'atEnvironments', 'runRules'] },
  { id: 'models', sections: ['connections', 'assist'] },
  { id: 'computer', sections: ['machine'] },
] as const;
export type SettingsSection = (typeof settingsGroups)[number]['sections'][number];
export const settingsSections: readonly SettingsSection[] = settingsGroups.flatMap(group => group.sections);
/** Addresses from before 설정 held everything; they still open the part they meant. */
const legacyViews: Record<string, { view: View; section?: SettingsSection }> = { home: { view: 'tasks' }, conditions: { view: 'settings', section: 'combos' }, connections: { view: 'settings', section: 'connections' } };
export const taskTabs = ['overview', 'runs', 'check', 'settings'] as const;
export type TaskTab = (typeof taskTabs)[number];

/**
 * `view` is the left-navigation entry the page belongs to: a task, a new task or a run is always under 작업.
 * `tab` belongs to a task page and `step` to an open run.
 */
export type Route = { view: View; task?: string; run?: string; tab: TaskTab; step?: number; section?: SettingsSection };
export type RouteChange = { view?: View | undefined; task?: string | undefined; run?: string | undefined; tab?: TaskTab | undefined; step?: number | undefined; section?: SettingsSection | undefined };

/** `?task=new` shows the new-task page instead of an existing task. */
export const NEW_TASK = 'new';

const EVENT = 'rawstep:navigate';
let cachedSearch: string | undefined;
let cachedRoute: Route = { view: 'tasks', tab: 'overview' };

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search);
  const raw = params.get('view') ?? '', legacy = legacyViews[raw];
  const view = legacy?.view ?? views.find(v => v === raw) ?? 'tasks', task = params.get('task'), step = Number(params.get('step'));
  const section = view === 'settings' && !task ? settingsSections.find(s => s === params.get('section')) ?? legacy?.section : undefined;
  return {
    view: task ? 'tasks' : view,
    ...(section ? { section } : {}),
    ...(task ? { task } : {}),
    ...(task && params.get('run') ? { run: params.get('run')! } : {}),
    tab: taskTabs.find(t => t === params.get('tab')) ?? 'overview',
    ...(task && params.get('run') && params.has('step') && Number.isInteger(step) && step >= 0 ? { step } : {}),
  };
}

/** The URL query for a route: `?task=&run=` for a task page, `?view=` (and `&section=` in 설정) otherwise, nothing for the task list. */
export function routeSearch(route: RouteChange): string {
  const params = new URLSearchParams();
  if (route.task) {
    params.set('task', route.task);
    if (route.run) {
      params.set('run', route.run);
      if (route.step !== undefined) params.set('step', String(route.step));
    } else if (route.tab && route.tab !== 'overview') params.set('tab', route.tab);
  } else if (route.view && route.view !== 'tasks') {
    params.set('view', route.view);
    if (route.view === 'settings' && route.section) params.set('section', route.section);
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

/** Selection lives in the URL (?view=&task=&run=&tab=&step=) so reload and the back button restore the page. */
export function useRoute() {
  const route = useSyncExternalStore(subscribe, snapshot, snapshot);
  const navigate = useCallback((change: RouteChange, options: { replace?: boolean } = {}) => go(change, options.replace === true), []);
  return { route, navigate };
}
