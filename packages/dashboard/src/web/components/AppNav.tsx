import { History, House, ListChecks, Settings, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Route, RouteChange, View } from '../hooks/useRoute';
import { cn } from '../lib/utils';
import { Link } from './Link';

type Props = { route: Route; navigate: (change: RouteChange) => void };

const main: { view: View; icon: LucideIcon }[] = [{ view: 'home', icon: House }, { view: 'tasks', icon: ListChecks }, { view: 'runs', icon: History }];

function NavLink({ view, icon: Icon, route, navigate }: Props & { view: View; icon: LucideIcon }) {
  const { t } = useTranslation();
  const current = route.view === view;
  return <Link to={{ view }} navigate={navigate} aria-current={current ? 'page' : undefined}
    data-selected={current} className={cn('row-rail flex h-10 items-center gap-2.5 pr-3 pl-4 text-sm', current ? 'bg-trace-soft font-medium text-foreground' : 'text-muted-foreground hover:bg-raised hover:text-foreground')}>
    <Icon className="size-4 shrink-0" aria-hidden="true" />{t(`nav.${view}`)}
  </Link>;
}

/** Left navigation: home, tasks and run history at the top, settings at the bottom. */
export function AppNav({ route, navigate }: Props) {
  const { t } = useTranslation();
  return <nav aria-label={t('nav.label')} className="flex h-full flex-col gap-0.5 py-3">
    {main.map(item => <NavLink key={item.view} {...item} route={route} navigate={navigate} />)}
    <div className="flex-1" />
    <NavLink view="settings" icon={Settings} route={route} navigate={navigate} />
  </nav>;
}
