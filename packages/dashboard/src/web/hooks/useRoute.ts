import { useCallback, useSyncExternalStore } from 'react';

/** The left-navigation pages, in order: 작업, 실행 프로필, 실행 기록, 설정. */
export const views = ['tasks', 'profiles', 'runs', 'settings'] as const;
export type View = (typeof views)[number];
/** The parts of 설정, in the order of its sub-menu: AI 연결, 이 컴퓨터. 실행 프로필 is a page of its own. */
export const settingsSections = ['connections', 'machine'] as const;
export type SettingsSection = (typeof settingsSections)[number];
/** The part 설정 opens with when the address names none. */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'connections';
/** Addresses from before 설정 held everything (and before 실행 프로필 had its own page); they still open the page they meant. */
const legacyViews: Record<string, { view: View; section?: SettingsSection }> = { home: { view: 'tasks' }, conditions: { view: 'profiles' }, connections: { view: 'settings', section: 'connections' } };
export const taskTabs = ['overview', 'runs', 'check', 'settings'] as const;
export type TaskTab = (typeof taskTabs)[number];

/**
 * `view` is the left-navigation entry the page belongs to: a task, a new task or a run is always under 작업.
 * `tab` belongs to a task page and `step` to an open run.
 */
export type Route = { view: View; task?: string; run?: string; tab: TaskTab; step?: number; section?: SettingsSection; compare?: string[] };
export type RouteChange = { view?: View | undefined; task?: string | undefined; run?: string | undefined; tab?: TaskTab | undefined; step?: number | undefined; section?: SettingsSection | undefined; compare?: readonly string[] | undefined };

/** `?task=new` shows the new-task page instead of an existing task. */
export const NEW_TASK = 'new';

const EVENT = 'rawstep:navigate';
let cachedSearch: string | undefined;
let cachedRoute: Route = { view: 'tasks', tab: 'overview' };

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search);
  const raw = params.get('view') ?? '', legacy = legacyViews[raw];
  const named = legacy?.view ?? views.find(v => v === raw) ?? 'tasks', task = params.get('task'), step = Number(params.get('step'));
  // The commentary models moved into AI 연결, and 실행 프로필 moved out of 설정 into a page of its own.
  const asked = params.get('section') === 'assist' ? 'connections' : params.get('section');
  const view: View = named === 'settings' && asked === 'profiles' ? 'profiles' : named;
  const section = view === 'settings' && !task ? settingsSections.find(s => s === asked) ?? legacy?.section : undefined;
  // `?view=runs&compare=<run>,<run>,…` sets runs of any task side by side.
  const compare = view === 'runs' && !task ? (params.get('compare') ?? '').split(',').filter(Boolean) : [];
  return {
    view: task ? 'tasks' : view,
    ...(section ? { section } : {}),
    ...(compare.length ? { compare } : {}),
    ...(task ? { task } : {}),
    ...(task && params.get('run') ? { run: params.get('run')! } : {}),
    tab: taskTabs.find(t => t === params.get('tab')) ?? 'overview',
    ...(task && params.get('run') && params.has('step') && Number.isInteger(step) && step >= 0 ? { step } : {}),
  };
}

/** The URL query for a route: `?task=&run=` for a task page, `?view=` (and `&section=` in 설정, `&compare=` for runs side by side) otherwise, nothing for the task list. */
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
    if (route.view === 'runs' && route.compare?.length) params.set('compare', route.compare.join(','));
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
