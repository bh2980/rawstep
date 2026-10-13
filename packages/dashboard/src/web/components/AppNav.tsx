import { History, ListChecks, Settings, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Route, RouteChange, View } from '../hooks/useRoute';
import { cn } from '../lib/utils';
import { Link } from './Link';

type Props = { route: Route; navigate: (change: RouteChange) => void };

const items: { view: View; icon: LucideIcon }[] = [{ view: 'tasks', icon: ListChecks }, { view: 'runs', icon: History }, { view: 'settings', icon: Settings }];

/** Left navigation: 작업 (the landing page), 실행 기록 and 설정, where every configured thing lives. */
export function AppNav({ route, navigate }: Props) {
  const { t } = useTranslation();
  return <nav aria-label={t('nav.label')} className="flex h-full flex-col gap-0.5 px-2 py-3">
    {items.map(({ view, icon: Icon }) => {
      const current = route.view === view;
      return <Link key={view} to={{ view }} navigate={navigate} aria-current={current ? 'page' : undefined}
        className={cn('flex h-9 items-center gap-2.5 rounded-md px-3 text-sm', current ? 'bg-trace-soft font-medium text-foreground' : 'text-muted-foreground hover:bg-raised hover:text-foreground')}>
        <Icon className="size-4 shrink-0" aria-hidden="true" />{t(`nav.${view}`)}
      </Link>;
    })}
  </nav>;
}
